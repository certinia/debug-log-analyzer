/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it, vi } from 'vitest';

import { initialisedRows, type TreeRow, type TreeTable } from '../initialisedRows.js';

function tableOf(rows: TreeRow[], dataTree: boolean) {
  const initializeRow = vi.fn((row: TreeRow) => {
    row.modules.dataTree = { index: 0 };
  });
  return {
    table: {
      options: { dataTree },
      rowManager: { rows },
      modules: { dataTree: { initializeRow } },
    } satisfies TreeTable,
    initializeRow,
  };
}

describe('initialisedRows', () => {
  it('initialises only the rows the filter kept out of the display pipeline', () => {
    const filteredOut = { modules: {} };
    const displayed = { modules: { dataTree: { index: 1 } } };
    const { table, initializeRow } = tableOf([filteredOut, displayed], true);

    const rows = initialisedRows.call(table);

    expect(initializeRow.mock.calls.map(([row]) => row)).toEqual([filteredOut]);
    expect(displayed.modules.dataTree).toEqual({ index: 1 });
    expect(rows).toBe(table.rowManager.rows);
  });

  // Every row already carries the state where there is no tree, so touching them would
  // only cost the grids that have none.
  it('leaves the rows alone where the table has no tree', () => {
    const { table, initializeRow } = tableOf([{ modules: {} }], false);

    expect(initialisedRows.call(table)).toBe(table.rowManager.rows);
    expect(initializeRow).not.toHaveBeenCalled();
  });
});
