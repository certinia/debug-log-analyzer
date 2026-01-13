/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

/**
 * EventBatchRenderer
 *
 * Pure rectangle rendering for timeline events using PixiJS Sprites.
 * Receives pre-computed, culled rectangles and renders them with original colors.
 *
 * Performance optimizations:
 * - Uses SpritePool with shared 1x1 white texture for automatic GPU batching
 * - Sprites are pooled and reused (no GC overhead after warmup)
 * - Color applied via sprite.tint (efficient uniform update, no state changes)
 * - Single draw call for all sprites regardless of color variations
 *
 * Responsibilities:
 * - Render rectangles with their original colors
 * - Render buckets (sub-pixel aggregated events)
 *
 * Does NOT:
 * - Pre-compute rectangles (done by RectangleManager)
 * - Perform culling (done by RectangleManager)
 * - Handle search logic (done by SearchStyleRenderer)
 */

import type { Container } from 'pixi.js';
import type { PixelBucket, RenderBatch } from '../types/flamechart.types.js';
import { BUCKET_CONSTANTS, TIMELINE_CONSTANTS } from '../types/flamechart.types.js';
import type { PrecomputedRect } from './RectangleManager.js';
import { SpritePool } from './SpritePool.js';

export class EventBatchRenderer {
  private batches: Map<string, RenderBatch>;
  private spritePool: SpritePool;

  constructor(container: Container, batches: Map<string, RenderBatch>) {
    this.batches = batches;
    this.spritePool = new SpritePool(container);
  }

  /**
   * Render culled rectangles and buckets.
   * Receives pre-culled rectangles and aggregated buckets from RectangleManager.
   * Both are keyed by category.
   *
   * @param culledRects - Rectangles grouped by category (events > 2px)
   * @param buckets - Aggregated buckets grouped by category (events ≤ 2px)
   * @param _viewport - Unused, for API compatibility with mesh renderer
   */
  public render(
    culledRects: Map<string, PrecomputedRect[]>,
    buckets: Map<string, PixelBucket[]>,
    _viewport?: unknown,
  ): void {
    // Release all sprites back to pool for reuse
    this.spritePool.releaseAll();

    // Clear all batches and populate from culled rectangles
    // (maintains backward compatibility for tests and debugging)
    for (const batch of this.batches.values()) {
      batch.rectangles.length = 0;
      batch.isDirty = true;
    }

    // Pre-calculate constants outside loops
    const gap = TIMELINE_CONSTANTS.RECT_GAP;
    const halfGap = gap / 2;

    // Render rectangles per category
    for (const [category, rectangles] of culledRects) {
      const batch = this.batches.get(category);
      if (!batch) {
        continue;
      }

      const color = batch.color;

      for (const rect of rectangles) {
        // Store in batch for backward compatibility
        batch.rectangles.push(rect);

        // Render as sprite
        const sprite = this.spritePool.acquire();
        sprite.position.set(rect.x + halfGap, rect.y + halfGap);
        sprite.width = Math.max(0, rect.width - gap);
        sprite.height = Math.max(0, rect.height - gap);
        sprite.tint = color;
      }

      batch.isDirty = false;
    }

    // Render all buckets
    this.renderBuckets(buckets);
  }

  /**
   * Clear all sprites (hide them).
   * Called when switching to search mode.
   */
  public clear(): void {
    this.spritePool.releaseAll();
  }

  /**
   * Clean up sprite pool.
   */
  public destroy(): void {
    this.spritePool.destroy();
  }

  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================

  /**
   * Render all buckets using sprites.
   *
   * Buckets have density-based colors (opacity pre-blended into the color).
   * Each bucket gets its own sprite with the appropriate tint.
   *
   * @param buckets - Aggregated buckets grouped by category
   */
  private renderBuckets(buckets: Map<string, PixelBucket[]>): void {
    // Pre-calculate constants outside loops
    const gap = TIMELINE_CONSTANTS.RECT_GAP;
    const halfGap = gap / 2;
    const blockWidth = BUCKET_CONSTANTS.BUCKET_BLOCK_WIDTH;
    const eventHeight = TIMELINE_CONSTANTS.EVENT_HEIGHT;
    const gappedHeight = Math.max(0, eventHeight - gap);

    // Render all buckets from all categories
    for (const categoryBuckets of buckets.values()) {
      for (const bucket of categoryBuckets) {
        const sprite = this.spritePool.acquire();
        sprite.position.set(bucket.x + halfGap, bucket.y + halfGap);
        sprite.width = blockWidth;
        sprite.height = gappedHeight;
        sprite.tint = bucket.color;
      }
    }
  }
}
