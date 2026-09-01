/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * MinimapDensityQuery
 *
 * Computes density data for the minimap visualization by leveraging
 * the existing RectangleCache's spatial index.
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
 * Example: SOQL at depth 2 covers 0-100ms with Apex child at depth 3 covering 30-80ms
 * - SOQL is on-top at 0-30ms and 80-100ms = 50ms total (50%)
 * - Apex is on-top at 30-80ms = 50ms total (50%)
 * - With weights: SOQL = 50% × 2.5 = 125, Apex = 50% × 1.0 = 50
 * - SOQL wins because its weighted score is higher
 */

import type { BucketCategoryPriority } from '../../types/flamechart.types.js';
import type { TemporalSegmentTree } from '../TemporalSegmentTree.js';
import { MinimapSkylineIndex } from './MinimapSkylineIndex.js';

/**
 * Single density bucket for minimap visualization.
 */
export interface MinimapDensityBucket {
  /** Highest depth at this time range (for height calculation). */
  maxDepth: number;

  /** Total events in this bucket (for opacity calculation). */
  eventCount: number;

  /** Dominant category for color resolution. */
  dominantCategory: string;
}

/**
 * Complete density data for minimap rendering.
 *
 * A bucket carries no time range: the renderer takes a bar's X from the bucket's
 * index, so the times were derivable and unread.
 */
export interface MinimapDensityData {
  /** One bucket per pixel of the minimap's width. */
  buckets: MinimapDensityBucket[];

  /** Global maximum depth across entire timeline. */
  globalMaxDepth: number;
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
const CATEGORY_WEIGHTS: Partial<Record<BucketCategoryPriority, number>> = {
  DML: 2.5,
  SOQL: 2.5,
  Callout: 1.5,
  Apex: 1.0,
  'Code Unit': 1.0,
  System: 0.8,
  Automation: 0.8,
  Validation: 0.8,
};

/** Segment category id 0: no frame on top. */
const GAP_CATEGORY = 0;

/** What a bucket with nothing on top reports, as the old sweep's default did. */
const DEFAULT_CATEGORY = 'Apex';

export class MinimapDensityQuery {
  /** Global maximum depth across timeline. */
  private globalMaxDepth: number;

  /** Total duration in nanoseconds. */
  private totalDuration: number;

  /**
   * The one density held, and the bucket count it was computed for.
   *
   * One width at a time: every caller asks for the width on screen, and a density holds a
   * bucket per pixel of it, so keeping the widths a drag passed through would cost more memory
   * than the recompute it saves.
   *
   * Nothing invalidates it, and nothing needs to: a new width misses on its own, a height
   * change leaves the entry as true as it was, a theme change cannot alter a category name,
   * and new data means a new query object.
   */
  private cachedBucketCount: number | null = null;
  private cachedDensity: MinimapDensityData | null = null;

  /** The log seen from above, built on the first query and never rebuilt. */
  private index: MinimapSkylineIndex | null = null;

  /** Scratch for the walk, one slot per category id. Sized with the index. */
  private weights = new Float64Array(0);
  private accumulated = new Float64Array(0);
  private onTopOrder = new Int32Array(0);

  /** The frames every density is computed from. */
  private segmentTree: TemporalSegmentTree;

  constructor(segmentTree: TemporalSegmentTree, totalDuration: number, maxDepth: number) {
    this.segmentTree = segmentTree;
    this.totalDuration = totalDuration;
    this.globalMaxDepth = maxDepth;
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
    // bucketCount is the display width from getBoundingClientRect(), which is
    // fractional under non-integer OS display scaling (Windows 125%/150% DPI).
    // A fractional/NaN count crashes the Array/typed-array constructors below
    // with "Invalid array length" (the `<= 0` guards do not catch it), which
    // aborts timeline init and leaves interaction handlers unwired. Normalise
    // here, the single entry point feeding both the compute and the cache.
    bucketCount = Number.isFinite(bucketCount) ? Math.floor(bucketCount) : 0;

    // Fast path: exact match in cache
    if (this.cachedDensity !== null && this.cachedBucketCount === bucketCount) {
      return this.cachedDensity;
    }

    const density = this.computeDensity(bucketCount);
    this.cachedBucketCount = bucketCount;
    this.cachedDensity = density;
    return density;
  }

  // ============================================================================
  // PRIVATE: DENSITY COMPUTATION
  // ============================================================================

  /**
   * Compute density data by walking the skyline against the buckets.
   *
   * Both are ordered by time, so one pass over each: per bucket, every segment
   * overlapping it adds its own length to that category's total, and the deepest
   * segment gives the bar its height. A segment reaching past the bucket's end is
   * left for the next bucket, so each is visited once plus once per boundary it
   * crosses. Nothing is allocated per bucket.
   *
   * @param bucketCount - Number of output buckets
   * @returns MinimapDensityData
   */
  private computeDensity(bucketCount: number): MinimapDensityData {
    if (bucketCount <= 0 || this.totalDuration <= 0) {
      return { buckets: [], globalMaxDepth: this.globalMaxDepth };
    }

    const skyline = this.skyline();
    const { segmentCount, segmentStarts, segmentDepths, segmentCategories, categoryNames } =
      skyline;
    const accumulated = this.accumulated;
    const onTopOrder = this.onTopOrder;
    const weights = this.weights;

    const bucketTimeWidth = this.totalDuration / bucketCount;
    const eventCounts = this.countFrames(skyline, bucketCount, bucketTimeWidth);
    const buckets: MinimapDensityBucket[] = new Array(bucketCount);

    let segment = 0;
    for (let i = 0; i < bucketCount; i++) {
      const bucketStart = i * bucketTimeWidth;
      const bucketEnd = (i + 1) * bucketTimeWidth;

      // Only fires where a segment ends exactly on the boundary.
      while (segment < segmentCount && segmentStarts[segment + 1]! <= bucketStart) {
        segment++;
      }

      // The segments tile, so the segment holding `bucketStart` starts at or before
      // it: this is the left-hand partial, with no clamp needed.
      let from = bucketStart;
      let maxDepth = 0;
      let ordered = 0;

      while (segment < segmentCount && segmentStarts[segment]! < bucketEnd) {
        const segmentEnd = segmentStarts[segment + 1]!;
        const to = segmentEnd < bucketEnd ? segmentEnd : bucketEnd;
        const category = segmentCategories[segment]!;

        if (category !== GAP_CATEGORY && to > from) {
          // First on top wins a tie, which is the order the old sweep's map held.
          if (accumulated[category] === 0) {
            onTopOrder[ordered++] = category;
          }
          accumulated[category]! += to - from;
          const depth = segmentDepths[segment]!;
          if (depth > maxDepth) {
            maxDepth = depth;
          }
        }

        if (segmentEnd >= bucketEnd) {
          break; // Straddles the end: the next bucket starts on this same segment.
        }
        from = segmentEnd;
        segment++;
      }

      let winner = GAP_CATEGORY;
      let best = -1;
      for (let at = 0; at < ordered; at++) {
        const category = onTopOrder[at]!;
        const score = accumulated[category]! * weights[category]!;
        if (score > best) {
          best = score;
          winner = category;
        }
        accumulated[category] = 0;
      }

      buckets[i] = {
        maxDepth,
        eventCount: eventCounts[i]!,
        dominantCategory: winner === GAP_CATEGORY ? DEFAULT_CATEGORY : categoryNames[winner]!,
      };
    }

    return { buckets, globalMaxDepth: this.globalMaxDepth };
  }

  /**
   * Count the frames overlapping each bucket, by difference array.
   *
   * A frame adds one to the bucket it starts in and takes one back after the
   * bucket it ends in, so a running total gives every bucket its count in one
   * pass. The bucket arithmetic is the old loop's, including that a frame ending
   * exactly on a boundary counts in the bucket after it: this feeds the bar's
   * opacity, which stays as it was.
   */
  private countFrames(
    skyline: MinimapSkylineIndex,
    bucketCount: number,
    bucketTimeWidth: number,
  ): Uint32Array {
    const { frameStarts, frameEnds } = skyline;
    const deltas = new Int32Array(bucketCount + 1);
    const lastBucket = bucketCount - 1;

    for (let i = 0; i < frameStarts.length; i++) {
      let first = Math.floor(frameStarts[i]! / bucketTimeWidth);
      if (first < 0) {
        first = 0;
      }
      let last = Math.floor(frameEnds[i]! / bucketTimeWidth);
      if (last > lastBucket) {
        last = lastBucket;
      }
      if (last < first) {
        continue;
      }
      deltas[first]!++;
      deltas[last + 1]!--;
    }

    const counts = new Uint32Array(bucketCount);
    let running = 0;
    for (let b = 0; b < bucketCount; b++) {
      running += deltas[b]!;
      counts[b] = running;
    }
    return counts;
  }

  /**
   * The skyline, built on the first query.
   *
   * Not in the constructor: the tree sorts its frames on first use, and the
   * timeline defers that cost off its own init.
   */
  private skyline(): MinimapSkylineIndex {
    let index = this.index;
    if (!index) {
      index = new MinimapSkylineIndex(
        this.segmentTree.getAllFramesSorted(),
        this.totalDuration,
        this.globalMaxDepth,
      );
      this.index = index;

      // One weight per category id, so the argmax needs no string lookup.
      const names = index.categoryNames;
      this.weights = new Float64Array(names.length);
      for (let id = 1; id < names.length; id++) {
        this.weights[id] = CATEGORY_WEIGHTS[names[id] as BucketCategoryPriority] ?? 1.0;
      }
      this.accumulated = new Float64Array(names.length);
      this.onTopOrder = new Int32Array(names.length);
    }
    return index;
  }
}
