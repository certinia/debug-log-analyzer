/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { Compare } from './types.js';

export type SortDirection = 'asc' | 'desc';

type Value = number | string | boolean | null | undefined;

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

const isEmpty = (v: Value): v is null | undefined | '' =>
  v === null || v === undefined || v === '' || (typeof v === 'number' && Number.isNaN(v));

function compareValues(
  a: Exclude<Value, null | undefined>,
  b: Exclude<Value, null | undefined>,
): number {
  if (typeof a === 'string' && typeof b === 'string') {
    return collator.compare(a, b);
  }
  return Number(a) - Number(b);
}

/**
 * A comparator for one sorted column, by its value or by its own ascending compare.
 * Empty values (null, undefined, '', NaN) sort last in both directions, so a column of
 * mostly-unknown values reads from the known ones down.
 */
export function sortComparator<R>(
  by: { value: (row: R) => Value } | { compare: Compare<R> },
  dir: SortDirection,
): Compare<R> {
  const sign = dir === 'asc' ? 1 : -1;
  if ('compare' in by) {
    return (a, b) => sign * by.compare(a, b);
  }
  const { value } = by;
  return (a, b) => {
    const va = value(a);
    const vb = value(b);
    const ea = isEmpty(va);
    const eb = isEmpty(vb);
    if (ea || eb) {
      return ea === eb ? 0 : ea ? 1 : -1;
    }
    return sign * compareValues(va, vb);
  };
}
