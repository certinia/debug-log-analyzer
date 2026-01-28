/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

/**
 * SearchStyleRenderer
 *
 * Renders rectangles with search-aware styling using PixiJS Sprites (Chrome DevTools style).
 * Matched events retain original colors, non-matched events are desaturated to greyscale.
 *
 * Performance optimizations:
 * - Uses SpritePool with shared 1x1 white texture for automatic GPU batching
 * - Sprites are pooled and reused (no GC overhead after warmup)
 * - Color applied via sprite.tint (efficient uniform update)
 * - Single draw call for all sprites regardless of color variations
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

import type { Container } from 'pixi.js';
import type {
  CategoryAggregation,
  PixelBucket,
  RenderBatch,
} from '../../types/flamechart.types.js';
import { BUCKET_CONSTANTS, TIMELINE_CONSTANTS } from '../../types/flamechart.types.js';
import type { MatchedEventInfo } from '../../types/search.types.js';
import { resolveColor } from '../BucketColorResolver.js';
import type { PrecomputedRect } from '../RectangleManager.js';
import { SpritePool } from '../SpritePool.js';

/**
 * SearchStyleRenderer
 *
 * Pure rendering class for search-aware styling of timeline events using sprites.
 * Receives pre-computed, culled rectangles and matched events set.
 */
export class SearchStyleRenderer {
  private batches: Map<string, RenderBatch>;
  private spritePool: SpritePool;

  constructor(container: Container, batches: Map<string, RenderBatch>) {
    this.batches = batches;
    this.spritePool = new SpritePool(container);
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
   * @param _viewport - Unused, for API compatibility with mesh renderer
   * @param matchedEventsInfo - Lightweight info about matched events for bucket highlighting
   */
  public render(
    culledRects: Map<string, PrecomputedRect[]>,
    matchedEventIds: ReadonlySet<string>,
    buckets: Map<string, PixelBucket[]> = new Map(),
    _viewport?: unknown,
    matchedEventsInfo: ReadonlyArray<MatchedEventInfo> = [],
  ): void {
    // Release all sprites back to pool for reuse
    this.spritePool.releaseAll();

    // Pre-calculate constants outside loops
    const gap = TIMELINE_CONSTANTS.RECT_GAP;
    const halfGap = gap / 2;

    // Render rectangles per category with search styling
    for (const [category, rectangles] of culledRects) {
      const batch = this.batches.get(category);
      if (!batch) {
        continue;
      }

      const originalColor = batch.color;
      const greyColor = this.colorToGreyscale(originalColor);

      for (const rect of rectangles) {
        const sprite = this.spritePool.acquire();
        sprite.position.set(rect.x + halfGap, rect.y + halfGap);
        sprite.width = Math.max(0, rect.width - gap);
        sprite.height = Math.max(0, rect.height - gap);

        // Use original color for matched events, greyscale for non-matched
        sprite.tint = matchedEventIds.has(rect.id) ? originalColor : greyColor;
      }
    }

    // Render all buckets with search styling
    this.renderBucketsWithSearch(buckets, matchedEventsInfo);
  }

  /**
   * Clear all sprites (hide them).
   * Called when exiting search mode to return to normal rendering.
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
   * Render all buckets with search styling using sprites.
   *
   * Each bucket's color is determined by whether it contains matched events.
   * Buckets with matches use resolved color from matched events.
   * Buckets without matches use desaturated greyscale.
   *
   * Uses time-range matching since bucket.eventRefs may be empty for memory-optimized buckets.
   *
   * @param buckets - Aggregated buckets grouped by category
   * @param matchedEventsInfo - Lightweight info about matched events
   */
  private renderBucketsWithSearch(
    buckets: Map<string, PixelBucket[]>,
    matchedEventsInfo: ReadonlyArray<MatchedEventInfo>,
  ): void {
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

    // Render all buckets from all categories
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

        const sprite = this.spritePool.acquire();
        sprite.position.set(bucket.x + halfGap, bucket.y + halfGap);
        sprite.width = blockWidth;
        sprite.height = gappedHeight;
        sprite.tint = displayColor;
      }
    }
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
