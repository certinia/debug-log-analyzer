/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';

import type { Tabulator } from 'tabulator-tables';

import { selectRowByEventIndex } from '../components/revealRow.js';

/** The slice of tabulator the helper touches: rows to scan, and a select on the match. */
function fakeTable(eventIndexes: number[]): {
  table: Tabulator;
  selected: number[];
  deselects: number;
} {
  const selected: number[] = [];
  const state = { deselects: 0 };
  const rows = eventIndexes.map((eventIndex) => ({
    getData: () => ({ eventIndex }),
    select: () => selected.push(eventIndex),
  }));
  const table = {
    getRows: () => rows,
    deselectRow: () => (state.deselects += 1),
  } as unknown as Tabulator;

  return {
    table,
    selected,
    get deselects() {
      return state.deselects;
    },
  };
}

describe('selectRowByEventIndex', () => {
  it('selects the row that owns the event, clearing the previous one', () => {
    const grid = fakeTable([4, 9]);

    expect(selectRowByEventIndex(grid.table, 9)).toBe(true);
    expect(grid.selected).toEqual([9]);
    expect(grid.deselects).toBe(1);
  });

  it('leaves a grid that does not own the event untouched', () => {
    const grid = fakeTable([4, 9]);

    expect(selectRowByEventIndex(grid.table, 7)).toBe(false);
    expect(grid.selected).toEqual([]);
    expect(grid.deselects).toBe(0);
  });

  it('reveals nothing when the grid has no table yet', () => {
    expect(selectRowByEventIndex(null, 1)).toBe(false);
  });
});
