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
 * Spatial index of matched events grouped by depth.
 * Enables O(1) depth lookup + linear scan within a depth level.
 */
export type MatchesByDepth = Map<number, ReadonlyArray<{ timestamp: number; category: string }>>;

/**
 * Build a spatial index of matched events grouped by tree depth.
 *
 * @param matchedEventsInfo - Lightweight info about matched events
 * @returns Map from depth to array of matched event positions
 */
export function buildMatchIndex(
  matchedEventsInfo: ReadonlyArray<MatchedEventInfo>,
): MatchesByDepth {
  const matchesByDepth = new Map<number, Array<{ timestamp: number; category: string }>>();
  for (const info of matchedEventsInfo) {
    let depthMatches = matchesByDepth.get(info.depth);
    if (!depthMatches) {
      depthMatches = [];
      matchesByDepth.set(info.depth, depthMatches);
    }
    depthMatches.push({ timestamp: info.timestamp, category: info.category });
  }
  return matchesByDepth;
}

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
  const matchedCategoryStats = new Map<string, CategoryAggregation>();

  const depthMatches = matchIndex.get(bucket.depth);
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

  if (matchedCategoryStats.size > 0) {
    return resolveColor(
      {
        byCategory: matchedCategoryStats,
        dominantCategory: '',
      },
      batchColors,
    ).color;
  }

  return colorToGreyscale(bucket.color);
}
