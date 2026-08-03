/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';

import type { Tabulator } from 'tabulator-tables';

import { SelectionEchoGuard } from '../../../core/events/SelectionEchoGuard.js';
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
    const guard = new SelectionEchoGuard();

    expect(selectRowByEventIndex(grid.table, guard, 9)).toBe(true);
    expect(grid.selected).toEqual([9]);
    expect(grid.deselects).toBe(1);
  });

  it('leaves a grid that does not own the event untouched', () => {
    const grid = fakeTable([4, 9]);
    const guard = new SelectionEchoGuard();

    expect(selectRowByEventIndex(grid.table, guard, 7)).toBe(false);
    expect(grid.selected).toEqual([]);
    expect(grid.deselects).toBe(0);
  });

  it('suppresses the echo while it selects, so the inspector is not sent its own selection', () => {
    const guard = new SelectionEchoGuard();
    const during: boolean[] = [];
    const table = {
      getRows: () => [{ getData: () => ({ eventIndex: 1 }), select: () => {} }],
      deselectRow: () => during.push(guard.suppressed),
    } as unknown as Tabulator;

    selectRowByEventIndex(table, guard, 1);

    expect(during).toEqual([true]);
    expect(guard.suppressed).toBe(false);
  });

  it('reveals nothing when the grid has no table yet', () => {
    expect(selectRowByEventIndex(null, new SelectionEchoGuard(), 1)).toBe(false);
  });
});
