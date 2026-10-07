/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/** A row's identity: stable across sort, filter and expansion. */
export type RowKey = string | number;

/** Where the grid's rows come from. A flat list is a tree with no `children`. */
export interface TreeSource<R extends object> {
  readonly roots: readonly R[];
  /** A row's children, or nothing for a leaf. */
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
