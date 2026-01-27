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
 * Frame data needed for skyline computation.
 */
interface SkylineFrame {
  timeStart: number;
  timeEnd: number;
  depth: number;
  category: string;
}

/**
 * Event for sweep line algorithm in skyline computation.
 */
interface SkylineEvent {
  time: number;
  isStart: boolean;
  depth: number;
  category: string;
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
   * Uses skyline algorithm to determine which category is "on top" (deepest)
   * at each moment within each bucket.
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

    // Collect frames per bucket for skyline computation
    const framesPerBucket: SkylineFrame[][] = new Array(bucketCount);
    for (let i = 0; i < bucketCount; i++) {
      framesPerBucket[i] = [];
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

          // Calculate overlap ratio for proportional self-duration attribution
          const bucketStart = b * bucketTimeWidth;
          const bucketEnd = (b + 1) * bucketTimeWidth;
          const overlapStart = Math.max(rect.timeStart, bucketStart);
          const overlapEnd = Math.min(rect.timeEnd, bucketEnd);
          const visibleTime = overlapEnd - overlapStart;
          const rectDuration = rect.timeEnd - rect.timeStart;
          const overlapRatio = rectDuration > 0 ? visibleTime / rectDuration : 0;
          selfDurationSums[b]! += rect.selfDuration * overlapRatio;

          // Collect frame for skyline computation
          framesPerBucket[b]!.push({
            timeStart: rect.timeStart,
            timeEnd: rect.timeEnd,
            depth: rect.depth,
            category: rect.category,
          });
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

      const bucketStart = i * bucketTimeWidth;
      const bucketEnd = (i + 1) * bucketTimeWidth;
      const bucketFrames = framesPerBucket[i]!;

      // Resolve dominant category using skyline algorithm
      let dominantCategory: string;
      if (bucketFrames.length === 0) {
        dominantCategory = 'Method';
      } else if (bucketFrames.length === 1 || this.allSameCategory(bucketFrames)) {
        // Single category: no competition needed
        dominantCategory = bucketFrames[0]!.category;
      } else {
        // Multiple categories: compute skyline to find "on top" time per category
        const onTopTime = this.computeSkyline(bucketFrames, bucketStart, bucketEnd);
        dominantCategory = this.resolveCategoryFromSkyline(onTopTime);
      }

      buckets[i] = {
        timeStart: bucketStart,
        timeEnd: bucketEnd,
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
   * Uses skyline algorithm to determine which category is "on top" (deepest).
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

      // Query tree for stats and frames in this bucket's time range
      const stats = this.segmentTree.queryBucketStats(timeStart, timeEnd);

      if (stats.eventCount > maxEventCount) {
        maxEventCount = stats.eventCount;
      }

      // Resolve dominant category using skyline algorithm
      let dominantCategory: string;
      if (stats.frames.length === 0) {
        dominantCategory = 'Method';
      } else if (stats.frames.length === 1 || this.allSameCategory(stats.frames)) {
        // Single category: no competition needed
        dominantCategory = stats.frames[0]!.category;
      } else {
        // Multiple categories: compute skyline to find "on top" time per category
        const onTopTime = this.computeSkyline(stats.frames, timeStart, timeEnd);
        dominantCategory = this.resolveCategoryFromSkyline(onTopTime);
      }

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
   * Compute "on top" time per category using skyline algorithm.
   * For each time point, determines which category is deepest (visually on top).
   *
   * @param frames - Frames overlapping the bucket
   * @param bucketStart - Bucket start time
   * @param bucketEnd - Bucket end time
   * @returns Map of category -> "on top" time in nanoseconds
   */
  private computeSkyline(
    frames: SkylineFrame[],
    bucketStart: number,
    bucketEnd: number,
  ): Map<string, number> {
    const onTopTime = new Map<string, number>();

    if (frames.length === 0) return onTopTime;

    if (frames.length === 1) {
      // Single frame: it's on top for its overlap with bucket
      const f = frames[0]!;
      const overlap = Math.min(f.timeEnd, bucketEnd) - Math.max(f.timeStart, bucketStart);
      if (overlap > 0) {
        onTopTime.set(f.category, overlap);
      }
      return onTopTime;
    }

    // Build events for sweep line
    const events: SkylineEvent[] = [];
    for (const f of frames) {
      const start = Math.max(f.timeStart, bucketStart);
      const end = Math.min(f.timeEnd, bucketEnd);
      if (start < end) {
        events.push({ time: start, isStart: true, depth: f.depth, category: f.category });
        events.push({ time: end, isStart: false, depth: f.depth, category: f.category });
      }
    }

    if (events.length === 0) return onTopTime;

    // Sort: by time, then ends before starts at same time
    events.sort((a, b) => a.time - b.time || (a.isStart ? 1 : -1));

    // Sweep line with active frames tracked by depth
    // Use array of {depth, category} to handle multiple frames at same depth
    const active: Array<{ depth: number; category: string }> = [];
    let prevTime = bucketStart;
    let prevDeepest = -1;
    let prevCategory = '';

    for (const event of events) {
      // Accumulate time for previous deepest category
      if (prevDeepest >= 0 && event.time > prevTime) {
        const duration = event.time - prevTime;
        onTopTime.set(prevCategory, (onTopTime.get(prevCategory) ?? 0) + duration);
      }

      // Update active set
      if (event.isStart) {
        active.push({ depth: event.depth, category: event.category });
      } else {
        // Remove the first matching entry (handles duplicates correctly)
        const idx = active.findIndex(
          (a) => a.depth === event.depth && a.category === event.category,
        );
        if (idx !== -1) {
          active.splice(idx, 1);
        }
      }

      // Find new deepest
      prevTime = event.time;
      prevDeepest = -1;
      prevCategory = '';
      for (const a of active) {
        if (a.depth > prevDeepest) {
          prevDeepest = a.depth;
          prevCategory = a.category;
        }
      }
    }

    return onTopTime;
  }

  /**
   * Check if all frames in array have the same category.
   */
  private allSameCategory(frames: SkylineFrame[]): boolean {
    if (frames.length <= 1) return true;
    const firstCategory = frames[0]!.category;
    for (let i = 1; i < frames.length; i++) {
      if (frames[i]!.category !== firstCategory) return false;
    }
    return true;
  }

  /**
   * Resolve dominant category from "on top" time using category weights.
   * The category with highest (onTopTime × categoryWeight) wins.
   */
  private resolveCategoryFromSkyline(onTopTime: Map<string, number>): string {
    let winningCategory = 'Method';
    let winningScore = -1;

    for (const [category, time] of onTopTime) {
      const weight = CATEGORY_WEIGHTS[category] ?? 1.0;
      const score = time * weight;
      if (score > winningScore) {
        winningScore = score;
        winningCategory = category;
      }
    }

    return winningCategory;
  }
}
