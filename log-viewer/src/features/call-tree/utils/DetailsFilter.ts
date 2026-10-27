/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

import type { LogEvent } from '@apexdevtools/apex-log-parser';

export type DeepFilterable<T> = { id: number; _children?: T[] | null };

/**
 * Detail types that report governor figures. Two of them are parents, but they
 * count as details, never as frames.
 */
const PINNED_TYPES: ReadonlySet<string> = new Set<string>([
  'CUMULATIVE_LIMIT_USAGE',
  'LIMIT_USAGE_FOR_NS',
  'CUMULATIVE_PROFILING',
  'CUMULATIVE_PROFILING_BEGIN',
]);

/**
 * What an event is to the call-tree views, from its type alone and never its time.
 * A `frame` can hold children. A `pinned` detail is an exception, a fatal error or
 * a {@link PINNED_TYPES} event, which the top-down views always show. Any other
 * `detail` shows only when the Details filter is on.
 */
export type EventKind = 'frame' | 'pinned' | 'detail';

/** The {@link EventKind} of `event`. */
export function eventKind(event: Pick<LogEvent, 'type' | 'isParent' | 'discontinuity'>): EventKind {
  if (event.discontinuity || PINNED_TYPES.has(event.type ?? '')) {
    return 'pinned';
  }
  return event.isParent ? 'frame' : 'detail';
}

/**
 * Recursive id-cached deep filter for any tree row that exposes `id` + `_children`.
 * Returns true when `predicate(row)` is true OR any descendant matches; the
 * memoised result is stored on the shared `filterCache` so repeated lookups
 * within one filter pass are O(1).
 */
export function deepFilter<T extends DeepFilterable<T>>(
  rowData: T,
  predicate: (row: T) => boolean,
  filterCache: Map<number, boolean>,
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
