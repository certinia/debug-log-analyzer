/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * MinimapDensityQuery
 *
 * One bucket per pixel of the minimap's width, each carrying the three things
 * the renderer draws with: stack depth as the bar's height, frame count as its
 * opacity, and a category as its colour.
 *
 * Colour comes from the skyline, the log seen from above: at each instant the
 * deepest frame is the visible one, so a category earns a bucket by the time it
 * spends on top. Weights let a database operation still read through a shallower
 * child covering it.
 *
 *   score[category] = onTopTime[category] × CATEGORY_WEIGHTS[category]
 *   winner = argmax(score)
 *
 * The skyline itself does not depend on the width, so it is built once per log
 * (`MinimapSkylineIndex`) and every width walks it.
 *
 * Building it is ~73ms on a 95MB log, on the first minimap draw, which is over the
 * 50ms synchronous budget in `.claude/rules/log-viewer.md`. Accepted: it is paid
 * once per log, against the ~100ms it used to cost on every pixel of a width drag.
 */

import type { BucketCategoryPriority } from '../../types/flamechart.types.js';
import { GAP_CATEGORY, MinimapSkylineIndex, type SkylineFrame } from './MinimapSkylineIndex.js';

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
 * so on-top time becomes the deciding factor among them.
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

/**
 * What a bucket with nothing on top reports, as the old sweep's default did.
 *
 * Never drawn: such a bucket also has `maxDepth` 0, so `MinimapRenderer` skips its
 * bar. Kept while this change is measured against the old sweep bucket by bucket;
 * once that is done a gap can report nothing.
 */
const DEFAULT_CATEGORY = 'Apex';

export class MinimapDensityQuery {
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

  /**
   * The frames the skyline is built from, in groups each ascending by `timeStart`.
   * Owned by RectangleCache, which holds them for the timeline's life regardless.
   */
  private readonly frameGroups: readonly (readonly SkylineFrame[])[];
  private readonly totalDuration: number;
  private readonly globalMaxDepth: number;

  constructor(
    frameGroups: readonly (readonly SkylineFrame[])[],
    totalDuration: number,
    maxDepth: number,
  ) {
    this.frameGroups = frameGroups;
    this.totalDuration = totalDuration;
    this.globalMaxDepth = maxDepth;
  }

  /**
   * Query density data for minimap visualization.
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

  /**
   * Shape of the skyline, for `pnpm measure minimap`. Builds it if no query has.
   *
   * `violations` should be 0 on a well-formed log, so it is the tripwire on a real one.
   */
  public stats(): { segmentCount: number; violations: number } {
    const index = this.ensureSkyline();
    return { segmentCount: index.segmentCount, violations: index.violations };
  }

  /**
   * Compute density data by walking the skyline against the buckets.
   *
   * Both are ordered by time, so one pass over each: per bucket, every segment
   * overlapping it adds its own length to that category's total, and the deepest
   * segment gives the bar its height. A segment reaching past the bucket's end is
   * left for the next bucket, so each is visited once plus once per boundary it
   * crosses. The walk itself allocates nothing; the buckets it fills are the output.
   *
   * @param bucketCount - Number of output buckets
   * @returns MinimapDensityData
   */
  private computeDensity(bucketCount: number): MinimapDensityData {
    if (bucketCount <= 0 || this.totalDuration <= 0) {
      return { buckets: [], globalMaxDepth: this.globalMaxDepth };
    }

    const skyline = this.ensureSkyline();
    const { segmentCount, segmentStarts, segmentDepths, segmentCategories, categoryNames } =
      skyline;

    // One slot per category id, so the argmax needs no string lookup. Under 5KB:
    // the ids are interned per log, and no log has reached ten categories.
    const weights = new Float64Array(categoryNames.length);
    for (let id = 1; id < categoryNames.length; id++) {
      weights[id] = CATEGORY_WEIGHTS[categoryNames[id] as BucketCategoryPriority] ?? 1.0;
    }
    const accumulated = new Float64Array(categoryNames.length);
    const onTopOrder = new Int32Array(categoryNames.length);

    const bucketTimeWidth = this.totalDuration / bucketCount;
    const eventCounts = skyline.countFrames(bucketCount, bucketTimeWidth);
    const buckets: MinimapDensityBucket[] = new Array(bucketCount);

    let segment = 0;
    for (let i = 0; i < bucketCount; i++) {
      const bucketStart = i * bucketTimeWidth;
      const bucketEnd = (i + 1) * bucketTimeWidth;

      // The segments tile, so the segment holding `bucketStart` starts at or before
      // it: this is the left-hand partial, with no clamp needed.
      let from = bucketStart;
      let maxDepth = 0;
      let ordered = 0;

      // `from` already holds `segmentStarts[segment]` once the walk has advanced,
      // and equals `bucketStart` on entry, which the segments tile at or before.
      while (from < bucketEnd && segment < segmentCount) {
        const segmentEnd = segmentStarts[segment + 1]!;
        const to = segmentEnd < bucketEnd ? segmentEnd : bucketEnd;
        const category = segmentCategories[segment]!;

        if (category !== GAP_CATEGORY) {
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

        if (segmentEnd > bucketEnd) {
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
   * The skyline, built on the first query.
   *
   * Not in the constructor: the sort and the sweep are the timeline's largest
   * synchronous costs, and a log whose minimap is never drawn should not pay them.
   */
  private ensureSkyline(): MinimapSkylineIndex {
    return (this.index ??= new MinimapSkylineIndex(this.frameGroups, this.totalDuration));
  }
}
