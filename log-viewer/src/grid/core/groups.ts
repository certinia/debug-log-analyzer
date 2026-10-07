/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { Totals } from './calcs.js';

/** The group a top-level row falls in. */
export type GroupBy<R> = (row: R) => string;

/** A group's header row: its top-level rows, in sort order, and their totals. */
export class Group<R> {
  readonly key: string;
  readonly rows: readonly R[];
  readonly totals: Totals;

  constructor(key: string, rows: readonly R[], totals: Totals) {
    this.key = key;
    this.rows = rows;
    this.totals = totals;
  }
}

/** Most rows first, then by key: the order before any sort, and the tie-break under one. */
export const byCount = <R>(a: Group<R>, b: Group<R>): number =>
  b.rows.length - a.rows.length || a.key.localeCompare(b.key);
