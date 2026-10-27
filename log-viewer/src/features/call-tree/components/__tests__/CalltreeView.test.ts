/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import type { ApexLog, LogEvent } from '@apexdevtools/apex-log-parser';

import { toAggregatedCallTree, toBottomUpTree, type BottomUpRow } from '../../utils/Aggregation.js';

// The columns read a parsed log, which the fake one is not.
jest.mock('../../grid/columns.js', () => ({
  ...jest.requireActual<object>('../../grid/columns.js'),
  timeOrderColumns: () => {
    built.push('time-order');
    return [];
  },
  aggregatedColumns: () => {
    built.push('aggregated');
    return [];
  },
  bottomUpColumns: () => {
    built.push('bottom-up');
    return [];
  },
}));
jest.mock('../../utils/Aggregation.js', () => ({
  ...jest.requireActual<object>('../../utils/Aggregation.js'),
  buildAggregatedTree: (...args: unknown[]) => heldBuild(args[3]),
  buildBottomUpTree: (...args: unknown[]) => heldBuild(args[3]),
}));
// VsSelect extends vscode-single-select, whose setFormValue needs an
// ElementInternals jsdom lacks; the render would upgrade it.
jest.mock('../../../../components/VsSelect.js', () => ({}));
// Connecting the view reads settings twice: firstUpdated loads the column view,
// and category colouring subscribes. This suite has no extension host to answer.
jest.mock('../../../settings/Settings.js', () => ({
  ...jest.requireActual<object>('../../../settings/Settings.js'),
  getSettings: () => Promise.resolve({}),
  subscribeSettings: (apply: (settings: object) => void) => {
    applySettings = apply;
    return () => {};
  },
}));
jest.mock('../../../../components/grid/exportCsv.js', () => ({ exportCsv: jest.fn() }));

import { storeOf } from '#test-helpers/apexLog.js';
import { AlwaysVisible, NeverVisible, settle } from '#test-helpers/visibility.js';
import { exportCsv } from '../../../../components/grid/exportCsv.js';
import { eventBus } from '../../../../core/events/EventBus.js';
import { LogStore, logStoreFor } from '../../../../core/log/LogStore.js';
import { CalltreeView } from '../CalltreeView.js';

/** Which view each build made, in order. */
let built: string[] = [];
/** Finishes the newest merged build, where a test drives one that is in flight. */
let finishBuild: ((roots: object[]) => void) | null = null;
/** Whether a merged build waits to be finished by hand. */
let holdBuilds = false;
/** Pushes settings to the view, as the extension does on a change. */
let applySettings: (settings: object) => void = () => {};

/** The signals the merged builds were given, in order. */
let buildSignals: (AbortSignal | undefined)[] = [];

function heldBuild(options: unknown): Promise<object[]> {
  buildSignals.push((options as { signal?: AbortSignal } | undefined)?.signal);
  if (!holdBuilds) {
    return Promise.resolve([]);
  }
  return new Promise((resolve) => (finishBuild = resolve));
}

/** The grids in the view's DOM. */
function grids(view: CalltreeView): Element[] {
  return [...view.renderRoot.querySelectorAll('lv-call-tree-grid')];
}

function apexLog(): ApexLog {
  return {
    children: [],
    eventsById: [],
    namespaces: [],
    governorLimits: null,
  } as unknown as ApexLog;
}

async function mountView(log: ApexLog = apexLog()): Promise<CalltreeView> {
  const view = new CalltreeView();
  document.body.append(view);
  await view.updateComplete;
  view.logStore = logStoreFor(log);
  await view.updateComplete;
  await settle();
  return view;
}

describe('calltree-view table lifetime', () => {
  let view: CalltreeView;

  beforeEach(async () => {
    built = [];
    buildSignals = [];
    finishBuild = null;
    holdBuilds = false;
    globalThis.IntersectionObserver = AlwaysVisible as unknown as typeof IntersectionObserver;
    view = await mountView();
  });

  afterEach(() => {
    view.remove();
  });

  it('builds the grid for the log it is given', () => {
    expect(built).toEqual(['time-order']);
    expect(grids(view)).toEqual([view.timeOrderGrid]);
  });

  it('gives the grid it has the rows of a new log, and keeps its filters', async () => {
    view.namespaceSelected = ['ns'];
    view._updateFiltering();
    const grid = view.timeOrderGrid;
    const filters = [...(grid?.filters ?? [])];
    const source = grid?.source;

    view.logStore = logStoreFor(apexLog());
    await view.updateComplete;
    await settle();

    expect(view.timeOrderGrid).toBe(grid);
    expect(grids(view)).toEqual([grid]);
    expect(grid?.source).not.toBe(source);
    expect(grid?.filters).toEqual(filters);
  });

  it('rebuilds the grid after a detach and a re-attach', async () => {
    const before = view.timeOrderGrid;
    view.remove();
    expect(view.timeOrderGrid).toBeNull();
    expect(before?.isConnected).toBe(false);

    document.body.append(view);
    await settle();

    expect(built).toEqual(['time-order', 'time-order']);
    expect(grids(view)).toEqual([view.timeOrderGrid]);
  });

  it('rebuilds under the filters the view was left with', async () => {
    view.namespaceSelected = ['ns'];
    view._updateFiltering();
    const onShow = view.timeOrderGrid?.filters.length;
    expect(onShow).toBeGreaterThan(0);

    view.remove();
    document.body.append(view);
    await settle();

    // The chip still reads as on, so the rebuilt grid has to read the same way.
    expect(view.timeOrderGrid?.filters).toHaveLength(onShow!);
  });

  it('keeps a filter that did not change, so the grid keeps its work for it', () => {
    view.namespaceSelected = ['ns'];
    view._updateFiltering();
    const before = [...(view.timeOrderGrid?.filters ?? [])];

    view._updateFiltering();
    expect(view.timeOrderGrid?.filters).toEqual(before);

    view._handleTotalTimeRange(
      new CustomEvent('range', { detail: { range: { start: 1, end: null } } }),
    );
    // Equal filters share their test function, so this holds only for the same objects.
    expect(view.timeOrderGrid?.filters).toEqual(expect.arrayContaining(before));
    expect(view.timeOrderGrid?.filters).toHaveLength(before.length + 1);
  });

  it('builds nothing where the view goes before it is seen', async () => {
    view.remove();
    built = [];
    // Back on screen, then gone again before the visibility answer is acted on.
    document.body.append(view);
    view.remove();
    await settle();

    expect(built).toEqual([]);
  });

  it.each([
    ['bottom-up', 'bottomUpGrid'],
    ['aggregated', 'aggregatedGrid'],
  ] as const)(
    'leaves a %s build the detach overtook to the one that replaced it',
    async (mode, field) => {
      holdBuilds = true;
      void view._setViewMode(mode);
      await settle();
      const overtaken = finishBuild!; // the held build set it
      const first = view[field];

      // Gone and back while the first build is still waiting on its tree.
      view.remove();
      holdBuilds = false;
      document.body.append(view);
      await settle();
      expect(built).toEqual(['time-order', mode, mode]);
      const newest = view[field];
      const rows = newest?.source?.roots;

      overtaken([{ id: 1, _pathId: 1 }]);
      await settle();

      // The view holds the newest grid now, so the overtaken build must not fill it.
      expect(view[field]).toBe(newest);
      expect(newest?.source?.roots).toBe(rows);
      expect(first?.source).toBeNull();
    },
  );

  it.each(['aggregated', 'bottom-up'] as const)(
    'tells the inspector of %s, switched back to mid-build, once its rows are in',
    async (mode) => {
      holdBuilds = true;
      void view._setViewMode(mode);
      await settle();
      const finish = finishBuild!; // the held build set it
      await view._setViewMode('time-order');

      const hasRows: boolean[] = [];
      const off = eventBus.on('detail:view', () =>
        hasRows.push(!!view[mode === 'aggregated' ? 'aggregatedGrid' : 'bottomUpGrid']?.source),
      );
      const back = view._setViewMode(mode);
      await settle();
      finish([{ id: 1, _pathId: 1, originalData: { isParent: true } }]);
      await back;
      off();

      expect(hasRows).toEqual([true]);
    },
  );

  it('stops a build when a detach destroys its grid', async () => {
    holdBuilds = true;
    void view._setViewMode('bottom-up');
    await settle();

    view.remove();
    holdBuilds = false;
    document.body.append(view);
    await settle();

    expect(buildSignals.map((signal) => signal?.aborted)).toEqual([true, false]);
  });

  it('offers Group only in bottom up', async () => {
    const picker = () => view.renderRoot.querySelector('#bottomup-groupby');
    expect(picker()).toBeNull();

    await view._setViewMode('bottom-up');
    await settle();

    expect(picker()?.getAttribute('slot')).toBe('group');
  });

  it('keeps the column view picked from its select', async () => {
    const picker = () =>
      view.renderRoot.querySelector('#column-view') as HTMLElement & { value: string };
    picker().value = 'Governor Limits';
    picker().dispatchEvent(new Event('change'));
    await view.updateComplete;

    expect(picker().querySelector('vscode-option[selected]')?.getAttribute('value')).toBe(
      'Governor Limits',
    );
  });

  it('rebuilds bottom up grouped the way it was left', async () => {
    await view._setViewMode('bottom-up');
    await settle();
    const picker = view.renderRoot.querySelector('#bottomup-groupby') as HTMLElement & {
      value: string;
    };
    picker.value = 'Namespace';
    picker.dispatchEvent(new Event('change'));
    await settle();
    const namespaceOf = (grid: CalltreeView['bottomUpGrid']) =>
      grid?.groupBy?.({ namespace: 'ns' } as BottomUpRow);
    expect(namespaceOf(view.bottomUpGrid)).toBe('ns');

    view.remove();
    document.body.append(view);
    await settle();

    expect(namespaceOf(view.bottomUpGrid)).toBe('ns');
  });

  it('rebuilds the view on show, not the one the log opened on', async () => {
    await view._setViewMode('bottom-up');
    await settle();
    expect(built).toEqual(['time-order', 'bottom-up']);

    view.remove();
    document.body.append(view);
    await settle();

    expect(built).toEqual(['time-order', 'bottom-up', 'bottom-up']);
  });

  it('names each grid by its view', async () => {
    await view._setViewMode('bottom-up');
    await settle();

    expect(view.timeOrderGrid?.label).toBe('Call tree, Time Order');
    expect(view.bottomUpGrid?.label).toBe('Call tree, Bottom-Up');
  });

  it('gives the expand button the grid on show', async () => {
    const button = view.shadowRoot?.querySelector('tree-expand-button');
    expect(button?.grid).toBe(view.timeOrderGrid);

    await view._setViewMode('bottom-up');
    await settle();

    expect(button?.grid).toBe(view.bottomUpGrid);
  });

  const toolbarClick = (label: string) =>
    view.renderRoot.querySelector<HTMLElement>(`vscode-toolbar-button[label="${label}"]`)?.click();

  it.each([
    ['time-order', 'timeOrderGrid'],
    ['aggregated', 'aggregatedGrid'],
    ['bottom-up', 'bottomUpGrid'],
  ] as const)(
    'exports and copies the %s grid, naming the file for the view',
    async (mode, field) => {
      await view._setViewMode(mode);
      await settle();
      const grid = view[field];
      if (!grid) {
        throw new Error(`no ${mode} grid`);
      }
      const copy = jest.spyOn(grid, 'copy').mockResolvedValue(undefined);
      toolbarClick('Export to CSV');
      toolbarClick('Copy to clipboard');

      expect(exportCsv).toHaveBeenCalledWith(grid, `call-tree-${mode}.csv`);
      expect(copy).toHaveBeenCalled();
    },
  );

  it('opens the column menu from the toolbar', () => {
    const menu = view.renderRoot.querySelector('context-menu') as HTMLElement & {
      show: (...args: unknown[]) => void;
    };
    const show = jest.spyOn(menu, 'show').mockImplementation(() => {});
    toolbarClick('Columns');

    expect(show).toHaveBeenCalledTimes(1);
  });

  it('builds aggregated as a grid, under the filters in force', async () => {
    view.namespaceSelected = ['ns'];
    await view._setViewMode('aggregated');
    await settle();

    expect(built).toEqual(['time-order', 'aggregated']);
    expect(grids(view)).toContain(view.aggregatedGrid);
    // The namespace chip, and Show Details off.
    expect(view.aggregatedGrid?.filters).toHaveLength(2);
  });
});

describe('calltree-view category colorize', () => {
  let view: CalltreeView;
  const colorize = (on: boolean): void =>
    applySettings({ timeline: { customThemes: {} }, callTree: { categoryColorize: on } });

  beforeEach(async () => {
    globalThis.IntersectionObserver = AlwaysVisible as unknown as typeof IntersectionObserver;
    view = await mountView();
  });

  afterEach(() => {
    view.remove();
  });

  it('tints the open grids when the setting changes, and grids built after', async () => {
    colorize(true);
    expect(view.timeOrderGrid?.hasAttribute('category-colorize')).toBe(true);

    await view._setViewMode('bottom-up');
    await settle();
    expect(view.bottomUpGrid?.hasAttribute('category-colorize')).toBe(true);

    colorize(false);
    expect(view.timeOrderGrid?.hasAttribute('category-colorize')).toBe(false);
    expect(view.bottomUpGrid?.hasAttribute('category-colorize')).toBe(false);
  });
});

describe('calltree-view merged filters', () => {
  // Outer runs 5 ms; its query and debug line take next to none.
  const { log } = storeOf(
    '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.Outer.run()\n' +
      '09:18:22.6 (2000)|SOQL_EXECUTE_BEGIN|[2]|Aggregations:0|SELECT Id FROM Account\n' +
      '09:18:22.6 (3000)|SOQL_EXECUTE_END|[2]|Rows:1\n' +
      '09:18:22.6 (4000)|USER_DEBUG|[3]|DEBUG|hello\n' +
      '09:18:22.6 (5001000)|METHOD_EXIT|[1]|ns.Outer.run()\n',
  );
  const paths = (): ReturnType<LogStore['keyPathIds']> => logStoreFor(log).keyPathIds();
  const all = <R extends { _children?: R[] | null }>(of: readonly R[]): R[] =>
    of.flatMap((row) => [row, ...all(row._children ?? [])]);
  const rowsOf = {
    aggregated: () => all(toAggregatedCallTree(log.children, paths())),
    'bottom-up': () => all(toBottomUpTree(log.children, paths())),
  };
  const gridOf = (view: CalltreeView, mode: keyof typeof rowsOf) =>
    mode === 'aggregated' ? view.aggregatedGrid : view.bottomUpGrid;
  /** The rows each filter passes on its own; ancestors kept for a match are the grid's job. */
  const passing = (view: CalltreeView, mode: keyof typeof rowsOf): string[] => {
    const filters = (gridOf(view, mode)?.filters ?? []) as { test: (row: object) => boolean }[];
    return rowsOf[mode]()
      .filter((row) => filters.every((filter) => filter.test(row)))
      .map((row) => row.text);
  };

  let view: CalltreeView;

  beforeEach(async () => {
    globalThis.IntersectionObserver = AlwaysVisible as unknown as typeof IntersectionObserver;
    view = await mountView(log);
    view.filterState.showDetails = true;
  });

  afterEach(() => {
    view.remove();
  });

  it('hides the debug line from Time Order with Details off, and keeps the query that took no time', () => {
    view._handleShowDetailsChange();
    const filters = (view.timeOrderGrid?.filters ?? []) as { test: (row: object) => boolean }[];
    const events = (of: readonly LogEvent[]): LogEvent[] =>
      of.flatMap((e) => [e, ...events(e.children)]);
    const kept = events(log.children)
      .filter((e) => filters.every((filter) => filter.test(e)))
      .map((e) => e.type);

    expect(kept).toContain('SOQL_EXECUTE_BEGIN');
    expect(kept).not.toContain('USER_DEBUG');
  });

  it.each(['aggregated', 'bottom-up'] as const)(
    'filters %s rows on their own total time, self time and namespace',
    async (mode) => {
      const range = (start: number | null) =>
        new CustomEvent('range', { detail: { range: { start, end: null } } });
      await view._setViewMode(mode);
      view._handleTotalTimeRange(range(1));
      expect(passing(view, mode)).toContain('ns.Outer.run()');
      expect(passing(view, mode)).not.toContain('SELECT Id FROM Account');

      view._handleTotalTimeRange(range(null));
      view._handleSelfTimeRange(range(1));
      expect(passing(view, mode)).toContain('ns.Outer.run()');
      expect(passing(view, mode)).not.toContain('SELECT Id FROM Account');

      view._handleNamespaceFacet(new CustomEvent('facet', { detail: { selected: ['other'] } }));
      expect(passing(view, mode)).toEqual([]);
    },
  );

  it('filters aggregated rows on their type, and on debug only', async () => {
    await view._setViewMode('aggregated');
    view._handleTypeFilter({ target: { value: 'SOQL_EXECUTE_BEGIN' } } as unknown as Event);
    expect(passing(view, 'aggregated')).toEqual(['SELECT Id FROM Account']);

    view._handleDebugOnlyChange();
    expect(passing(view, 'aggregated')).toEqual(['DEBUG | hello']);
  });
});

describe('calltree-view inspector reveal', () => {
  // Outer calls Inner, so Outer heads its own bucket and is Inner's caller row too.
  const { log } = storeOf(
    '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.Outer.run()\n' +
      '09:18:22.6 (2000)|METHOD_ENTRY|[2]|01p|ns.Inner.go()\n' +
      '09:18:22.6 (3000)|METHOD_EXIT|[2]|ns.Inner.go()\n' +
      '09:18:22.6 (5001000)|METHOD_EXIT|[1]|ns.Outer.run()\n',
  );
  let view: CalltreeView;

  beforeEach(async () => {
    globalThis.IntersectionObserver = AlwaysVisible as unknown as typeof IntersectionObserver;
    holdBuilds = true;
    view = await mountView(log);
  });

  afterEach(() => {
    holdBuilds = false;
    view.remove();
  });

  it('reveals the Bottom-Up bucket a frame heads, not a caller row it sits in', async () => {
    const switched = view._setViewMode('bottom-up');
    await settle();
    const roots = toBottomUpTree(log.children, logStoreFor(log).keyPathIds());
    finishBuild?.(roots);
    await switched;
    const grid = view.bottomUpGrid;
    if (!grid) {
      throw new Error('no bottom-up grid');
    }
    const goTo = jest.spyOn(grid, 'goTo').mockResolvedValue(true);
    const all = (events: ApexLog['children']): ApexLog['children'] =>
      events.flatMap((e) => [e, ...all(e.children)]);
    const outer = all(log.children).find((e) => e.text === 'ns.Outer.run()');

    eventBus.emit('inspector:reveal', { source: 'calltree', eventIndex: outer?.eventIndex ?? -1 });
    await settle();

    const bucket = roots.find((row) => row.text === 'ns.Outer.run()');
    expect(goTo).toHaveBeenCalledWith([bucket?.id], { scrollIfVisible: false });
  });
});

describe('calltree-view go to row', () => {
  let view: CalltreeView;

  afterEach(() => {
    view.remove();
  });

  it('puts keyboard focus on the grid, so its keys work at once', async () => {
    globalThis.IntersectionObserver = AlwaysVisible as unknown as typeof IntersectionObserver;
    const { log } = storeOf(
      '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.Outer.run()\n' +
        '09:18:22.6 (1800)|METHOD_EXIT|[1]|ns.Outer.run()\n',
    );
    view = await mountView(log);
    const all = (events: ApexLog['children']): ApexLog['children'] =>
      events.flatMap((e) => [e, ...all(e.children)]);
    const outer = all(log.children).find((e) => e.text === 'ns.Outer.run()');

    await view._goToRow(outer?.eventIndex ?? -1);

    expect((view.renderRoot as ShadowRoot).activeElement === view.timeOrderGrid).toBe(true);
  });
});

describe('calltree-view type picker', () => {
  const OUTER =
    '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.Outer.run()\n' +
    '09:18:22.6 (1100)|SOQL_EXECUTE_BEGIN|[2]|Aggregations:0|SELECT Id FROM Account\n' +
    '09:18:22.6 (1200)|SOQL_EXECUTE_END|[2]|Rows:1\n' +
    '09:18:22.6 (1800)|METHOD_EXIT|[1]|ns.Outer.run()\n';
  const DML =
    '09:18:22.6 (1000)|DML_BEGIN|[1]|Op:Insert|Type:Account|Rows:1\n' +
    '09:18:22.6 (1100)|DML_END|[1]\n';

  let view: CalltreeView;

  beforeEach(() => {
    globalThis.IntersectionObserver = AlwaysVisible as unknown as typeof IntersectionObserver;
    view = new CalltreeView();
    document.body.append(view);
  });

  afterEach(() => {
    view.remove();
    jest.restoreAllMocks();
  });

  async function typeOptions(): Promise<(string | undefined)[]> {
    await view.updateComplete;
    await settle();
    await view.updateComplete;
    return [...view.renderRoot.querySelectorAll('vs-select[label="Type"] vscode-option')]
      .map((option) => option.textContent?.trim())
      .slice(1);
  }

  it("lists the log's types once each, sorted, and no exit lines", async () => {
    view.isVisible = true;
    view.logStore = storeOf(OUTER).store;
    const types = await typeOptions();

    expect(types).toEqual([...new Set(types)].sort());
    expect(types).toEqual(expect.arrayContaining(['METHOD_ENTRY', 'SOQL_EXECUTE_BEGIN']));
    expect(types).not.toContain('');
    expect(types).not.toContain('METHOD_EXIT');
  });

  it('builds nothing for a log whose call tree is never shown', async () => {
    view.remove();
    globalThis.IntersectionObserver = NeverVisible as unknown as typeof IntersectionObserver;
    view = new CalltreeView();
    document.body.append(view);
    const logIndex = jest.spyOn(LogStore.prototype, 'logIndex');
    view.logStore = storeOf(OUTER).store;
    await typeOptions();

    expect(logIndex).not.toHaveBeenCalled();
  });

  it('shows the types of the log it has now, not one it had before', async () => {
    const before = storeOf(OUTER).log;
    const logIndex = LogStore.prototype.logIndex;
    let release = (): void => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    // The earlier log's index lands last, as a slow build would.
    jest.spyOn(LogStore.prototype, 'logIndex').mockImplementation(function (this: LogStore) {
      const built = logIndex.call(this);
      return this.log === before ? held.then(() => built) : built;
    });

    view.isVisible = true;
    view.logStore = logStoreFor(before);
    await view.updateComplete;
    view.logStore = storeOf(DML).store;
    await typeOptions();
    release();
    const types = await typeOptions();

    expect(types).toContain('DML_BEGIN');
    expect(types).not.toContain('METHOD_ENTRY');
  });
});

describe('calltree-view find', () => {
  let view: CalltreeView;
  const results: number[] = [];
  const onResults = (e: Event): void => {
    results.push((e as CustomEvent<{ totalMatches: number }>).detail.totalMatches);
  };

  beforeEach(async () => {
    built = [];
    holdBuilds = false;
    globalThis.IntersectionObserver = AlwaysVisible as unknown as typeof IntersectionObserver;
    view = await mountView();
    results.length = 0;
    document.addEventListener('lv-find-results', onResults);
  });

  afterEach(() => {
    document.removeEventListener('lv-find-results', onResults);
    view.remove();
  });

  function startFind(text: string): void {
    const detail = { text, count: 1, options: { matchCase: false } };
    document.dispatchEvent(new CustomEvent('lv-find', { detail }));
  }

  async function find(text: string): Promise<void> {
    startFind(text);
    await settle();
  }

  function shownGrid(): NonNullable<CalltreeView['timeOrderGrid']> {
    const grid = view.timeOrderGrid;
    if (!grid) {
      throw new Error('no grid');
    }
    // jsdom does no layout, and find answers nothing for a view that is not on screen.
    Object.defineProperty(view, 'clientHeight', { configurable: true, value: 100 });
    jest.spyOn(grid, 'setCurrentMatch').mockResolvedValue();
    return grid;
  }

  it('shows no matches for a find a rebuild dropped, and searches again on the next Enter', async () => {
    const grid = shownGrid();
    const gridFind = jest
      .spyOn(grid, 'find')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ total: 2, current: -1 });

    await find('foo');
    expect(results).toEqual([0]);

    await find('foo');
    expect(gridFind).toHaveBeenCalledTimes(2);
    expect(results).toEqual([0, 2]);
  });

  it('ignores a find a newer one replaced', async () => {
    const grid = shownGrid();
    let finishFirst: (result: null) => void = () => {};
    jest
      .spyOn(grid, 'find')
      .mockImplementationOnce(() => new Promise((resolve) => (finishFirst = resolve)))
      .mockResolvedValueOnce({ total: 3, current: -1 });

    startFind('foo');
    await find('food');
    expect(results).toEqual([3]);

    finishFirst(null);
    await settle();
    expect(results).toEqual([3]);
  });

  it('searches again when the grid is reshaped under it', async () => {
    const grid = shownGrid();
    const gridFind = jest
      .spyOn(grid, 'find')
      .mockResolvedValueOnce({ total: 2, current: -1 })
      .mockResolvedValueOnce({ total: 1, current: -1 });

    await find('foo');
    grid.dispatchEvent(new CustomEvent('lv-grid-reshape', { detail: { reason: 'sort' } }));
    await settle();

    expect(gridFind).toHaveBeenLastCalledWith({ text: 'foo', matchCase: false });
    expect(results).toEqual([2, 1]);
  });

  it('clears the view it leaves, and searches the one it shows', async () => {
    const timeOrder = shownGrid();
    jest.spyOn(timeOrder, 'find').mockResolvedValue({ total: 2, current: -1 });
    const cleared = jest.spyOn(timeOrder, 'clearFind');
    await find('foo');
    // The new view's grid is made during the switch, so only its class can be stubbed.
    const gridFind = jest
      .spyOn(Object.getPrototypeOf(timeOrder) as typeof timeOrder, 'find')
      .mockResolvedValue({ total: 1, current: -1 });
    try {
      await view._setViewMode('bottom-up');
      await settle();

      expect(cleared).toHaveBeenCalled();
      expect(gridFind.mock.contexts).toContain(view.bottomUpGrid);
      expect(results[0]).toBe(2);
      expect(results.at(-1)).toBe(1);
    } finally {
      gridFind.mockRestore();
    }
  });

  it('keeps a search still running when the view switches, and searches the view it shows', async () => {
    const timeOrder = shownGrid();
    let finish: (result: null) => void = () => undefined;
    jest.spyOn(timeOrder, 'find').mockReturnValue(new Promise((resolve) => (finish = resolve)));
    // A clear ends a running grid search with null, as lv-grid does.
    jest.spyOn(timeOrder, 'clearFind').mockImplementation(() => finish(null));
    startFind('foo');
    const height = jest.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(100);
    const gridFind = jest
      .spyOn(Object.getPrototypeOf(timeOrder) as typeof timeOrder, 'find')
      .mockResolvedValue({ total: 1, current: -1 });
    try {
      await view._setViewMode('bottom-up');
      await settle();

      expect(results).not.toContain(0);
      expect(results.at(-1)).toBe(1);
    } finally {
      height.mockRestore();
      gridFind.mockRestore();
    }
  });
});
