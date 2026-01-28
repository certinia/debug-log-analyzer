/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * MeshSearchStyleRenderer
 *
 * Renders rectangles with search-aware styling using PixiJS Mesh (Chrome DevTools style).
 * Matched events retain original colors, non-matched events are desaturated to greyscale.
 *
 * Performance optimizations:
 * - Single Mesh draw call for all rectangles
 * - Direct buffer updates (no scene graph overhead)
 * - Clip-space coordinates (no uniform binding overhead)
 *
 * Responsibilities:
 * - Render rectangles with search styling
 * - Desaturate non-matched events
 * - Maintain original colors for matched events
 *
 * Does NOT:
 * - Pre-compute rectangles (done by RectangleManager)
 * - Perform culling (done by RectangleManager)
 * - Draw highlight borders (done by SearchHighlightRenderer)
 * - Implement search logic
 */

import { Container, Geometry, Mesh, Shader } from 'pixi.js';
import type {
  CategoryAggregation,
  PixelBucket,
  RenderBatch,
  ViewportState,
} from '../../types/flamechart.types.js';
import { BUCKET_CONSTANTS, TIMELINE_CONSTANTS } from '../../types/flamechart.types.js';
import type { MatchedEventInfo } from '../../types/search.types.js';
import { resolveColor } from '../BucketColorResolver.js';
import { RectangleGeometry, type ViewportTransform } from '../RectangleGeometry.js';
import type { PrecomputedRect } from '../RectangleManager.js';
import { createRectangleShader } from '../RectangleShader.js';

/**
 * MeshSearchStyleRenderer
 *
 * Pure rendering class for search-aware styling of timeline events using Mesh.
 * Receives pre-computed, culled rectangles and matched events set.
 */
export class MeshSearchStyleRenderer {
  private batches: Map<string, RenderBatch>;
  private geometry: RectangleGeometry;
  private shader: Shader;
  private mesh: Mesh<Geometry, Shader>;
  private lastViewport: ViewportState | null = null;

  constructor(container: Container, batches: Map<string, RenderBatch>) {
    this.batches = batches;

    // Create geometry and shader
    this.geometry = new RectangleGeometry();
    this.shader = createRectangleShader();

    // Create mesh
    this.mesh = new Mesh<Geometry, Shader>({
      geometry: this.geometry.getGeometry(),
      shader: this.shader,
    });
    this.mesh.label = 'MeshSearchStyleRenderer';
    this.mesh.visible = false;

    container.addChild(this.mesh);
  }

  /**
   * Set the stage container for clip-space rendering.
   * NOTE: With clip-space coordinates, we don't need to move to stage root.
   * The mesh outputs directly to gl_Position, bypassing all container transforms.
   */
  public setStageContainer(_stage: Container): void {
    // No-op: Keep mesh in worldContainer. Clip-space shader bypasses transforms anyway.
  }

  /**
   * Render culled rectangles and buckets with search styling.
   * Matched events: original colors
   * Non-matched events: desaturated greyscale
   * Buckets: search-aware styling based on matched events
   *
   * @param culledRects - Rectangles grouped by category (from RectangleManager)
   * @param matchedEventIds - Set of event IDs that match search (retain original colors)
   * @param buckets - Aggregated pixel buckets grouped by category
   * @param viewport - Current viewport state for coordinate transforms
   * @param matchedEventsInfo - Lightweight info about matched events for bucket highlighting
   */
  public render(
    culledRects: Map<string, PrecomputedRect[]>,
    matchedEventIds: ReadonlySet<string>,
    buckets: Map<string, PixelBucket[]> = new Map(),
    viewport?: ViewportState,
    matchedEventsInfo: ReadonlyArray<MatchedEventInfo> = [],
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
    // No canvasYOffset needed - main timeline has its own canvas
    const viewportTransform: ViewportTransform = {
      offsetX: vp.offsetX,
      offsetY: vp.offsetY,
      displayWidth: vp.displayWidth,
      displayHeight: vp.displayHeight,
      canvasYOffset: 0,
    };

    // Pre-calculate constants outside loops
    const gap = TIMELINE_CONSTANTS.RECT_GAP;
    const halfGap = gap / 2;

    let rectIndex = 0;

    // Write rectangles per category with search styling
    for (const [category, rectangles] of culledRects) {
      const batch = this.batches.get(category);
      if (!batch) {
        continue;
      }

      const originalColor = batch.color;
      const greyColor = this.colorToGreyscale(originalColor);

      for (const rect of rectangles) {
        // Use original color for matched events, greyscale for non-matched
        const color = matchedEventIds.has(rect.id) ? originalColor : greyColor;

        const x = rect.x + halfGap;
        const y = rect.y + halfGap;
        const width = Math.max(0, rect.width - gap);
        const height = Math.max(0, rect.height - gap);

        if (width > 0 && height > 0) {
          this.geometry.writeRectangle(rectIndex, x, y, width, height, color, viewportTransform);
          rectIndex++;
        }
      }
    }

    // Write all buckets with search styling
    rectIndex = this.writeBucketsWithSearch(
      buckets,
      matchedEventsInfo,
      rectIndex,
      viewportTransform,
    );

    // Set draw count and make visible
    this.geometry.setDrawCount(rectIndex);
    this.mesh.visible = true;
  }

  /**
   * Clear all rendered content (hide the mesh).
   * Called when exiting search mode to return to normal rendering.
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
   * Write all buckets with search styling to geometry buffers.
   *
   * Each bucket's color is determined by whether it contains matched events.
   * Buckets with matches use resolved color from matched events.
   * Buckets without matches use desaturated greyscale.
   *
   * Uses time-range matching since bucket.eventRefs may be empty for memory-optimized buckets.
   *
   * @param buckets - Aggregated buckets grouped by category
   * @param matchedEventsInfo - Lightweight info about matched events
   * @param startIndex - Starting rectangle index in the buffer
   * @param viewportTransform - Transform for coordinate conversion
   * @returns Next available rectangle index
   */
  private writeBucketsWithSearch(
    buckets: Map<string, PixelBucket[]>,
    matchedEventsInfo: ReadonlyArray<MatchedEventInfo>,
    startIndex: number,
    viewportTransform: ViewportTransform,
  ): number {
    // Build spatial index: Map<depth, Array<{timestamp, category}>>
    const matchesByDepth = new Map<number, Array<{ timestamp: number; category: string }>>();
    for (const info of matchedEventsInfo) {
      let depthMatches = matchesByDepth.get(info.depth);
      if (!depthMatches) {
        depthMatches = [];
        matchesByDepth.set(info.depth, depthMatches);
      }
      depthMatches.push({ timestamp: info.timestamp, category: info.category });
    }

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
        // Find matched events in this bucket using time-range matching
        const matchedCategoryStats = new Map<string, CategoryAggregation>();

        const depthMatches = matchesByDepth.get(bucket.depth);
        if (depthMatches) {
          for (const match of depthMatches) {
            if (
              match.timestamp >= bucket.timeStart &&
              match.timestamp < bucket.timeEnd &&
              match.category
            ) {
              let stats = matchedCategoryStats.get(match.category);
              if (!stats) {
                stats = { count: 0, totalDuration: 0 };
                matchedCategoryStats.set(match.category, stats);
              }
              stats.count++;
            }
          }
        }

        let displayColor: number;

        if (matchedCategoryStats.size > 0) {
          // Resolve color from matched events using priority rules
          displayColor = resolveColor({
            byCategory: matchedCategoryStats,
            dominantCategory: '',
          }).color;
        } else {
          // No matches - desaturate the bucket's pre-blended color
          displayColor = this.colorToGreyscale(bucket.color);
        }

        this.geometry.writeRectangle(
          rectIndex,
          bucket.x + halfGap,
          bucket.y + halfGap,
          blockWidth,
          gappedHeight,
          displayColor,
          viewportTransform,
        );
        rectIndex++;
      }
    }

    return rectIndex;
  }

  /**
   * Convert a color to greyscale based on luminance.
   * Uses standard luminance formula: 0.299*R + 0.587*G + 0.114*B
   * Then applies slight dimming to match Chrome DevTools appearance.
   *
   * @param color - PixiJS color (0xRRGGBB)
   * @returns Greyscale color (0xRRGGBB)
   */
  private colorToGreyscale(color: number): number {
    // Extract RGB components
    const r = (color >> 16) & 0xff;
    const g = (color >> 8) & 0xff;
    const b = color & 0xff;

    // Calculate luminance (perceived brightness)
    const luminance = 0.299 * r + 0.587 * g + 0.114 * b;

    // Apply dimming factor to match Chrome DevTools
    const dimmed = Math.floor(luminance * 0.7);

    // Create greyscale color (same value for R, G, B)
    return (dimmed << 16) | (dimmed << 8) | dimmed;
  }
}
