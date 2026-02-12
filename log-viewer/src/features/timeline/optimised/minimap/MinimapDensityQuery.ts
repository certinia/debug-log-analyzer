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
 * - Cache density data (only recompute on data change)
 * - <50ms cold query, <0.1ms cached
 * - No allocations in render loop
 *
 * Category Resolution: Skyline (On-Top Time) Algorithm
 * At each moment within a bucket, the deepest frame is "on top" (visible).
 * This correctly handles parent frames whose self-duration is concentrated
 * at edges (not covered by children), rather than evenly distributed.
 *
 * Formula:
 *   onTopTime[category] = sum of time each category is deepest in the bucket
 *   score[category] = onTopTime[category] × CATEGORY_WEIGHTS[category]
 *   winner = argmax(score)
 *
 * Example: SOQL at depth 2 covers 0-100ms with Method child at depth 3 covering 30-80ms
 * - SOQL is on-top at 0-30ms and 80-100ms = 50ms total (50%)
 * - Method is on-top at 30-80ms = 50ms total (50%)
 * - With weights: SOQL = 50% × 2.5 = 125, Method = 50% × 1.0 = 50
 * - SOQL wins because its weighted score is higher
 */

import type { PrecomputedRect } from '../RectangleManager.js';
import type { SkylineFrame, TemporalSegmentTree } from '../TemporalSegmentTree.js';

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
  'System Method': 0.8,
  Flow: 0.8,
  Workflow: 0.8,
};

/**
 * Event type for skyline sweep-line algorithm.
 * 0 = frame start (enter), 1 = frame end (exit)
 */
const SkylineEventType = {
  Enter: 0,
  Exit: 1,
} as const;

type SkylineEventType = (typeof SkylineEventType)[keyof typeof SkylineEventType];

/**
 * Skyline event for sweep-line algorithm.
 * Reused via object pool to avoid allocations.
 */
interface SkylineEvent {
  time: number;
  type: SkylineEventType;
  frame: SkylineFrame;
}

export class MinimapDensityQuery {
  /** All rectangles grouped by category from RectangleManager. */
  private rectsByCategory: Map<string, PrecomputedRect[]>;

  /** Global maximum depth across timeline. */
  private globalMaxDepth: number;

  /** Total duration in nanoseconds. */
  private totalDuration: number;

  /**
   * Simple cache for exact bucket count.
   * Key: bucket count
   * Value: computed density data
   *
   * Invalidated when data changes. No multi-resolution downscaling needed
   * since we compute at exact bucket count with O(B × log N) complexity.
   */
  private densityCache: Map<number, MinimapDensityData> = new Map();

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
   * Computes at exact bucket count using O(B × log N) tree queries.
   * Results are cached for the exact bucket count requested.
   *
   * @param bucketCount - Number of density buckets (typically display width)
   * @returns MinimapDensityData for rendering
   */
  public query(bucketCount: number): MinimapDensityData {
    // Fast path: exact match in cache
    const cached = this.densityCache.get(bucketCount);
    if (cached) {
      return cached;
    }

    // Compute at exact bucket count using sliding window algorithm if tree available
    const density = this.segmentTree
      ? this.computeDensitySlidingWindow(bucketCount)
      : this.computeDensity(bucketCount);

    this.densityCache.set(bucketCount, density);
    return density;
  }

  /**
   * Invalidate cache (call when timeline data changes).
   */
  public invalidateCache(): void {
    this.densityCache.clear();
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
   * Fallback when segment tree is not available.
   * Uses skyline (on-top time) algorithm for category resolution:
   * At each moment, the deepest frame is "on top" and its category accumulates time.
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

        // Pre-calculate rect duration for overlap ratio
        const rectDuration = rect.timeEnd - rect.timeStart;

        // Create frame for skyline computation
        const frame: SkylineFrame = {
          timeStart: rect.timeStart,
          timeEnd: rect.timeEnd,
          depth: rect.depth,
          category: rect.category,
          selfDuration: rect.selfDuration,
        };

        // Aggregate into each overlapping bucket
        for (let b = firstBucket; b <= lastBucket; b++) {
          // Update max depth
          if (rect.depth > maxDepths[b]!) {
            maxDepths[b] = rect.depth;
          }

          // Increment event count
          eventCounts[b]!++;

          // Calculate overlap ratio for proportional self-duration attribution (for sparkline)
          const bucketStart = b * bucketTimeWidth;
          const bucketEnd = (b + 1) * bucketTimeWidth;
          const overlapStart = Math.max(rect.timeStart, bucketStart);
          const overlapEnd = Math.min(rect.timeEnd, bucketEnd);
          const visibleTime = overlapEnd - overlapStart;
          const overlapRatio = rectDuration > 0 ? visibleTime / rectDuration : 0;
          const proportionalSelfDuration = rect.selfDuration * overlapRatio;
          selfDurationSums[b]! += proportionalSelfDuration;

          // Collect frame for skyline computation
          framesPerBucket[b]!.push(frame);
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

      // Resolve dominant category using skyline (on-top time) algorithm
      const dominantCategory = this.resolveCategoryFromSkyline(
        framesPerBucket[i]!,
        bucketStart,
        bucketEnd,
      );

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
   * Compute density data using sliding window algorithm on pre-sorted frames.
   * Uses skyline (on-top time) algorithm for category resolution:
   * At each moment, the deepest frame is "on top" and its category accumulates time.
   *
   * Performance improvement over computeDensityFromTree():
   * - Previous: O(B × D × log N) tree queries per bucket = ~90ms
   * - New: O(N) single pass + O(B × k) skyline computation = ~10-20ms
   *   (where k = avg frames per bucket, much smaller than N)
   *
   * @param bucketCount - Number of output buckets
   * @returns MinimapDensityData
   */
  private computeDensitySlidingWindow(bucketCount: number): MinimapDensityData {
    if (bucketCount <= 0 || this.totalDuration <= 0 || !this.segmentTree) {
      return {
        buckets: [],
        globalMaxDepth: this.globalMaxDepth,
        maxEventCount: 0,
        totalDuration: this.totalDuration,
      };
    }

    const frames = this.segmentTree.getAllFramesSorted();
    const bucketTimeWidth = this.totalDuration / bucketCount;

    // Pre-allocate bucket arrays
    const maxDepths = new Uint16Array(bucketCount);
    const eventCounts = new Uint32Array(bucketCount);
    const selfDurationSums = new Float64Array(bucketCount);

    // Collect frames per bucket for skyline computation
    const framesPerBucket: SkylineFrame[][] = new Array(bucketCount);
    for (let i = 0; i < bucketCount; i++) {
      framesPerBucket[i] = [];
    }

    // Single pass: compute maxDepth, eventCount, selfDurationSums, and collect frames
    for (const frame of frames) {
      const startBucket = Math.max(0, Math.floor(frame.timeStart / bucketTimeWidth));
      const endBucket = Math.min(bucketCount - 1, Math.floor(frame.timeEnd / bucketTimeWidth));

      // Pre-calculate frame duration for overlap ratio
      const frameDuration = frame.timeEnd - frame.timeStart;

      for (let b = startBucket; b <= endBucket; b++) {
        // Update maxDepth
        if (frame.depth > maxDepths[b]!) {
          maxDepths[b] = frame.depth;
        }

        // Increment event count
        eventCounts[b]!++;

        // Calculate overlap ratio for proportional self-duration attribution (for sparkline)
        const bucketStart = b * bucketTimeWidth;
        const bucketEnd = (b + 1) * bucketTimeWidth;
        const overlapStart = Math.max(frame.timeStart, bucketStart);
        const overlapEnd = Math.min(frame.timeEnd, bucketEnd);
        const visibleTime = overlapEnd - overlapStart;
        const overlapRatio = frameDuration > 0 ? visibleTime / frameDuration : 0;
        const proportionalSelfDuration = frame.selfDuration * overlapRatio;
        selfDurationSums[b]! += proportionalSelfDuration;

        // Collect frame for skyline computation
        framesPerBucket[b]!.push(frame);
      }
    }

    // Build output buckets
    const buckets: MinimapDensityBucket[] = new Array(bucketCount);
    let maxEventCount = 0;

    for (let i = 0; i < bucketCount; i++) {
      const eventCount = eventCounts[i]!;
      if (eventCount > maxEventCount) {
        maxEventCount = eventCount;
      }

      const bucketStart = i * bucketTimeWidth;
      const bucketEnd = (i + 1) * bucketTimeWidth;

      // Resolve dominant category using skyline (on-top time) algorithm
      const dominantCategory = this.resolveCategoryFromSkyline(
        framesPerBucket[i]!,
        bucketStart,
        bucketEnd,
      );

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
   * Compute density data using per-bucket tree queries.
   * O(B × log N) complexity - for each bucket, query the segment tree.
   *
   * Key insight: queryBucketStats() traverses tree branches, not leaves.
   * For a bucket covering 1/1024 of the timeline, it visits O(log N) nodes.
   *
   * Note: Currently unused but retained for potential future optimizations.
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

    // Query each bucket using the segment tree
    for (let b = 0; b < bucketCount; b++) {
      const bucketStart = b * bucketTimeWidth;
      const bucketEnd = (b + 1) * bucketTimeWidth;

      // Use tree query - O(log N) traversal per bucket
      const stats = this.segmentTree.queryBucketStats(bucketStart, bucketEnd);

      if (stats.eventCount > maxEventCount) {
        maxEventCount = stats.eventCount;
      }

      // Resolve dominant category using skyline (on-top time) algorithm
      const dominantCategory = this.resolveCategoryFromSkyline(
        stats.frames,
        bucketStart,
        bucketEnd,
      );

      buckets[b] = {
        timeStart: bucketStart,
        timeEnd: bucketEnd,
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

  // ============================================================================
  // SKYLINE ALGORITHM: On-Top Time Category Resolution
  // ============================================================================

  /**
   * Compute dominant category using skyline (on-top time) algorithm.
   *
   * At each moment within the bucket, the deepest frame is "on top" (visible).
   * This correctly handles the case where a parent frame's self-duration is
   * concentrated at the edges (parts not covered by children), not evenly
   * distributed across the frame's time range.
   *
   * Algorithm: Sweep-line with depth tracking
   * 1. Create enter/exit events for each frame
   * 2. Sort events by time
   * 3. Sweep through, tracking which frame is deepest at each moment
   * 4. Accumulate on-top time per category
   * 5. Apply CATEGORY_WEIGHTS to determine winner
   *
   * PERF: Uses Set for O(1) add/remove instead of indexOf+splice (O(k²) → O(k)).
   * PERF: Tracks max depth incrementally to avoid rescanning on every frame exit.
   *
   * @param frames - Frames overlapping this bucket
   * @param bucketStart - Bucket start time
   * @param bucketEnd - Bucket end time
   * @returns Dominant category for this bucket
   */
  private resolveCategoryFromSkyline(
    frames: SkylineFrame[],
    bucketStart: number,
    bucketEnd: number,
  ): string {
    // Fast path: no frames
    if (frames.length === 0) {
      return 'Method';
    }

    // Fast path: single frame
    if (frames.length === 1) {
      return frames[0]!.category;
    }

    // Fast path: all same category - no need to compute skyline
    const firstCategory = frames[0]!.category;
    let allSameCategory = true;
    for (let i = 1; i < frames.length; i++) {
      if (frames[i]!.category !== firstCategory) {
        allSameCategory = false;
        break;
      }
    }
    if (allSameCategory) {
      return firstCategory;
    }

    // Build sweep-line events
    const events: SkylineEvent[] = [];
    for (const frame of frames) {
      // Clamp frame to bucket bounds
      const clampedStart = Math.max(frame.timeStart, bucketStart);
      const clampedEnd = Math.min(frame.timeEnd, bucketEnd);

      if (clampedStart < clampedEnd) {
        events.push({ time: clampedStart, type: SkylineEventType.Enter, frame });
        events.push({ time: clampedEnd, type: SkylineEventType.Exit, frame });
      }
    }

    // Sort events by time, exits before enters at same time
    events.sort((a, b) => {
      if (a.time !== b.time) return a.time - b.time;
      // Process exits before enters at the same time
      return a.type - b.type;
    });

    // Sweep through events tracking on-top time per category
    // PERF: Use Set for O(1) add/remove instead of array indexOf+splice
    const onTopTime = new Map<string, number>();
    const activeFrames = new Set<SkylineFrame>();
    let currentMaxDepth = -1;
    let currentDeepestFrame: SkylineFrame | null = null;
    let lastTime = bucketStart;

    for (const event of events) {
      const currentTime = event.time;

      // Accumulate on-top time for the deepest frame since lastTime
      if (currentDeepestFrame && currentTime > lastTime) {
        const duration = currentTime - lastTime;
        const existing = onTopTime.get(currentDeepestFrame.category) ?? 0;
        onTopTime.set(currentDeepestFrame.category, existing + duration);
      }

      lastTime = currentTime;

      // Update active frames
      if (event.type === SkylineEventType.Enter) {
        activeFrames.add(event.frame);
        // Update max depth tracking if this frame is deeper
        if (event.frame.depth > currentMaxDepth) {
          currentMaxDepth = event.frame.depth;
          currentDeepestFrame = event.frame;
        }
      } else {
        activeFrames.delete(event.frame); // O(1) instead of O(k)
        // Only recompute max if we removed the deepest frame
        if (event.frame === currentDeepestFrame) {
          currentMaxDepth = -1;
          currentDeepestFrame = null;
          for (const f of activeFrames) {
            if (f.depth > currentMaxDepth) {
              currentMaxDepth = f.depth;
              currentDeepestFrame = f;
            }
          }
        }
      }
    }

    // Apply category weights and find winner
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
