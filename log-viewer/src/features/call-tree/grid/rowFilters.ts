/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { inMsRange, type FilterRange } from '../../../components/grid/MinMax.js';
import type { RowFilter } from '../../../grid/index.js';

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

/**
 * The call-tree toolbar's filter choices. Ranges are in ms; an empty list or an unbounded
 * range means off. A `null` type means every type.
 */
export interface CallTreeFilterInputs {
  namespaces: readonly string[];
  total: FilterRange;
  self: FilterRange;
  type: string | null;
  details: boolean;
  debugOnly: boolean;
}

export const NO_FILTERS: CallTreeFilterInputs = {
  namespaces: [],
  total: { start: null, end: null },
  self: { start: null, end: null },
  type: null,
  details: false,
  debugOnly: false,
};

/** `inputs` with every filter off. Details stays as chosen: it sets how much shows, not what. */
export const clearedFilters = (inputs: CallTreeFilterInputs): CallTreeFilterInputs => ({
  ...NO_FILTERS,
  details: inputs.details,
});

/**
 * Where a table's rows hold what the filters test. Times are in ns. A table with no `type`
 * has no type or Debug Only filter.
 */
export interface CallTreeFilterFields<R> {
  namespace: (row: R) => string | null | undefined;
  total: (row: R) => number;
  self: (row: R) => number;
  type?: { of: (row: R) => string | null | undefined; debugOnly: RowFilter<R> };
  /** Keeps the rows that show with Details off. */
  withoutDetails: RowFilter<R>;
}

/**
 * The filters for one table's rows. Debug Only shows debug rows alone, so it stands in for
 * the type and Details filters. `table` names the table in `cache`, so tables that share it keep their own filters.
 */
export function callTreeFilters<R>(
  inputs: CallTreeFilterInputs,
  fields: CallTreeFilterFields<R>,
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
  const { type } = fields;
  if (type && inputs.debugOnly) {
    return [...filters, type.debugOnly];
  }
  const chosen = inputs.type;
  if (type && chosen !== null) {
    filters.push(
      cache.reuse(`${table}:type`, chosen, () => deep((row) => type.of(row) === chosen)),
    );
  }
  return inputs.details ? filters : [...filters, fields.withoutDetails];
}
