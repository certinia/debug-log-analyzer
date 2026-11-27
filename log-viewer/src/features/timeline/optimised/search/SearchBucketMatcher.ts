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
import type { MatchSpan } from '../../types/search.types.js';
import {
  type BatchColorInfo,
  UNKNOWN_CATEGORY_COLOR,
  categoryPriority,
} from '../BucketColorResolver.js';
import { colorToGreyscale } from '../rendering/ColorUtils.js';

// One depth's matches, ascending by start: a match's start and category share an index.
interface DepthMatches {
  readonly starts: Float64Array;
  readonly categories: readonly string[];
}

/**
 * Spatial index of matched events grouped by depth, each depth ordered by timestamp.
 */
export type MatchesByDepth = Map<number, DepthMatches>;

/** The renderer asks on every frame; `SearchCursorImpl` answers with the same array each time. */
const indexCache = new WeakMap<ReadonlyArray<MatchSpan>, MatchesByDepth>();

/**
 * Build a spatial index of matched events grouped by tree depth.
 *
 * @param spans - Where each matched frame sits
 * @returns Map from depth to its matches, ascending by start
 */
export function buildMatchIndex(spans: ReadonlyArray<MatchSpan>): MatchesByDepth {
  const cached = indexCache.get(spans);
  if (cached) {
    return cached;
  }

  const spansByDepth = new Map<number, MatchSpan[]>();
  for (const span of spans) {
    let depthSpans = spansByDepth.get(span.depth);
    if (!depthSpans) {
      depthSpans = [];
      spansByDepth.set(span.depth, depthSpans);
    }
    depthSpans.push(span);
  }

  const matchesByDepth: MatchesByDepth = new Map();
  for (const [depth, depthSpans] of spansByDepth) {
    depthSpans.sort((a, b) => a.timeStart - b.timeStart);
    matchesByDepth.set(depth, {
      starts: Float64Array.from(depthSpans, (span) => span.timeStart),
      categories: depthSpans.map((span) => span.category),
    });
  }

  indexCache.set(spans, matchesByDepth);
  return matchesByDepth;
}

function firstAtOrAfter(starts: Float64Array, time: number): number {
  let low = 0;
  let high = starts.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    // mid < high <= starts.length
    if (starts[mid]! < time) {
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
  bucket: Pick<PixelBucket, 'depth' | 'firstStart' | 'lastStart' | 'color'>,
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

  const { starts, categories } = depthMatches;
  for (let i = firstAtOrAfter(starts, bucket.firstStart); i < starts.length; i++) {
    // i < starts.length, and categories has the same length
    if (starts[i]! > bucket.lastStart) {
      break;
    }
    const category = categories[i]!;
    if (!category) {
      continue;
    }
    const priority = categoryPriority(category);
    if (!matched || priority < winningPriority) {
      winner = category;
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
