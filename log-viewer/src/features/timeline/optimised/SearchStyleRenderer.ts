/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

/**
 * SearchStyleRenderer
 *
 * Renders rectangles with search-aware styling (Chrome DevTools style).
 * Matched events retain original colors, non-matched events are desaturated to greyscale.
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

import * as PIXI from 'pixi.js';
import type { CategoryAggregation, PixelBucket, RenderBatch } from '../types/flamechart.types.js';
import { BUCKET_CONSTANTS, TIMELINE_CONSTANTS } from '../types/flamechart.types.js';
import { resolveColor } from './BucketColorResolver.js';
import type { PrecomputedRect } from './RectangleManager.js';

/**
 * SearchStyleRenderer
 *
 * Pure rendering class for search-aware styling of timeline events.
 * Receives pre-computed, culled rectangles and matched events set.
 */
export class SearchStyleRenderer {
  private batches: Map<string, RenderBatch>;
  private graphics: Map<string, PIXI.Graphics>;
  private container: PIXI.Container;
  /** Dedicated Graphics object for bucket rendering during search */
  private bucketGraphics: PIXI.Graphics;

  constructor(container: PIXI.Container, batches: Map<string, RenderBatch>) {
    this.batches = batches;
    this.graphics = new Map();
    this.container = container;

    // Create Graphics objects for each batch
    for (const [category, _batch] of batches) {
      const gfx = new PIXI.Graphics();
      this.graphics.set(category, gfx);
      container.addChild(gfx);
    }

    // Create dedicated Graphics for bucket rendering
    this.bucketGraphics = new PIXI.Graphics();
    container.addChild(this.bucketGraphics);
  }

  /**
   * Render culled rectangles and buckets with search styling.
   * Matched events: original colors
   * Non-matched events: desaturated greyscale
   * Buckets: always desaturated (aggregated events)
   *
   * @param culledRects - Rectangles grouped by category (from RectangleManager)
   * @param matchedEventIds - Set of event IDs that match search (retain original colors)
   * @param buckets - Aggregated pixel buckets to render (always desaturated)
   */
  public render(
    culledRects: Map<string, PrecomputedRect[]>,
    matchedEventIds: ReadonlySet<string>,
    buckets: PixelBucket[] = [],
  ): void {
    // Clear all graphics
    for (const gfx of this.graphics.values()) {
      gfx.clear();
    }
    this.bucketGraphics.clear();

    // Render each category with search styling
    for (const [category, rectangles] of culledRects) {
      const batch = this.batches.get(category);
      const gfx = this.graphics.get(category);

      if (!batch || !gfx || rectangles.length === 0) {
        continue;
      }

      this.renderCategoryWithSearch(
        gfx,
        rectangles,
        batch.color,
        batch.alpha ?? 1,
        matchedEventIds,
      );
    }

    // Render buckets with search-aware styling
    // Buckets containing matched events retain original color
    this.renderBucketsWithSearch(buckets, matchedEventIds);
  }

  /**
   * Clear all search styling graphics without destroying them.
   * Called when exiting search mode to return to normal rendering.
   */
  public clear(): void {
    for (const gfx of this.graphics.values()) {
      gfx.clear();
    }
    this.bucketGraphics.clear();
  }

  /**
   * Clean up Graphics objects.
   */
  public destroy(): void {
    for (const gfx of this.graphics.values()) {
      gfx.destroy();
    }
    this.graphics.clear();
    this.bucketGraphics.destroy();
  }

  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================

  /**
   * Render a category split into matched and non-matched layers.
   * Chrome DevTools style: matched events keep original color, others desaturate.
   *
   * @param gfx - Graphics object for this category
   * @param rectangles - Rectangles to render
   * @param originalColor - Original category color
   * @param originalAlpha - Original category alpha
   * @param matchedEventIds - Set of matched event IDs
   */
  private renderCategoryWithSearch(
    gfx: PIXI.Graphics,
    rectangles: PrecomputedRect[],
    originalColor: number,
    originalAlpha: number,
    matchedEventIds: ReadonlySet<string>,
  ): void {
    const gap = TIMELINE_CONSTANTS.RECT_GAP;
    const halfGap = gap / 2;
    const greyColor = this.colorToGreyscale(originalColor);

    // Draw matched events with original color
    let hasMatched = false;
    for (const rect of rectangles) {
      if (matchedEventIds.has(rect.id)) {
        const gappedX = rect.x + halfGap;
        const gappedY = rect.y + halfGap;
        const gappedWidth = Math.max(0, rect.width - gap);
        const gappedHeight = Math.max(0, rect.height - gap);
        gfx.rect(gappedX, gappedY, gappedWidth, gappedHeight);
        hasMatched = true;
      }
    }
    if (hasMatched) {
      gfx.fill({ color: originalColor, alpha: originalAlpha });
    }

    // Draw non-matched events with greyscale
    let hasNonMatched = false;
    for (const rect of rectangles) {
      if (!matchedEventIds.has(rect.id)) {
        const gappedX = rect.x + halfGap;
        const gappedY = rect.y + halfGap;
        const gappedWidth = Math.max(0, rect.width - gap);
        const gappedHeight = Math.max(0, rect.height - gap);
        gfx.rect(gappedX, gappedY, gappedWidth, gappedHeight);
        hasNonMatched = true;
      }
    }
    if (hasNonMatched) {
      gfx.fill({ color: greyColor, alpha: originalAlpha });
    }
  }

  /**
   * Render buckets with search-aware styling.
   * Buckets containing matched events use the color of matched event categories
   * (highest priority if multiple matches). Buckets without matches are desaturated.
   *
   * @param buckets - Pixel buckets to render
   * @param matchedEventIds - Set of matched event IDs (format: "timestamp-depth-index")
   */
  private renderBucketsWithSearch(
    buckets: PixelBucket[],
    matchedEventIds: ReadonlySet<string>,
  ): void {
    if (buckets.length === 0) {
      return;
    }

    // Build a lookup set of "timestamp-depth" for O(1) matching
    // matchedEventIds format: "timestamp-depth-index"
    const matchedTimestampDepths = new Set<string>();
    for (const matchedId of matchedEventIds) {
      const parts = matchedId.split('-');
      if (parts.length >= 2) {
        // Store "timestamp-depth" for fast lookup
        matchedTimestampDepths.add(`${parts[0]}-${parts[1]}`);
      }
    }

    const blockWidth = BUCKET_CONSTANTS.BUCKET_BLOCK_WIDTH;
    const eventHeight = TIMELINE_CONSTANTS.EVENT_HEIGHT;
    const gap = TIMELINE_CONSTANTS.RECT_GAP;
    const halfGap = gap / 2;

    // Draw each bucket, checking if it contains any matched events
    for (const bucket of buckets) {
      // Find all matched events in this bucket and build category stats
      const matchedCategoryStats = new Map<string, CategoryAggregation>();

      for (const event of bucket.eventRefs) {
        const key = `${event.timestamp}-${bucket.depth}`;
        if (matchedTimestampDepths.has(key) && event.subCategory) {
          let stats = matchedCategoryStats.get(event.subCategory);
          if (!stats) {
            stats = { count: 0, totalDuration: 0 };
            matchedCategoryStats.set(event.subCategory, stats);
          }
          stats.count++;
          stats.totalDuration += event.duration?.total ?? 0;
        }
      }

      let displayColor: number;

      if (matchedCategoryStats.size > 0) {
        // Resolve color from matched events using priority rules
        const colorResult = resolveColor({
          byCategory: matchedCategoryStats,
          dominantCategory: '',
        });
        displayColor = colorResult.color;
      } else {
        // No matches - desaturate the bucket's original color
        displayColor = this.colorToGreyscale(bucket.color);
      }

      this.bucketGraphics.setFillStyle({
        color: displayColor,
        alpha: bucket.opacity,
      });

      const gappedX = bucket.x + halfGap;
      const gappedY = bucket.y + halfGap;
      const gappedHeight = Math.max(0, eventHeight - gap);

      this.bucketGraphics.rect(gappedX, gappedY, blockWidth, gappedHeight);
      this.bucketGraphics.fill();
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
