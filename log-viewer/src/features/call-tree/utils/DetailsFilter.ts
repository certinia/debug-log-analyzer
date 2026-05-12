/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { AggregatedRow, BottomUpRow } from './Aggregation.js';

export type AggregatedLikeRow = AggregatedRow | BottomUpRow;

export const EXCLUDED_DETAIL_TYPES = new Set<string>([
  'CUMULATIVE_LIMIT_USAGE',
  'LIMIT_USAGE_FOR_NS',
  'CUMULATIVE_PROFILING',
  'CUMULATIVE_PROFILING_BEGIN',
]);

export function deepFilterAggregated(
  rowData: AggregatedLikeRow,
  filterFunction: (rowData: AggregatedLikeRow) => boolean,
  filterParams: { filterCache: Map<string, boolean> },
): boolean {
  const cached = filterParams.filterCache.get(rowData.id);
  if (cached !== null && cached !== undefined) {
    return cached;
  }

  let childMatch = false;
  const children = rowData._children || [];
  let len = children.length;
  while (--len >= 0) {
    const childRow = children[len];
    if (childRow && deepFilterAggregated(childRow, filterFunction, filterParams)) {
      childMatch = true;
      break;
    }
  }

  const finalMatch = childMatch || filterFunction(rowData);
  filterParams.filterCache.set(rowData.id, finalMatch);
  return finalMatch;
}

export function makeShowDetailsFilter(
  filterCache: Map<string, boolean>,
): (data: AggregatedLikeRow) => boolean {
  return (data) =>
    deepFilterAggregated(
      data,
      (row) =>
        row.totalTime > 0 ||
        !!(row.originalData.type && EXCLUDED_DETAIL_TYPES.has(row.originalData.type)),
      { filterCache },
    );
}
