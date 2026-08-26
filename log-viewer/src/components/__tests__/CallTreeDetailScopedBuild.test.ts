/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { beforeEach, describe, expect, it } from '@jest/globals';

// The swc transform can't parse `.scss`/`.css`; stub the stylesheet assets.
jest.mock('../../tabulator/style/DataGrid.scss', () => ({ default: '' }));
jest.mock('../../tabulator/format/Progress.css', () => ({}));
// The tabulator ESM build (+ its module registrations) doesn't load under jest;
// this stub records what the component does to a table instead.
jest.mock('tabulator-tables', () => {
  class Tabulator {
    static registerModule() {}
    static instances: Tabulator[] = [];
    setData = jest.fn(() => Promise.resolve());
    redraw = jest.fn();
    destroy = jest.fn();
    on = jest.fn();
    getSelectedRows = jest.fn(() => []);
    selectRow = jest.fn();
    options: Record<string, unknown>;
    constructor(_element: HTMLElement, options: Record<string, unknown>) {
      this.options = options;
      Tabulator.instances.push(this);
    }
  }
  return { Tabulator, Module: class {}, Renderer: class {} };
});
// vscode-button needs ElementInternals.setFormValue (absent in jsdom).
jest.mock('#vscode-elements/vscode-button.js', () => ({}));

// The walk is what this suite is about, so it's stubbed; each test says whether
// it yields a tree or nothing, and when.
jest.mock('../scopedCallTree.js', () => ({
  buildScopedCallTree: jest.fn(() => Promise.resolve(null)),
  // Keep the real row readers: the hover test is about which rows name a frame.
  revealableEventIndex: jest.requireActual('../scopedCallTree.js').revealableEventIndex,
  locatableEventIndexes: jest.requireActual('../scopedCallTree.js').locatableEventIndexes,
}));

import { Tabulator } from 'tabulator-tables';

import type { CallTreeDetail } from '../CallTreeDetail.js';
import '../CallTreeDetail.js';
import { buildScopedCallTree, type ScopedCallTree } from '../scopedCallTree.js';
import { INSPECTOR_LOCATE_EVENT, type InspectorLocateEvent } from '../inspectorReveal.js';
import type { ProgressParams } from '../../tabulator/format/ProgressMS.js';

const build = jest.mocked(buildScopedCallTree);

interface StubTable {
  options: {
    columns: Array<{ field: string; formatterParams: ProgressParams; width: number }>;
    placeholder: () => string;
  };
  on: jest.Mock;
  setData: jest.Mock;
  redraw: jest.Mock;
  destroy: jest.Mock;
  selectRow: jest.Mock;
}

/** The stub tables built so far, oldest first. */
const tables = Tabulator as unknown as { instances: StubTable[] };

/** A scoped tree with no rows — only its totals matter to these tests. */
function tree(rootTotal: number): ScopedCallTree {
  return {
    rootTotal,
    calls: 1,
    logTotal: 5_000_000,
    timeOrderMerged: false,
    timeOrder: () => Promise.resolve([]),
    aggregated: () => Promise.resolve([]),
    bottomUp: () => Promise.resolve([]),
  };
}

/** Holds every build open, so a test decides when — and in which order — the
 *  walks finish. Returns the resolvers, one per build, in start order. */
function deferBuilds(): Array<(scoped: ScopedCallTree | null) => void> {
  const resolvers: Array<(scoped: ScopedCallTree | null) => void> = [];
  build.mockImplementation(() => new Promise((resolve) => resolvers.push(resolve)));
  return resolvers;
}

function totalColumn(table: StubTable) {
  const column = table.options.columns.find((c) => c.field === 'duration.total');
  if (!column) {
    throw new Error('Total column not built');
  }
  return column;
}

/** The build chain awaits more than once, so keep re-awaiting the render rather
 *  than counting microtasks. */
async function settle(el: CallTreeDetail): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await el.updateComplete;
  }
}

/** Lets the rAF the build waits behind fire, then settles the render. */
async function frame(el: CallTreeDetail): Promise<void> {
  await new Promise((resolve) => requestAnimationFrame(resolve));
  await settle(el);
}

async function mount(eventIndex: number): Promise<CallTreeDetail> {
  const el = document.createElement('call-tree-detail') as CallTreeDetail;
  el.eventIndex = eventIndex;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

describe('CallTreeDetail scoped build', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    build.mockReset();
    build.mockResolvedValue(null);
    tables.instances.length = 0;
  });

  it('defers the walk past the paint yield', async () => {
    const el = await mount(5);

    // The selection has been applied and rendered; the walk has not run yet.
    expect(build).not.toHaveBeenCalled();

    await frame(el);
    expect(build.mock.calls).toEqual([[5, null, expect.anything()]]);
  });

  it('walks only the latest scope when selections arrive back to back', async () => {
    const el = await mount(5);
    el.eventIndex = 6;
    await el.updateComplete;

    // Both switches are still behind the same yield; the epoch guard drops the
    // superseded one before it can pay for a walk nobody is waiting on.
    await frame(el);
    expect(build.mock.calls).toEqual([[6, null, expect.anything()]]);
  });

  it('re-fills the built table for a new selection instead of rebuilding it', async () => {
    build.mockImplementation((eventIndex) => Promise.resolve(tree(eventIndex * 1000)));
    const el = await mount(5);
    await frame(el);
    expect(tables.instances).toHaveLength(1);
    const table = tables.instances[0]!;

    el.eventIndex = 6;
    await el.updateComplete;
    await frame(el);

    // Same table, re-filled — a Tabulator is expensive to construct, and its
    // construction is what used to land on the selection's critical path. Two
    // fills: the previous selection's rows are cleared before the walk, then
    // the new ones land.
    expect(tables.instances).toHaveLength(1);
    expect(table.destroy).not.toHaveBeenCalled();
    expect(table.setData).toHaveBeenCalledTimes(2);
  });

  it('moves the mark without re-walking, since the anchor holds the scope', async () => {
    build.mockImplementation((eventIndex) => Promise.resolve(tree(eventIndex * 1000)));
    const el = await mount(5);
    await frame(el);
    const table = tables.instances[0]!;
    build.mockClear();
    table.setData.mockClear();

    el.activeEventIndex = 9;
    await frame(el);

    expect(table.selectRow).toHaveBeenCalledWith([9]);
    expect(build).not.toHaveBeenCalled();
    expect(table.setData).not.toHaveBeenCalled();
  });

  it('retargets the percentage denominator without touching the bar width', async () => {
    build.mockImplementation((eventIndex) => Promise.resolve(tree(eventIndex * 1000)));
    const el = await mount(5);
    await frame(el);
    const column = totalColumn(tables.instances[0]!);
    const widthAtBuild = column.width;
    expect(column.formatterParams.totalValue).toBe(5000);

    el.eventIndex = 6;
    await el.updateComplete;
    await frame(el);

    // The formatters read these params by reference at render time, so the new
    // selection's total reaches the bars with the columns left as they were.
    expect(column.formatterParams.totalValue).toBe(6000);
    expect(column.width).toBe(widthAtBuild);
  });

  it('clears the stale rows and says the walk is running', async () => {
    const resolvers = deferBuilds();
    const el = await mount(5);
    await frame(el);
    resolvers[0]!(tree(5000));
    await settle(el);
    const table = tables.instances[0]!;
    expect(table.options.placeholder()).toBe('No call tree available');

    el.eventIndex = 6;
    await el.updateComplete;
    await frame(el);

    // The rows on screen describe the previous selection, so they go before the
    // walk starts; Tabulator re-reads the placeholder each time it shows one.
    expect(table.setData).toHaveBeenLastCalledWith([]);
    expect(table.options.placeholder()).toBe('Building the call tree…');

    resolvers[1]!(tree(6000));
    await settle(el);
    expect(table.options.placeholder()).toBe('No call tree available');
  });

  it('drops a superseded walk that finishes after the newer one', async () => {
    const resolvers = deferBuilds();
    const el = await mount(5);
    await frame(el);
    el.eventIndex = 6;
    await el.updateComplete;
    await frame(el);
    expect(resolvers).toHaveLength(2);

    // The newer walk finishes first; the stale one lands afterwards, as it would
    // if its own scope were simply wider.
    resolvers[1]!(tree(6000));
    await settle(el);
    expect(totalColumn(tables.instances[0]!).formatterParams.totalValue).toBe(6000);

    resolvers[0]!(tree(5000));
    await settle(el);
    // The epoch guard drops it — the denominator still describes what's shown.
    expect(tables.instances).toHaveLength(1);
    expect(totalColumn(tables.instances[0]!).formatterParams.totalValue).toBe(6000);
  });
  it('reports every occurrence the row under the pointer stands for', async () => {
    build.mockImplementation((eventIndex) => Promise.resolve(tree(eventIndex * 1000)));
    const el = await mount(5);
    await frame(el);
    const handler = (event: string) =>
      tables.instances[0]!.on.mock.calls.find((call) => call[0] === event)?.[1] as
        ((...args: unknown[]) => void) | undefined;

    const seen: Array<readonly number[]> = [];
    const located = (e: Event) => seen.push((e as InspectorLocateEvent).detail.eventIndexes);
    document.addEventListener(INSPECTOR_LOCATE_EVENT, located);

    handler('rowMouseEnter')?.({}, { getData: () => ({ id: 8, originalData: { eventIndex: 8 } }) });
    handler('rowMouseLeave')?.({}, {});
    // A grouped row cannot be revealed, but every occurrence it merges is marked.
    handler('rowMouseEnter')?.({}, { getData: () => ({ id: -3, eventIndexes: [8, 12] }) });

    document.removeEventListener(INSPECTOR_LOCATE_EVENT, located);
    expect(seen).toEqual([[8], [], [8, 12]]);
  });
});
