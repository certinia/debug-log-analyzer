/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/** Table logic: rows, groups, columns, totals, find, export and navigation. No DOM. */
export { max, ROWS_PER_YIELD, sum, type Calc, type Calcs, type Totals } from './calcs.js';
export type { ExportColumn, ExportOptions } from './export.js';
export { findPattern, type CellText, type FindQuery, type FindResult } from './find.js';
export { navigate, type NavIntent, type NavKey } from './navigation.js';
export { immediateScheduler, type Scheduler } from './schedule.js';
export { sortRows, type Sort, type SortBy, type SortDirection, type SortValue } from './sort.js';
export { parentIndex, type RowView } from './rows.js';
export { GridStore, type GridStoreOptions, type Snapshot } from './store.js';
export {
  Group,
  sameTarget,
  type Compare,
  type ExpandPolicy,
  type GroupBy,
  type RowFilter,
  type RowKey,
  type RowTarget,
  type TreeSource,
} from './types.js';
