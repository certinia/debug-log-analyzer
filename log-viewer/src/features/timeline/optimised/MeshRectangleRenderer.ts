/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * MeshRectangleRenderer
 *
 * Pure rectangle rendering for timeline events using PixiJS Mesh with custom geometry.
 * Receives pre-computed, culled rectangles and renders them with original colors.
 *
 * Responsibilities:
 * - Render rectangles with their original colors
 * - Render buckets (sub-pixel aggregated events)
 *
 * Does NOT:
 * - Pre-compute rectangles (done by RectangleCache)
 * - Perform culling (done by RectangleCache)
 * - Handle search logic (done by MeshSearchStyleRenderer)
 */

import type { Container } from 'pixi.js';
import type { PixelBucket, RenderBatch, ViewportState } from '../types/flamechart.types.js';
import { TIMELINE_CONSTANTS } from '../types/flamechart.types.js';
import type { PrecomputedRect } from './RectangleCache.js';
import { MeshRectangleWriter } from './rendering/MeshRectangleWriter.js';

const ownColor = (bucket: PixelBucket): number => bucket.color;

export class MeshRectangleRenderer extends MeshRectangleWriter {
  constructor(container: Container, batches: Map<string, RenderBatch>) {
    super(container, batches, 'MeshRectangleRenderer');
  }

  /**
   * Render culled rectangles and buckets.
   * Receives pre-culled rectangles and aggregated buckets from RectangleCache.
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
    const viewportTransform = this.beginFrame(culledRects, buckets, viewport);
    if (!viewportTransform) {
      return;
    }

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

    // Buckets have density-based colors (opacity pre-blended into the color).
    rectIndex = this.writeBuckets(buckets, rectIndex, viewportTransform, ownColor);

    this.endFrame(rectIndex);
  }
}
