/**
 * @jest-environment jsdom
 */
/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';

// The tabulator ESM build doesn't load under jest, and the module registers
// itself on import.
jest.mock('tabulator-tables', () => ({
  Module: class {
    table: unknown;
    constructor(table: unknown) {
      this.table = table;
    }
    registerTableOption() {}
    registerTableFunction() {}
    subscribe() {}
  },
}));

import { waitForNextFrame } from '../../../core/utility/FrameBudget.js';
import { Find } from '../Find.js';

function setup() {
  const subscribed: Record<string, (() => void)[]> = {};
  const listened: string[] = [];
  const tableEvents: Record<string, (() => void)[]> = {};
  const table = {
    on: (event: string, callback: () => void) => {
      (tableEvents[event] ??= []).push(callback);
    },
    element: {
      querySelector: () => ({
        addEventListener: (event: string) => {
          listened.push(event);
        },
      }),
    },
  };
  const find = new Find(table as never);
  find.subscribe = (event: string, callback: () => void) => {
    (subscribed[event] ??= []).push(callback);
  };
  find.initialize();

  const applied = jest.fn();
  find._applyHighlights = applied;
  const attach = () => subscribed['render-virtual-attach']?.forEach((fn) => fn());
  const scroll = () => tableEvents['scrollVertical']?.forEach((fn) => fn());
  const nextFrame = waitForNextFrame;
  return { find, applied, attach, scroll, nextFrame, listened };
}

describe('Find highlights on the rows a render attaches', () => {
  it('re-applies once for the frame, however many attaches it took', async () => {
    const { find, applied, attach, nextFrame } = setup();
    find._findArgs = { text: 'a', count: 0, options: { matchCase: false } };

    attach();
    attach();
    expect(applied).not.toHaveBeenCalled();
    await nextFrame();

    expect(applied).toHaveBeenCalledTimes(1);
  });

  it('leaves the rows alone while nothing is being searched for', async () => {
    const { applied, attach, nextFrame } = setup();

    attach();
    await nextFrame();

    expect(applied).not.toHaveBeenCalled();
  });

  it("re-applies on a scroll, which is all a grid on Tabulator's renderer reports", async () => {
    const { find, applied, scroll, nextFrame } = setup();
    find._findArgs = { text: 'a', count: 0, options: { matchCase: false } };

    scroll();
    await nextFrame();

    expect(applied).toHaveBeenCalledTimes(1);
  });

  it('takes the scroll from the table, not from the holder element', () => {
    // Tabulator reports it for every renderer, and the holder is rebuilt.
    const { listened } = setup();

    expect(listened).toEqual([]);
  });
});

/** A one-row table whose columns hold `value`, some of them hidden. */
function findOver(columns: Array<{ field: string; visible: boolean; value: string }>) {
  const rowData = {};
  const rows = [{ getData: () => rowData }];
  const table = {
    on: () => {},
    getGroups: () => [],
    getRows: () => rows,
    modules: {},
    options: {},
    columnManager: {
      // Tabulator indexes every column here, shown or not.
      getRealColumns: () =>
        columns.map((column) => ({
          field: column.field,
          visible: column.visible,
          getComponent: () => ({}),
          getFieldValue: () => column.value,
        })),
    },
  };
  const find = new Find(table as never);
  // CSS.highlights does not exist in jsdom, and the count is what is under test.
  find._applyHighlights = () => {};
  return find;
}

describe('Find marks the current match', () => {
  // jsdom has no CSS Highlight API.
  class FakeHighlight extends Set<Range> {
    priority = 0;
  }
  const registry = new Map<string, FakeHighlight>();
  const globals = globalThis as { Highlight?: unknown; CSS?: unknown };
  const real = { Highlight: globals.Highlight, CSS: globals.CSS };

  beforeAll(() => {
    globals.Highlight = FakeHighlight;
    globals.CSS = { highlights: registry };
  });

  afterAll(() => {
    globals.Highlight = real.Highlight;
    globals.CSS = real.CSS;
    Find._findHighlight = null;
    Find._underHighlight = null;
    Find._currentHighlight = null;
  });

  it('lays the current match over a layer of its own, as the editor lays it over the selection', () => {
    const cell = document.createElement('div');
    cell.textContent = 'Decimal.compareTo(Decimal)';
    const rowData = { highlightIndexes: [1, 2] };
    const row = {
      getData: () => rowData,
      getCells: () => [{ getField: () => 'text', getElement: () => cell }],
    };
    const find = new Find({ on: () => {}, getRows: () => [row] } as never);
    find._findArgs = { text: 'Decimal', count: 2, options: { matchCase: false } };
    find._buildRegex(find._findArgs);
    find._searchedFields = new Set(['text']);
    find._currentMatchIndex = 2;

    find._applyHighlights();

    const texts = (name: string): string[] => [...(registry.get(name) ?? [])].map(String);
    expect(texts('find-match')).toEqual(['Decimal']);
    expect(texts('current-find-match')).toEqual(['Decimal']);
    const [current] = registry.get('current-find-match') ?? [];
    expect(registry.get('current-find-match-under')?.has(current as Range)).toBe(true);
    const priority = (name: string): number => registry.get(name)?.priority ?? Number.NaN;
    expect(priority('find-match')).toBeLessThan(priority('current-find-match-under'));
    expect(priority('current-find-match-under')).toBeLessThan(priority('current-find-match'));

    find._clearInstanceRanges();
    expect(registry.get('current-find-match-under')?.size).toBe(0);
  });
});

describe('Find counts what the table is showing', () => {
  const search = { text: 'default', count: 1, options: { matchCase: false } };

  it('leaves a hidden column out of the count', async () => {
    const find = findOver([
      { field: 'text', visible: true, value: 'Account default' },
      { field: 'namespace', visible: false, value: 'default' },
    ]);

    const result = await find._find(search);

    // A match nobody can see is a total the user cannot reach, and a number the
    // highlights cannot line up with.
    expect(result.totalMatches).toBe(1);
  });

  it('counts the same column once it is shown', async () => {
    const find = findOver([
      { field: 'text', visible: true, value: 'Account default' },
      { field: 'namespace', visible: true, value: 'default' },
    ]);

    const result = await find._find(search);

    expect(result.totalMatches).toBe(2);
  });
});
