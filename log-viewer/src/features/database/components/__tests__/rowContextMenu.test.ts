/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { describe, expect, it } from '@jest/globals';
import type { RowComponent, Tabulator } from 'tabulator-tables';

import type { ContextMenu } from '../../../../components/ContextMenu.js';
import { showStatementRowMenu } from '../rowContextMenu.js';

type Shown = { items: { id: string }[]; x: number; y: number };

function fakeMenu(shown: Shown[]): ContextMenu {
  return {
    show: (items: { id: string }[], x: number, y: number) => shown.push({ items, x, y }),
  } as unknown as ContextMenu;
}

function fakeRow(data: { eventIndex?: number }, log: string[] = []): RowComponent {
  return {
    getData: () => data,
    select: () => log.push('select'),
    deselect: () => log.push('deselect'),
  } as unknown as RowComponent;
}

function fakeTable(selected: RowComponent[]): Tabulator {
  return { getSelectedRows: () => selected } as unknown as Tabulator;
}

function contextEvent(): MouseEvent {
  return new MouseEvent('contextmenu', { clientX: 12, clientY: 34, cancelable: true });
}

/** jsdom has no selection by default; fake the "user is mid-drag" state. */
function withRangeSelection<T>(run: () => T): T {
  const original = window.getSelection;
  window.getSelection = (() => ({ type: 'Range' })) as typeof window.getSelection;
  try {
    return run();
  } finally {
    window.getSelection = original;
  }
}

describe('showStatementRowMenu', () => {
  it('selects only the right-clicked row and opens the menu at the pointer', () => {
    const shown: Shown[] = [];
    const log: string[] = [];
    const previouslySelected = fakeRow({ eventIndex: 1 }, log);
    const row = fakeRow({ eventIndex: 42 }, log);
    const event = contextEvent();

    const eventIndex = showStatementRowMenu(
      event,
      row,
      fakeTable([previouslySelected]),
      fakeMenu(shown),
    );

    expect(eventIndex).toBe(42);
    // The previous selection is cleared before this row is selected, so the
    // inspector follows the right-clicked row.
    expect(log).toEqual(['deselect', 'select']);
    expect(event.defaultPrevented).toBe(true);
    expect(shown).toHaveLength(1);
    expect(shown[0]?.items.map((i) => i.id)).toContain('show-in-call-tree');
    expect([shown[0]?.x, shown[0]?.y]).toEqual([12, 34]);
  });

  it('does nothing while the user has a text selection, so right-drag can copy', () => {
    const shown: Shown[] = [];
    const log: string[] = [];
    const event = contextEvent();

    const result = withRangeSelection(() =>
      showStatementRowMenu(event, fakeRow({ eventIndex: 42 }, log), fakeTable([]), fakeMenu(shown)),
    );

    expect(result).toBeNull();
    expect(shown).toHaveLength(0);
    expect(log).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
  });

  it('opens no menu for a row with no underlying event, e.g. a group header', () => {
    const shown: Shown[] = [];
    const row = fakeRow({});

    expect(showStatementRowMenu(contextEvent(), row, fakeTable([]), fakeMenu(shown))).toBeNull();
    expect(shown).toHaveLength(0);
  });

  it('is a no-op before the menu element has been queried', () => {
    const log: string[] = [];
    const event = contextEvent();

    expect(
      showStatementRowMenu(event, fakeRow({ eventIndex: 42 }, log), fakeTable([]), null),
    ).toBeNull();
    expect(log).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
  });

  it('tolerates a table that has not been built yet', () => {
    const shown: Shown[] = [];
    const log: string[] = [];

    expect(
      showStatementRowMenu(contextEvent(), fakeRow({ eventIndex: 7 }, log), null, fakeMenu(shown)),
    ).toBe(7);
    expect(log).toEqual(['select']);
    expect(shown).toHaveLength(1);
  });

  it('does not use ids that could collide with the column menu', () => {
    const shown: Shown[] = [];
    showStatementRowMenu(
      contextEvent(),
      fakeRow({ eventIndex: 1 }),
      fakeTable([]),
      fakeMenu(shown),
    );

    for (const item of shown[0]?.items ?? []) {
      expect(item.id).not.toMatch(/^(view|col|reset):/);
    }
  });
});
