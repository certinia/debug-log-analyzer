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

import type { PixelBucket } from '../../types/flamechart.types.js';
import type { MatchedEventInfo } from '../../types/search.types.js';
import {
  type BatchColorInfo,
  UNKNOWN_CATEGORY_COLOR,
  categoryPriority,
} from '../BucketColorResolver.js';
import { colorToGreyscale } from '../rendering/ColorUtils.js';

/**
 * Spatial index of matched events grouped by depth, each depth ordered by timestamp.
 */
export type MatchesByDepth = Map<number, ReadonlyArray<MatchedEventInfo>>;

/** The renderer asks on every frame; `SearchCursorImpl` answers with the same array each time. */
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

  for (const depthMatches of matchesByDepth.values()) {
    depthMatches.sort((a, b) => a.timestamp - b.timestamp);
  }

  indexCache.set(matchedEventsInfo, matchesByDepth);
  return matchesByDepth;
}

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
 * Colour for a bucket holding a match, or its own colour in greyscale where it holds none.
 *
 * The winner is tracked in place rather than through `resolveColor`, which needs a map of
 * per-category counts to answer the same question. Those counts cannot change the answer
 * here: `CATEGORY_PRIORITY` ranks every category distinctly, so the count tie-break is
 * unreachable, and the duration tie-break reads a total this path never sums. Categories
 * outside that list tie at `Infinity`, and `resolveColor` gives that tie to the first, so
 * the first match is taken as the winner to beat.
 */
export function resolveBucketSearchColor(
  bucket: Pick<PixelBucket, 'depth' | 'timeStart' | 'timeEnd' | 'color'>,
  matchIndex: MatchesByDepth,
  batchColors: Map<string, BatchColorInfo>,
): number {
  const depthMatches = matchIndex.get(bucket.depth);
  if (!depthMatches) {
    return colorToGreyscale(bucket.color);
  }

  let winner = '';
  let winningPriority = Infinity;
  let matched = false;

  for (let i = firstAtOrAfter(depthMatches, bucket.timeStart); i < depthMatches.length; i++) {
    const match = depthMatches[i];
    if (!match || match.timestamp >= bucket.timeEnd) {
      break;
    }
    if (!match.category) {
      continue;
    }
    const priority = categoryPriority(match.category);
    if (!matched || priority < winningPriority) {
      winner = match.category;
      winningPriority = priority;
    }
    matched = true;
  }

  if (!matched) {
    return colorToGreyscale(bucket.color);
  }

  return batchColors.get(winner)?.color ?? UNKNOWN_CATEGORY_COLOR;
}

/**
 * Colour for a bucket holding a frame of a lit category, or `undefined` where it holds none.
 * Several lit categories in one bucket: the one `CATEGORY_PRIORITY` ranks first wins.
 */
export function resolveBucketCategoryColor(
  bucket: Pick<PixelBucket, 'categoryStats'>,
  litCategories: ReadonlySet<string>,
  batchColors: Map<string, BatchColorInfo>,
): number | undefined {
  let winner: string | undefined;
  let winningPriority = Infinity;

  for (const category of litCategories) {
    if (!bucket.categoryStats.byCategory.has(category)) {
      continue;
    }
    const priority = categoryPriority(category);
    if (winner === undefined || priority < winningPriority) {
      winner = category;
      winningPriority = priority;
    }
  }

  if (winner === undefined) {
    return undefined;
  }
  return batchColors.get(winner)?.color ?? UNKNOWN_CATEGORY_COLOR;
}
