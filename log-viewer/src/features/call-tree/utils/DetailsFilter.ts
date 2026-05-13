/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { AggregatedRow, BottomUpRow } from './Aggregation.js';

export type AggregatedLikeRow = AggregatedRow | BottomUpRow;

export type DeepFilterable<T> = { id: string; _children?: T[] | null };

export const EXCLUDED_DETAIL_TYPES = new Set<string>([
  'CUMULATIVE_LIMIT_USAGE',
  'LIMIT_USAGE_FOR_NS',
  'CUMULATIVE_PROFILING',
  'CUMULATIVE_PROFILING_BEGIN',
]);

/**
 * Recursive id-cached deep filter for any tree row that exposes `id` + `_children`.
 * Returns true when `predicate(row)` is true OR any descendant matches; the
 * memoised result is stored on the shared `filterCache` so repeated lookups
 * within one filter pass are O(1).
 */
export function deepFilter<T extends DeepFilterable<T>>(
  rowData: T,
  predicate: (row: T) => boolean,
  filterCache: Map<string, boolean>,
): boolean {
  const cached = filterCache.get(rowData.id);
  if (cached !== undefined) {
    return cached;
  }

  let childMatch = false;
  const children = rowData._children;
  if (children) {
    let len = children.length;
    while (!childMatch && --len >= 0) {
      const childRow = children[len];
      if (childRow) {
        childMatch = deepFilter(childRow, predicate, filterCache);
      }
    }
  }

  const finalMatch = childMatch || predicate(rowData);
  filterCache.set(rowData.id, finalMatch);
  return finalMatch;
}

export function makeShowDetailsFilter(
  filterCache: Map<string, boolean>,
): (data: AggregatedLikeRow) => boolean {
  return (data) =>
    deepFilter<AggregatedLikeRow>(
      data,
      (row) =>
        row.totalTime > 0 ||
        !!(row.originalData.type && EXCLUDED_DETAIL_TYPES.has(row.originalData.type)),
      filterCache,
    );
}
