/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { LvGrid } from '../../grid/index.js';
import type { ContextMenuItem } from '../ContextMenu.js';

/** The part of an lv-grid the width items act on. */
export type ColumnWidthGrid = Pick<
  LvGrid,
  'autosizeColumn' | 'autosizeColumns' | 'resetColumnWidths'
>;

const FIT = 'width:fit:';
const FIT_ALL = 'width:fit-all';
const RESET = 'width:reset';

/** The column menu's width items; "Autosize Column" only for a menu opened on a header. */
export function columnWidthItems(column: string | null): ContextMenuItem[] {
  return [
    ...(column ? [{ id: `${FIT}${column}`, label: 'Autosize Column' }] : []),
    { id: FIT_ALL, label: 'Autosize All Columns' },
    { id: RESET, label: 'Reset Column Widths' },
    { id: 'width-sep', label: '', separator: true },
  ];
}

/** Acts on a width item and says whether it did, leaving any other item to the caller. */
export function selectColumnWidthItem(grid: ColumnWidthGrid | null, itemId: string): boolean {
  if (itemId.startsWith(FIT)) {
    grid?.autosizeColumn(itemId.slice(FIT.length));
  } else if (itemId === FIT_ALL) {
    grid?.autosizeColumns();
  } else if (itemId === RESET) {
    grid?.resetColumnWidths();
  } else {
    return false;
  }
  return true;
}
