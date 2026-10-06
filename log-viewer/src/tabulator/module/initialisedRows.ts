/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { RowRangeLookup } from 'tabulator-tables';

export interface TreeRow {
  modules: { dataTree?: unknown };
}

export interface TreeTable {
  options: { dataTree?: boolean };
  rowManager: { rows: TreeRow[] };
  modules: { dataTree: { initializeRow: (row: TreeRow) => void } };
}

/**
 * The rows tabulator's `'all'` range returns, with the tree state an export reads
 * filled in first.
 *
 * A tree row gets that state when the display pipeline builds it, and the pipeline
 * starts from the rows a filter left. `'all'` is the unfiltered list, so it reaches
 * rows nothing ever built, and the export reads `index` or `parent` off `undefined`.
 * Initialising through the module sets the state without building the row's element,
 * so nothing here holds a node for the life of the table.
 */
export function initialisedRows(this: TreeTable): TreeRow[] {
  const rows = this.rowManager.rows;

  if (this.options.dataTree) {
    for (const row of rows) {
      if (!row.modules.dataTree) {
        this.modules.dataTree.initializeRow(row);
      }
    }
  }
  return rows;
}

/** `Export.rowLookup` takes a range or a function; the types name only the ranges. */
export const initialisedRowRange = initialisedRows as unknown as RowRangeLookup;
