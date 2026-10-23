/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { inMsRange, type FilterRange } from '../../../components/grid/MinMax.js';
import type { RowFilter } from '../../../grid/index.js';
import type { BottomUpRow } from '../utils/Aggregation.js';

/** A filter that keeps the ancestors of each row it keeps, so a match stays in its tree. */
export const deep = <R>(test: (row: R) => boolean): RowFilter<R> => ({ test, keepAncestors: true });

const hasRange = (range: FilterRange): boolean => range.start !== null || range.end !== null;
const rangeKey = (range: FilterRange): string => `${range.start}:${range.end}`;

/**
 * Hands back the same filter object while its input is unchanged. The grid keeps its work
 * per filter object, so a new object for the same input would filter every row again.
 */
export class RowFilterCache {
  private readonly _slots = new Map<string, { input: string; filter: RowFilter<unknown> }>();

  reuse<R>(slot: string, input: string, make: () => RowFilter<R>): RowFilter<R> {
    const held = this._slots.get(slot);
    if (held?.input === input) {
      return held.filter as RowFilter<R>;
    }
    const filter = make();
    this._slots.set(slot, { input, filter: filter as RowFilter<unknown> });
    return filter;
  }
}

/** The namespace and time filters a user has set, ranges in ms. Empty or unbounded means off. */
export interface MeasureFilterInputs {
  namespaces: readonly string[];
  total: FilterRange;
  self: FilterRange;
}

/** Where a table's rows hold the values the measure filters test. Times are in ns. */
export interface MeasureFields<R> {
  namespace: (row: R) => string | null | undefined;
  total: (row: R) => number;
  self: (row: R) => number;
}

/** The measure fields of a Bottom-Up row, as shown in the Call Tree and in Analysis. */
export const BOTTOM_UP_MEASURES: MeasureFields<BottomUpRow> = {
  namespace: (row) => row.namespace,
  total: (row) => row.totalTime,
  self: (row) => row.totalSelfTime,
};

/**
 * The Namespace, Total Time and Self Time filters for one table's rows. `table` names it in
 * `cache`, so tables that share a cache keep their own filters.
 */
export function measureFilters<R>(
  inputs: MeasureFilterInputs,
  fields: MeasureFields<R>,
  cache: RowFilterCache,
  table: string,
): RowFilter<R>[] {
  const { namespaces, total, self } = inputs;
  const filters: RowFilter<R>[] = [];
  if (namespaces.length) {
    filters.push(
      cache.reuse(`${table}:namespace`, namespaces.join('\n'), () =>
        deep((row) => namespaces.includes(fields.namespace(row) || '')),
      ),
    );
  }
  if (hasRange(total)) {
    filters.push(
      cache.reuse(`${table}:total`, rangeKey(total), () =>
        deep((row) => inMsRange(total, fields.total(row))),
      ),
    );
  }
  if (hasRange(self)) {
    filters.push(
      cache.reuse(`${table}:self`, rangeKey(self), () =>
        deep((row) => inMsRange(self, fields.self(row))),
      ),
    );
  }
  return filters;
}
