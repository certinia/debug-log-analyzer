/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

/**
 * LegacyViewportCuller
 *
 * O(n) viewport culling implementation extracted from RectangleManager.
 * Preserved as a thin facade for:
 * - Fallback option if segment tree issues arise
 * - Test compatibility with existing bucket tests
 *
 * For production use, prefer TemporalSegmentTree which provides O(log n) culling.
 */

import type { LogEvent } from '../../../core/log-parser/LogEvents.js';
import type {
  CategoryAggregation,
  CategoryStats,
  CulledRenderData,
  PixelBucket,
  RenderStats,
  ViewportState,
} from '../types/flamechart.types.js';
import { BUCKET_CONSTANTS, TIMELINE_CONSTANTS } from '../types/flamechart.types.js';
import { resolveColor, type BatchColorInfo } from './BucketColorResolver.js';
import { calculateBucketColor } from './BucketOpacity.js';
import type { PrecomputedRect } from './RectangleManager.js';
import { calculateViewportBounds } from './ViewportUtils.js';

/**
 * Perform O(n) viewport culling on pre-computed rectangles.
 *
 * Events > MIN_RECT_SIZE (2px) are returned as visible rectangles.
 * Events <= MIN_RECT_SIZE are aggregated into time-aligned buckets.
 *
 * @param rectsByCategory - Spatial index of rectangles by category
 * @param viewport - Current viewport state
 * @param batchColors - Optional colors from RenderBatch (for theme support)
 * @returns CulledRenderData with visible rectangles, buckets, and stats
 */
export function legacyCullRectangles(
  rectsByCategory: Map<string, PrecomputedRect[]>,
  viewport: ViewportState,
  batchColors?: Map<string, BatchColorInfo>,
): CulledRenderData {
  const bounds = calculateViewportBounds(viewport);
  const visibleRects = new Map<string, PrecomputedRect[]>();

  // Bucket aggregation: Map<compositeKey, bucket data>
  // Using integer key instead of string for performance: (depth << 24) | bucketIndex
  const bucketMap = new Map<
    number,
    {
      depth: number;
      bucketIndex: number;
      timeStart: number;
      timeEnd: number;
      events: LogEvent[];
      categoryStats: Map<string, CategoryAggregation>;
    }
  >();

  // Cache frequently accessed values as primitives
  const zoom = viewport.zoom;
  const boundsTimeStart = bounds.timeStart;
  const boundsTimeEnd = bounds.timeEnd;
  const depthStart = bounds.depthStart;
  const depthEnd = bounds.depthEnd;
  const minRectSize = TIMELINE_CONSTANTS.MIN_RECT_SIZE;
  const bucketWidth = BUCKET_CONSTANTS.BUCKET_WIDTH;
  const eventHeight = TIMELINE_CONSTANTS.EVENT_HEIGHT;

  // Calculate bucket time width (how much time fits in 2 pixels)
  const bucketTimeWidth = bucketWidth / zoom;

  // Stats tracking
  let visibleCount = 0;
  let bucketedEventCount = 0;
  let maxEventsPerBucket = 0;

  // Cull rectangles for each category
  for (const [category, rectangles] of rectsByCategory) {
    const culled: PrecomputedRect[] = [];
    const len = rectangles.length;

    for (let i = 0; i < len; i++) {
      const rect = rectangles[i]!;

      // Direct property access - avoid destructuring for performance
      const rectTimeStart = rect.timeStart;
      const rectTimeEnd = rect.timeEnd;
      const rectDepth = rect.depth;
      const rectDuration = rect.duration;

      // Early exit: rectangles are sorted by timeStart, so if we've
      // passed the viewport end, all remaining rectangles are also past it
      if (rectTimeStart >= boundsTimeEnd) {
        break;
      }

      // Skip rectangles that end before viewport starts
      if (rectTimeEnd <= boundsTimeStart) {
        continue;
      }

      // Depth culling
      if (rectDepth < depthStart || rectDepth > depthEnd) {
        continue;
      }

      // Calculate screen-space width
      const screenWidth = rectDuration * zoom;

      if (screenWidth > minRectSize) {
        // Visible rectangle: render normally
        rect.x = rectTimeStart * zoom;
        rect.width = screenWidth;
        culled.push(rect);
        visibleCount++;
      } else {
        // Sub-pixel event: aggregate into bucket
        const bucketIndex = Math.floor(rectTimeStart / bucketTimeWidth);
        // Composite integer key: depth in upper 8 bits, bucketIndex in lower 24 bits
        const bucketKey = (rectDepth << 24) | (bucketIndex & 0xffffff);

        let bucket = bucketMap.get(bucketKey);
        if (!bucket) {
          bucket = {
            depth: rectDepth,
            bucketIndex,
            timeStart: bucketIndex * bucketTimeWidth,
            timeEnd: (bucketIndex + 1) * bucketTimeWidth,
            events: [],
            categoryStats: new Map(),
          };
          bucketMap.set(bucketKey, bucket);
        }

        // Add event to bucket
        bucket.events.push(rect.eventRef);
        bucketedEventCount++;

        // Update category stats
        let catStats = bucket.categoryStats.get(category);
        if (!catStats) {
          catStats = { count: 0, totalDuration: 0 };
          bucket.categoryStats.set(category, catStats);
        }
        catStats.count++;
        catStats.totalDuration += rectDuration;
      }
    }

    if (culled.length > 0) {
      visibleRects.set(category, culled);
    }
  }

  // Convert bucket map to PixelBuckets grouped by dominant category
  const bucketsByCategory = new Map<string, PixelBucket[]>();

  // Pre-initialize with known categories
  for (const category of BUCKET_CONSTANTS.CATEGORY_PRIORITY) {
    bucketsByCategory.set(category, []);
  }

  let bucketCount = 0;
  for (const [key, bucket] of bucketMap) {
    const eventCount = bucket.events.length;
    maxEventsPerBucket = Math.max(maxEventsPerBucket, eventCount);

    // Build CategoryStats from aggregation
    const categoryStats: CategoryStats = {
      byCategory: bucket.categoryStats,
      dominantCategory: '',
    };

    // Resolve color and dominant category
    const colorResult = resolveColor(categoryStats, batchColors);

    // Pre-compute opaque blended color based on event density
    // This avoids runtime alpha blending for better GPU performance
    const blendedColor = calculateBucketColor(colorResult.color, eventCount);

    const pixelBucket: PixelBucket = {
      id: `bucket-${key}`,
      x: bucket.timeStart * zoom,
      y: bucket.depth * eventHeight,
      timeStart: bucket.timeStart,
      timeEnd: bucket.timeEnd,
      depth: bucket.depth,
      eventCount,
      categoryStats: {
        byCategory: bucket.categoryStats,
        dominantCategory: colorResult.dominantCategory,
      },
      eventRefs: bucket.events,
      color: blendedColor,
    };

    // Add to category group (skip unknown categories)
    const categoryBuckets = bucketsByCategory.get(colorResult.dominantCategory);
    if (categoryBuckets) {
      categoryBuckets.push(pixelBucket);
      bucketCount++;
    }
  }

  const stats: RenderStats = {
    visibleCount,
    bucketedEventCount,
    bucketCount,
    maxEventsPerBucket,
  };

  return { visibleRects, buckets: bucketsByCategory, stats };
}
