/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { TemplateResult } from 'lit';

import type { Calc, Compare, Group, SortDirection } from '../core/index.js';

/** What a cell shows: text, or a template the grid renders. */
export type CellContent = TemplateResult | string;

type SortValue = number | string | boolean | null | undefined;

/** One column of an `<lv-grid>`. Only `id`, `title` and `cell` are required. */
export interface GridColumn<R> {
  /** Unique within the grid; names the column's total and its sort. */
  id: string;
  title: string;
  /** The header tooltip. Default: the title. */
  description?: string;
  /** Pixels, or `flex` to take the room the others leave. Default `flex`. */
  width?: number | 'flex';
  /** Smallest width in pixels. Default 40. */
  minWidth?: number;
  /** `end` for numbers. Default `start`. */
  align?: 'start' | 'end';
  hidden?: boolean;
  /** The user can drag its header edge, or double-click it to fit the shown rows. Default true. */
  resizable?: boolean;
  /** The cell. In the first column, it follows the tree indent and the expand control. */
  cell(row: R): CellContent;
  /** The text the cell shows: find searches it, copy and export write it. */
  text?(row: R): string;
  /** Plain text shown on hover. Never markup. */
  tooltip?(row: R): string;
  /** Sorts by this value, or by this ascending compare. No sort: the header does not sort. */
  sort?: { value: (row: R) => SortValue } | { compare: Compare<R> };
  /** The direction a first click sorts. Default `asc`. */
  sortFirst?: SortDirection;
  /** The footer and group total. Sorting the column orders groups by it. */
  calc?: Calc<R>;
  /** Shows a total from `calc`. Default: the number as text. */
  total?(value: number): CellContent;
  /** The footer cell of a column with no `calc`, such as a "Total" label. */
  footer?: CellContent;
  /** A group row's cell, in the first column. Default: its key and row count. */
  groupCell?(group: Group<R>): CellContent;
  /** Extra classes on every cell of the column. */
  className?: string;
}
