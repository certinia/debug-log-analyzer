/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { Compare } from './types.js';

export type SortDirection = 'asc' | 'desc';

export type SortValue = number | string | boolean | null | undefined;

/** Sort by a value, or by an ascending compare. */
export type SortBy<R> = { value: (row: R) => SortValue } | { compare: Compare<R> };

export type Sort<R> = SortBy<R> & { dir: SortDirection };

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

const isEmpty = (v: SortValue): v is null | undefined | '' =>
  v === null || v === undefined || v === '' || (typeof v === 'number' && Number.isNaN(v));

function compareValues(a: SortValue, b: SortValue, sign: number): number {
  const ea = isEmpty(a);
  const eb = isEmpty(b);
  if (ea || eb) {
    return ea === eb ? 0 : ea ? 1 : -1;
  }
  if (typeof a === 'string' && typeof b === 'string') {
    return sign * collator.compare(a, b);
  }
  return sign * (Number(a) - Number(b));
}

/**
 * `rows` sorted, stable. Empty values (null, undefined, '', NaN) go last in both
 * directions. Each row's value is read once.
 */
export function sortRows<R>(rows: readonly R[], sort: Sort<R>): R[] {
  const sign = sort.dir === 'asc' ? 1 : -1;
  if ('compare' in sort) {
    return rows.toSorted((a, b) => sign * sort.compare(a, b));
  }
  const values = rows.map(sort.value);
  return Array.from(rows.keys())
    .sort((i, j) => compareValues(values[i], values[j], sign))
    .map((i) => rows[i] as R);
}
