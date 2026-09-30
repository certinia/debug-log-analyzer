/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * SearchBucketMatcher
 *
 * Pure utility functions for search-aware bucket color resolution.
 * Builds a spatial index of matched events by depth, then resolves
 * display colors for pixel buckets based on time-range overlap with matches.
 *
 * Extracted from MeshSearchStyleRenderer to enable reuse and independent testing.
 */

import type { CategoryAggregation, PixelBucket } from '../../types/flamechart.types.js';
import type { MatchedEventInfo } from '../../types/search.types.js';
import { type BatchColorInfo, resolveColor } from '../BucketColorResolver.js';
import { colorToGreyscale } from '../rendering/ColorUtils.js';

/**
 * Spatial index of matched events grouped by depth, each depth ordered by timestamp.
 */
export type MatchesByDepth = Map<number, ReadonlyArray<MatchedEventInfo>>;

/**
 * A search's matches do not change while the chart pans or zooms, but the renderer asks
 * for the index on every frame. Keyed on the array, so the entry falls away with the
 * search that produced it.
 */
const indexCache = new WeakMap<ReadonlyArray<MatchedEventInfo>, MatchesByDepth>();

/**
 * Build a spatial index of matched events grouped by tree depth.
 *
 * @param matchedEventsInfo - Lightweight info about matched events
 * @returns Map from depth to array of matched event positions
 */
export function buildMatchIndex(
  matchedEventsInfo: ReadonlyArray<MatchedEventInfo>,
): MatchesByDepth {
  const cached = indexCache.get(matchedEventsInfo);
  if (cached) {
    return cached;
  }

  const matchesByDepth = new Map<number, MatchedEventInfo[]>();
  for (const info of matchedEventsInfo) {
    let depthMatches = matchesByDepth.get(info.depth);
    if (!depthMatches) {
      depthMatches = [];
      matchesByDepth.set(info.depth, depthMatches);
    }
    depthMatches.push(info);
  }

  // Sorted so a bucket can seek its own time range, rather than every bucket reading
  // every match at its depth.
  for (const depthMatches of matchesByDepth.values()) {
    depthMatches.sort((a, b) => a.timestamp - b.timestamp);
  }

  indexCache.set(matchedEventsInfo, matchesByDepth);
  return matchesByDepth;
}

/** Index of the first match at or after `time`, or `matches.length` where there is none. */
function firstAtOrAfter(matches: ReadonlyArray<MatchedEventInfo>, time: number): number {
  let low = 0;
  let high = matches.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    const match = matches[mid];
    if (match && match.timestamp < time) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}

/**
 * Counts per category for the bucket being resolved. Reused across buckets: `resolveColor`
 * reads it and holds nothing, and a frame resolves one bucket at a time.
 */
const bucketCategoryStats = new Map<string, CategoryAggregation>();

/**
 * Resolve the display color for a bucket based on search match status.
 *
 * If any matched events overlap the bucket's time range at its depth,
 * the color is resolved from the matched category stats.
 * Otherwise, the bucket's pre-blended color is desaturated to greyscale.
 *
 * @param bucket - The pixel bucket to resolve color for
 * @param matchIndex - Spatial index from buildMatchIndex()
 * @param batchColors - Theme-aware category colors
 * @returns Resolved display color (0xRRGGBB)
 */
export function resolveBucketSearchColor(
  bucket: PixelBucket,
  matchIndex: MatchesByDepth,
  batchColors: Map<string, BatchColorInfo>,
): number {
  const depthMatches = matchIndex.get(bucket.depth);
  if (!depthMatches) {
    return colorToGreyscale(bucket.color);
  }

  bucketCategoryStats.clear();

  for (let i = firstAtOrAfter(depthMatches, bucket.timeStart); i < depthMatches.length; i++) {
    const match = depthMatches[i];
    if (!match || match.timestamp >= bucket.timeEnd) {
      break;
    }
    if (!match.category) {
      continue;
    }

    let stats = bucketCategoryStats.get(match.category);
    if (!stats) {
      stats = { count: 0, totalDuration: 0 };
      bucketCategoryStats.set(match.category, stats);
    }
    stats.count++;
  }

  if (bucketCategoryStats.size === 0) {
    return colorToGreyscale(bucket.color);
  }

  return resolveColor(
    {
      byCategory: bucketCategoryStats,
      dominantCategory: '',
    },
    batchColors,
  ).color;
}
