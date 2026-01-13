/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * MeshRectangleRenderer
 *
 * Pure rectangle rendering for timeline events using PixiJS Mesh with custom geometry.
 * Receives pre-computed, culled rectangles and renders them with original colors.
 *
 * Performance optimizations:
 * - Single Mesh draw call for all rectangles
 * - Direct buffer updates (no scene graph overhead)
 * - Clip-space coordinates (no uniform binding overhead)
 * - Pre-computed colors applied per vertex
 *
 * Responsibilities:
 * - Render rectangles with their original colors
 * - Render buckets (sub-pixel aggregated events)
 *
 * Does NOT:
 * - Pre-compute rectangles (done by RectangleManager)
 * - Perform culling (done by RectangleManager)
 * - Handle search logic (done by MeshSearchStyleRenderer)
 */

import { Container, Geometry, Mesh, Shader } from 'pixi.js';
import type { PixelBucket, RenderBatch, ViewportState } from '../../types/flamechart.types.js';
import { BUCKET_CONSTANTS, TIMELINE_CONSTANTS } from '../../types/flamechart.types.js';
import type { PrecomputedRect } from '../RectangleManager.js';
import { RectangleGeometry, type ViewportTransform } from './RectangleGeometry.js';
import { createRectangleShader } from './rectangleShader.js';

export class MeshRectangleRenderer {
  private batches: Map<string, RenderBatch>;
  private parentContainer: Container;
  private geometry: RectangleGeometry;
  private shader: Shader;
  private mesh: Mesh<Geometry, Shader>;
  private lastViewport: ViewportState | null = null;

  constructor(container: Container, batches: Map<string, RenderBatch>) {
    this.batches = batches;
    this.parentContainer = container;

    // Create geometry and shader
    this.geometry = new RectangleGeometry();
    this.shader = createRectangleShader();

    // Create mesh for rendering rectangles
    this.mesh = new Mesh<Geometry, Shader>({
      geometry: this.geometry.getGeometry(),
      shader: this.shader,
    });
    this.mesh.label = 'MeshRectangleRenderer';

    // Add to parent container
    container.addChild(this.mesh);
  }

  /**
   * Set the stage container for clip-space rendering.
   * NOTE: With clip-space coordinates, we don't need to move to stage root.
   * The mesh outputs directly to gl_Position, bypassing all container transforms.
   * We keep the mesh in worldContainer so it's part of the scene graph.
   */
  public setStageContainer(_stage: Container): void {
    // No-op: Keep mesh in worldContainer. Clip-space shader bypasses transforms anyway.
  }

  /**
   * Render culled rectangles and buckets.
   * Receives pre-culled rectangles and aggregated buckets from RectangleManager.
   * Both are keyed by category.
   *
   * @param culledRects - Rectangles grouped by category (events > 2px)
   * @param buckets - Aggregated buckets grouped by category (events <= 2px)
   * @param viewport - Current viewport state for coordinate transforms
   */
  public render(
    culledRects: Map<string, PrecomputedRect[]>,
    buckets: Map<string, PixelBucket[]>,
    viewport?: ViewportState,
  ): void {
    // Use provided viewport or fall back to stored one
    const vp = viewport || this.lastViewport;
    if (!vp) {
      return;
    }
    this.lastViewport = vp;

    // Count total rectangles needed
    let totalRects = 0;
    for (const rectangles of culledRects.values()) {
      totalRects += rectangles.length;
    }
    for (const categoryBuckets of buckets.values()) {
      totalRects += categoryBuckets.length;
    }

    // Early exit if nothing to render
    if (totalRects === 0) {
      this.geometry.setDrawCount(0);
      this.mesh.visible = false;
      return;
    }

    // Ensure buffer capacity
    this.geometry.ensureCapacity(totalRects);

    // Create viewport transform for coordinate conversion
    const viewportTransform: ViewportTransform = {
      offsetX: vp.offsetX,
      offsetY: vp.offsetY,
      displayWidth: vp.displayWidth,
      displayHeight: vp.displayHeight,
    };

    // Pre-calculate constants outside loops
    const gap = TIMELINE_CONSTANTS.RECT_GAP;
    const height = Math.max(0, TIMELINE_CONSTANTS.EVENT_HEIGHT - gap);
    const halfGap = gap / 2;

    let rectIndex = 0;

    // Clear all batches and populate from culled rectangles
    // (maintains backward compatibility for tests and debugging)
    for (const batch of this.batches.values()) {
      batch.rectangles.length = 0;
      batch.isDirty = true;
    }

    // Write rectangles per category
    for (const [category, rectangles] of culledRects) {
      const batch = this.batches.get(category);
      if (!batch) {
        continue;
      }

      const color = batch.color;

      for (const rect of rectangles) {
        // Store in batch for backward compatibility
        batch.rectangles.push(rect);

        // Write rectangle with gap handling
        const x = rect.x + halfGap;
        const y = rect.y + halfGap;
        const width = Math.max(0, rect.width - gap);

        if (width > 0) {
          this.geometry.writeRectangle(rectIndex, x, y, width, height, color, viewportTransform);
          rectIndex++;
        }
      }

      batch.isDirty = false;
    }

    // Write all buckets
    this.writeBuckets(buckets, rectIndex, viewportTransform);
    rectIndex += this.countBuckets(buckets);

    // Set draw count and make visible
    this.geometry.setDrawCount(rectIndex);
    this.mesh.visible = true;
  }

  /**
   * Clear all rendered content (hide the mesh).
   * Called when switching to search mode.
   */
  public clear(): void {
    this.geometry.setDrawCount(0);
    this.mesh.visible = false;
  }

  /**
   * Clean up resources.
   */
  public destroy(): void {
    this.geometry.destroy();
    this.mesh.destroy();
  }

  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================

  /**
   * Count total buckets across all categories.
   */
  private countBuckets(buckets: Map<string, PixelBucket[]>): number {
    let count = 0;
    for (const categoryBuckets of buckets.values()) {
      count += categoryBuckets.length;
    }
    return count;
  }

  /**
   * Write all buckets to geometry buffers.
   *
   * Buckets have density-based colors (opacity pre-blended into the color).
   * Each bucket gets rendered as a rectangle with the appropriate color.
   *
   * @param buckets - Aggregated buckets grouped by category
   * @param startIndex - Starting rectangle index in the buffer
   * @param viewportTransform - Transform for coordinate conversion
   */
  private writeBuckets(
    buckets: Map<string, PixelBucket[]>,
    startIndex: number,
    viewportTransform: ViewportTransform,
  ): void {
    // Pre-calculate constants outside loops
    const gap = TIMELINE_CONSTANTS.RECT_GAP;
    const halfGap = gap / 2;
    const blockWidth = BUCKET_CONSTANTS.BUCKET_BLOCK_WIDTH;
    const eventHeight = TIMELINE_CONSTANTS.EVENT_HEIGHT;
    const gappedHeight = Math.max(0, eventHeight - gap);

    let rectIndex = startIndex;

    // Write all buckets from all categories
    for (const categoryBuckets of buckets.values()) {
      for (const bucket of categoryBuckets) {
        this.geometry.writeRectangle(
          rectIndex,
          bucket.x + halfGap,
          bucket.y + halfGap,
          blockWidth,
          gappedHeight,
          bucket.color,
          viewportTransform,
        );
        rectIndex++;
      }
    }
  }
}
