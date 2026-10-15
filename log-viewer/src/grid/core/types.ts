/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { Totals } from './calcs.js';

/** A row's identity: stable across sort, filter and expansion. */
export type RowKey = string | number;

/** Where the grid's rows come from. A flat list is a tree with no `children`. */
export interface TreeSource<R extends object> {
  readonly roots: readonly R[];
  children?(row: R): readonly R[] | null | undefined;
  key(row: R): RowKey;
}

/** Ascending order; a sort direction is applied on top. */
export type Compare<R> = (a: R, b: R) => number;

export interface RowFilter<R> {
  test(row: R): boolean;
  /** Keep a row whose own test fails while any of its descendants passes. */
  keepAncestors?: boolean;
}

/** Whether a row starts expanded: one answer for every row, or one per row. */
export type ExpandPolicy<R> = boolean | ((row: R, depth: number) => boolean);

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

/** A data row's key, or a group: a row that can be found again after the rows change. */
export type RowTarget<R> = RowKey | Group<R>;

/** Each build makes its groups again, so a group is matched by its key. */
export const sameTarget = <R>(a: RowTarget<R> | null, b: RowTarget<R>): boolean =>
  a instanceof Group ? b instanceof Group && a.key === b.key : !(b instanceof Group) && a === b;
