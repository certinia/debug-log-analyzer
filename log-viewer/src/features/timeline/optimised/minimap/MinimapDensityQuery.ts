/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * MinimapDensityQuery
 *
 * Computes density data for the minimap visualization by leveraging
 * the existing RectangleManager's spatial index.
 *
 * The minimap displays a heatmap where:
 * - Height = normalized stack depth (maxDepth at bucket / global maxDepth)
 * - Opacity = event count (logarithmic scale)
 * - Color = dominant category color
 *
 * Performance requirements:
 * - Cache density data (only recompute on data change or resize)
 * - <5ms cold query, <0.1ms cached
 * - No allocations in render loop
 */

import type { PrecomputedRect } from '../RectangleManager.js';

/**
 * Single density bucket for minimap visualization.
 */
export interface MinimapDensityBucket {
  /** Bucket start time in nanoseconds. */
  timeStart: number;

  /** Bucket end time in nanoseconds. */
  timeEnd: number;

  /** Highest depth at this time range (for height calculation). */
  maxDepth: number;

  /** Total events in this bucket (for opacity calculation). */
  eventCount: number;

  /** Dominant category for color resolution. */
  dominantCategory: string;
}

/**
 * Complete density data for minimap rendering.
 */
export interface MinimapDensityData {
  /** Array of density buckets (one per minimap pixel approximately). */
  buckets: MinimapDensityBucket[];

  /** Global maximum depth across entire timeline. */
  globalMaxDepth: number;

  /** Global maximum event count in any bucket (for opacity normalization). */
  maxEventCount: number;

  /** Total duration of timeline in nanoseconds. */
  totalDuration: number;
}

/**
 * Priority map for category resolution.
 * DML and SOQL have highest priority (most important to highlight).
 */
const CATEGORY_PRIORITY: Record<string, number> = {
  DML: 0,
  SOQL: 1,
  Method: 2,
  'Code Unit': 3,
  'System Method': 4,
  Flow: 5,
  Workflow: 6,
};

export class MinimapDensityQuery {
  /** All rectangles grouped by category from RectangleManager. */
  private rectsByCategory: Map<string, PrecomputedRect[]>;

  /** Global maximum depth across timeline. */
  private globalMaxDepth: number;

  /** Total duration in nanoseconds. */
  private totalDuration: number;

  /** Cached density data (invalidated on resize). */
  private cachedDensityData: MinimapDensityData | null = null;

  /** Bucket count for cached data. */
  private cachedBucketCount: number = 0;

  constructor(
    rectsByCategory: Map<string, PrecomputedRect[]>,
    totalDuration: number,
    maxDepth: number,
  ) {
    this.rectsByCategory = rectsByCategory;
    this.totalDuration = totalDuration;
    this.globalMaxDepth = maxDepth;
  }

  /**
   * Query density data for minimap visualization.
   * Uses caching to avoid recomputation on every frame.
   *
   * @param bucketCount - Number of density buckets (typically display width)
   * @returns MinimapDensityData for rendering
   */
  public query(bucketCount: number): MinimapDensityData {
    // Return cached if bucket count unchanged
    if (this.cachedDensityData && bucketCount === this.cachedBucketCount) {
      return this.cachedDensityData;
    }

    // Compute fresh density data
    this.cachedDensityData = this.computeDensity(bucketCount);
    this.cachedBucketCount = bucketCount;

    return this.cachedDensityData;
  }

  /**
   * Invalidate cache (call when timeline data changes).
   */
  public invalidateCache(): void {
    this.cachedDensityData = null;
    this.cachedBucketCount = 0;
  }

  /**
   * Update underlying data (call when timeline changes).
   */
  public setData(
    rectsByCategory: Map<string, PrecomputedRect[]>,
    totalDuration: number,
    maxDepth: number,
  ): void {
    this.rectsByCategory = rectsByCategory;
    this.totalDuration = totalDuration;
    this.globalMaxDepth = maxDepth;
    this.invalidateCache();
  }

  // ============================================================================
  // PRIVATE: DENSITY COMPUTATION
  // ============================================================================

  /**
   * Compute density data by aggregating rectangles into buckets.
   * Uses a single pass through all rectangles for efficiency.
   *
   * @param bucketCount - Number of output buckets
   * @returns MinimapDensityData
   */
  private computeDensity(bucketCount: number): MinimapDensityData {
    if (bucketCount <= 0 || this.totalDuration <= 0) {
      return {
        buckets: [],
        globalMaxDepth: this.globalMaxDepth,
        maxEventCount: 0,
        totalDuration: this.totalDuration,
      };
    }

    // Pre-allocate bucket aggregation arrays
    const bucketTimeWidth = this.totalDuration / bucketCount;
    const maxDepths = new Uint16Array(bucketCount);
    const eventCounts = new Uint32Array(bucketCount);
    // Category stats: for each bucket, track category -> duration
    const categoryStats: Map<string, number>[] = new Array(bucketCount);
    for (let i = 0; i < bucketCount; i++) {
      categoryStats[i] = new Map();
    }

    // Single pass through all rectangles
    for (const rects of this.rectsByCategory.values()) {
      for (const rect of rects) {
        // Determine which bucket(s) this rect overlaps
        const startBucket = Math.floor(rect.timeStart / bucketTimeWidth);
        const endBucket = Math.floor(rect.timeEnd / bucketTimeWidth);

        // Clamp to valid bucket range
        const firstBucket = Math.max(0, startBucket);
        const lastBucket = Math.min(bucketCount - 1, endBucket);

        // Aggregate into each overlapping bucket
        for (let b = firstBucket; b <= lastBucket; b++) {
          // Update max depth
          if (rect.depth > maxDepths[b]!) {
            maxDepths[b] = rect.depth;
          }

          // Increment event count
          eventCounts[b]!++;

          // Accumulate category self-time (excludes children to show actual bottlenecks)
          const catStats = categoryStats[b]!;
          const existing = catStats.get(rect.category) ?? 0;
          catStats.set(rect.category, existing + rect.selfDuration);
        }
      }
    }

    // Build output buckets and find max event count
    let maxEventCount = 0;
    const buckets: MinimapDensityBucket[] = new Array(bucketCount);

    for (let i = 0; i < bucketCount; i++) {
      const eventCount = eventCounts[i]!;
      if (eventCount > maxEventCount) {
        maxEventCount = eventCount;
      }

      // Resolve dominant category
      const dominantCategory = this.resolveDominantCategory(categoryStats[i]!);

      buckets[i] = {
        timeStart: i * bucketTimeWidth,
        timeEnd: (i + 1) * bucketTimeWidth,
        maxDepth: maxDepths[i]!,
        eventCount,
        dominantCategory,
      };
    }

    return {
      buckets,
      globalMaxDepth: this.globalMaxDepth,
      maxEventCount,
      totalDuration: this.totalDuration,
    };
  }

  /**
   * Resolve dominant category from self-time stats.
   * Categories with most exclusive time win; priority is tiebreaker.
   *
   * This ensures actual bottlenecks are highlighted - a 1ms DML that triggers
   * a 100ms SOQL will show as SOQL (the actual work), not DML.
   */
  private resolveDominantCategory(categoryDurations: Map<string, number>): string {
    let winningCategory = 'Method'; // Default
    let winningDuration = -1;
    let winningPriority = Infinity;

    for (const [category, duration] of categoryDurations) {
      const priority = CATEGORY_PRIORITY[category] ?? Infinity;

      // Primary: highest self-time wins
      if (duration > winningDuration) {
        winningCategory = category;
        winningDuration = duration;
        winningPriority = priority;
      } else if (duration === winningDuration && priority < winningPriority) {
        // Tiebreaker: higher priority (lower number) wins
        winningCategory = category;
        winningPriority = priority;
      }
    }

    return winningCategory;
  }
}
