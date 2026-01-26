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
import type { TemporalSegmentTree } from '../TemporalSegmentTree.js';

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

  /** Sum of self-durations for events in this bucket (for sparkline). */
  selfDurationSum: number;
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
 * Category weights for importance-based resolution.
 * DML/SOQL are boosted to highlight database operations even when partially
 * covered by less important children. Other categories have uniform weight
 * so depth becomes the deciding factor among them.
 *
 * Balance: DML at 2.5x means it can win over a Method child 1-2 levels deeper,
 * but a child 5+ levels deeper will still dominate (depth² wins at larger gaps).
 */
const CATEGORY_WEIGHTS: Record<string, number> = {
  DML: 2.5,
  SOQL: 2.5,
  Method: 1.0,
  'Code Unit': 1.0,
  'System Method': 1.0,
  Flow: 1.0,
  Workflow: 1.0,
};

/**
 * Category stats for a single bucket, tracking depth-weighted visible time.
 * Depth weighting ensures deeper frames (visually on top in the flame chart)
 * dominate the color resolution.
 */
interface CategoryBucketStats {
  /** Combined depth + category weighted visible time */
  weightedTime: number;
  /** Maximum depth seen for this category (tiebreaker) */
  maxDepth: number;
}

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

  /** Optional segment tree for O(B×log N) density computation. */
  private segmentTree: TemporalSegmentTree | null = null;

  constructor(
    rectsByCategory: Map<string, PrecomputedRect[]>,
    totalDuration: number,
    maxDepth: number,
    segmentTree?: TemporalSegmentTree,
  ) {
    this.rectsByCategory = rectsByCategory;
    this.totalDuration = totalDuration;
    this.globalMaxDepth = maxDepth;
    this.segmentTree = segmentTree ?? null;
  }

  /**
   * Query density data for minimap visualization.
   * Uses caching to avoid recomputation on every frame.
   * Prefers O(B×log N) tree-based computation when segmentTree is available.
   *
   * @param bucketCount - Number of density buckets (typically display width)
   * @returns MinimapDensityData for rendering
   */
  public query(bucketCount: number): MinimapDensityData {
    // Return cached if bucket count unchanged
    if (this.cachedDensityData && bucketCount === this.cachedBucketCount) {
      return this.cachedDensityData;
    }

    // Compute fresh density data using tree-based algorithm if available
    this.cachedDensityData = this.segmentTree
      ? this.computeDensityFromTree(bucketCount)
      : this.computeDensity(bucketCount);
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
    segmentTree?: TemporalSegmentTree,
  ): void {
    this.rectsByCategory = rectsByCategory;
    this.totalDuration = totalDuration;
    this.globalMaxDepth = maxDepth;
    this.segmentTree = segmentTree ?? null;
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
    const selfDurationSums = new Float64Array(bucketCount);
    // Category stats: for each bucket, track category -> depth-weighted visible time
    const categoryStats: Map<string, CategoryBucketStats>[] = new Array(bucketCount);
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

          // Calculate actual visible time of this rect within this bucket.
          const bucketStart = b * bucketTimeWidth;
          const bucketEnd = (b + 1) * bucketTimeWidth;
          const overlapStart = Math.max(rect.timeStart, bucketStart);
          const overlapEnd = Math.min(rect.timeEnd, bucketEnd);
          const visibleTime = overlapEnd - overlapStart;

          // Calculate overlap ratio for proportional self-duration attribution
          const rectDuration = rect.timeEnd - rect.timeStart;
          const overlapRatio = rectDuration > 0 ? visibleTime / rectDuration : 0;
          selfDurationSums[b]! += rect.selfDuration * overlapRatio;

          // Combined weighting: depth² × category weight
          // - Depth²: deeper frames (visually on top) dominate their parents
          // - Category weight: important operations (DML/SOQL) get a 2.5x boost
          //
          // Example: DML at depth 1 (100ms) vs Method at depth 2 (100ms)
          //   DML:    100 × 4 × 2.5 = 1000
          //   Method: 100 × 9 × 1.0 = 900  → DML wins (important category)
          //
          // Example: DML at depth 5 (100ms) vs Flow at depth 12 (100ms)
          //   DML:  100 × 36 × 2.5 = 9000
          //   Flow: 100 × 169 × 1.0 = 16900 → Flow wins (much deeper)
          const depthWeight = (rect.depth + 1) * (rect.depth + 1);
          const categoryWeight = CATEGORY_WEIGHTS[rect.category] ?? 1.0;
          const weightedTime = visibleTime * depthWeight * categoryWeight;

          // Accumulate depth-weighted visible time for category resolution
          const catStats = categoryStats[b]!;
          const existing = catStats.get(rect.category);
          if (existing) {
            existing.weightedTime += weightedTime;
            if (rect.depth > existing.maxDepth) {
              existing.maxDepth = rect.depth;
            }
          } else {
            catStats.set(rect.category, { weightedTime, maxDepth: rect.depth });
          }
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
        selfDurationSum: selfDurationSums[i]!,
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
   * Compute density data using O(B×log N) tree-based queries.
   * Queries the segment tree once per bucket instead of iterating all rectangles.
   * This avoids the O(N×B) worst case where wide rectangles span all buckets.
   *
   * @param bucketCount - Number of output buckets
   * @returns MinimapDensityData
   */
  private computeDensityFromTree(bucketCount: number): MinimapDensityData {
    if (bucketCount <= 0 || this.totalDuration <= 0 || !this.segmentTree) {
      return {
        buckets: [],
        globalMaxDepth: this.globalMaxDepth,
        maxEventCount: 0,
        totalDuration: this.totalDuration,
      };
    }

    const bucketTimeWidth = this.totalDuration / bucketCount;
    const buckets: MinimapDensityBucket[] = new Array(bucketCount);
    let maxEventCount = 0;

    // Query segment tree for each bucket - O(B × log N)
    for (let i = 0; i < bucketCount; i++) {
      const timeStart = i * bucketTimeWidth;
      const timeEnd = (i + 1) * bucketTimeWidth;

      // Query tree for stats in this bucket's time range
      const stats = this.segmentTree.queryBucketStats(timeStart, timeEnd);

      if (stats.eventCount > maxEventCount) {
        maxEventCount = stats.eventCount;
      }

      // Apply category weights and resolve dominant category
      const weightedStats = this.applyWeightsToTreeStats(stats.categoryWeights);
      const dominantCategory = this.resolveDominantCategory(weightedStats);

      buckets[i] = {
        timeStart,
        timeEnd,
        maxDepth: stats.maxDepth,
        eventCount: stats.eventCount,
        dominantCategory,
        selfDurationSum: stats.selfDurationSum,
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
   * Apply category weights to tree-based stats.
   * The tree returns depth-weighted time; we need to multiply by category weights.
   */
  private applyWeightsToTreeStats(
    treeStats: Map<string, { weightedTime: number; maxDepth: number }>,
  ): Map<string, CategoryBucketStats> {
    const result = new Map<string, CategoryBucketStats>();

    for (const [category, stats] of treeStats) {
      const categoryWeight = CATEGORY_WEIGHTS[category] ?? 1.0;
      result.set(category, {
        weightedTime: stats.weightedTime * categoryWeight,
        maxDepth: stats.maxDepth,
      });
    }

    return result;
  }

  /**
   * Resolve dominant category from combined depth + category weighted stats.
   *
   * The category with the highest weighted score wins, where:
   *   score = visibleTime × depth² × categoryWeight
   *
   * This balances two concerns:
   * - Deeper frames (visually on top) generally dominate their parents
   * - Important categories (DML/SOQL at 2.5x) can win over shallow children
   *
   * In case of a tie, the category with the deepest frame wins.
   */
  private resolveDominantCategory(categoryStats: Map<string, CategoryBucketStats>): string {
    let winningCategory = 'Method'; // Default
    let winningScore = -1;
    let winningMaxDepth = -1;

    for (const [category, stats] of categoryStats) {
      // Primary: highest depth-weighted time
      // Secondary: deepest frame (tiebreaker)
      if (
        stats.weightedTime > winningScore ||
        (stats.weightedTime === winningScore && stats.maxDepth > winningMaxDepth)
      ) {
        winningCategory = category;
        winningScore = stats.weightedTime;
        winningMaxDepth = stats.maxDepth;
      }
    }

    return winningCategory;
  }
}
