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
  frameEventIndexes: jest.requireActual('../scopedCallTree.js').frameEventIndexes,
  rowIdsByPath: jest.requireActual('../scopedCallTree.js').rowIdsByPath,
}));

import { Tabulator, type RowComponent } from 'tabulator-tables';

import type { CallTreeDetail } from '../CallTreeDetail.js';
import '../CallTreeDetail.js';
import { buildScopedCallTree, type ScopedCallTree, type ScopedRow } from '../scopedCallTree.js';
import { INSPECTOR_LOCATE_EVENT, type InspectorLocateEvent } from '../inspectorReveal.js';
import { eventBus, type DetailSelection } from '../../core/events/EventBus.js';
import type { ProgressParams } from '../../tabulator/format/ProgressMS.js';
import { LOCATED_ROW_CLASS } from '../locatedRow.js';
import type { ApexLog } from 'apex-log-parser';

import { logStoreFor, type LogStore } from '../../core/log/LogStore.js';
import { ROOT_PATH_ID } from '../../core/log/keyPathIds.js';

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
  getSelectedRows: jest.Mock;
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

async function mount(
  eventIndex: number,
  sourceView?: 'callers' | 'callees',
): Promise<CallTreeDetail> {
  const el = document.createElement('call-tree-detail') as CallTreeDetail;
  el.eventIndex = eventIndex;
  el.sourceView = sourceView;
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

  it('leaves the row alone when the mark is already on it', async () => {
    build.mockImplementation((eventIndex) => Promise.resolve(tree(eventIndex * 1000)));
    const el = await mount(5);
    await frame(el);
    const table = tables.instances[0]!;
    const picked = { deselect: jest.fn(), getData: () => ({ id: 9 }) };
    table.getSelectedRows.mockReturnValue([picked]);
    table.selectRow.mockClear();

    el.activeEventIndex = 9;
    await frame(el);

    // Re-selecting it would re-render the row, and tabulator's row re-render
    // takes the table's focus with it.
    expect(picked.deselect).not.toHaveBeenCalled();
    expect(table.selectRow).not.toHaveBeenCalled();
  });

  it('keeps the picked row where a view merges occurrences', async () => {
    build.mockImplementation((eventIndex) => Promise.resolve(tree(eventIndex * 1000)));
    // A tab showing callees opens the inspector on bottom up, whose rows merge.
    const el = await mount(5, 'callees');
    await frame(el);
    const table = tables.instances[0]!;
    const picked = { deselect: jest.fn() };
    table.getSelectedRows.mockReturnValue([picked]);

    el.activeEventIndex = 9;
    await frame(el);

    expect(picked.deselect).not.toHaveBeenCalled();
    expect(table.selectRow).not.toHaveBeenCalled();
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
  it('marks the rows a frame names once the merged view has its rows', async () => {
    // A merged row is named by the bucket path it stands for, so the frame the
    // pointer reports has to be reachable through the log to be translated.
    const event = { eventIndex: 8, type: 'METHOD_ENTRY', namespace: '', text: 'm' };
    const log = { eventsById: [] as unknown[], children: [] };
    log.eventsById[8] = { ...event, parent: log, children: [] };
    const paths = logStoreFor(log as unknown as ApexLog).keyPathIds();
    const pathId = paths.step(ROOT_PATH_ID, paths.keyId('METHOD_ENTRY||m'));
    const merged = [
      { id: -3, eventIndexes: [8, 12], _pathId: pathId, _children: null },
    ] as unknown as ScopedRow[];
    const resolvers = deferBuilds();
    const el = await mount(5, 'callees');
    el.logStore = { log } as unknown as LogStore;
    await frame(el);
    const grid = el.shadowRoot!.querySelector('.table-host:not(.is-hidden) .grid')!;
    const row = document.createElement('div');
    row.classList.add('tabulator-row');
    row.setAttribute('data-row-index', '-3');
    grid.append(row);

    // The pointer reports a frame while the walk is still running.
    eventBus.emit('detail:locate', { source: 'timeline', eventIndexes: [8] });
    expect(row.classList.contains(LOCATED_ROW_CLASS)).toBe(false);

    resolvers[0]!({
      ...tree(5000),
      aggregated: () => Promise.resolve(merged),
      bottomUp: () => Promise.resolve(merged),
    });
    await frame(el);
    const tableBuilt = tables.instances[0]!.on.mock.calls.find(
      (call) => call[0] === 'tableBuilt',
    )?.[1] as (() => void) | undefined;

    // The tree finished after the report, so the build marks what was reported.
    tableBuilt?.();

    expect(row.classList.contains(LOCATED_ROW_CLASS)).toBe(true);
  });

  it('leaves a frame the scope does not hold unmarked, path or no path', async () => {
    // The scoped views hold only the selection's own calls, but a merged row is
    // named by its bucket path — which a second call of the same method
    // elsewhere in the log shares.
    const event = { eventIndex: 8, type: 'METHOD_ENTRY', namespace: '', text: 'm' };
    const log = { eventsById: [] as unknown[], children: [] };
    log.eventsById[8] = { ...event, parent: log, children: [] };
    log.eventsById[12] = { ...event, eventIndex: 12, parent: log, children: [] };
    const paths = logStoreFor(log as unknown as ApexLog).keyPathIds();
    const pathId = paths.step(ROOT_PATH_ID, paths.keyId('METHOD_ENTRY||m'));
    const merged = [
      { id: -3, eventIndexes: [8], _pathId: pathId, _children: null },
    ] as unknown as ScopedRow[];
    build.mockResolvedValue({
      ...tree(5000),
      holds: (eventIndex: number) => eventIndex === 8,
      aggregated: () => Promise.resolve(merged),
      bottomUp: () => Promise.resolve(merged),
    });
    const el = await mount(5, 'callees');
    el.logStore = { log } as unknown as LogStore;
    await frame(el);
    const grid = el.shadowRoot!.querySelector('.table-host:not(.is-hidden) .grid')!;
    const row = document.createElement('div');
    row.classList.add('tabulator-row');
    row.setAttribute('data-row-index', '-3');
    grid.append(row);

    // Frame 12 sits at the same path as the row, but the scope never held it.
    eventBus.emit('detail:locate', { source: 'timeline', eventIndexes: [12] });
    expect(row.classList.contains(LOCATED_ROW_CLASS)).toBe(false);

    eventBus.emit('detail:locate', { source: 'timeline', eventIndexes: [8] });
    expect(row.classList.contains(LOCATED_ROW_CLASS)).toBe(true);
  });

  it('names the picked bottom-up row, so one caller depth reads apart from the next', async () => {
    build.mockImplementation((eventIndex) => Promise.resolve(tree(eventIndex * 1000)));
    const el = await mount(5, 'callees');
    await frame(el);
    const pick = tables.instances[0]!.on.mock.calls.find(
      (call) => call[0] === 'rowSelectionChanged',
    )?.[1] as ((...args: unknown[]) => void) | undefined;

    const seen: Array<DetailSelection | null | undefined> = [];
    const located = (e: Event) => seen.push((e as InspectorLocateEvent).detail.selection);
    document.addEventListener(INSPECTOR_LOCATE_EVENT, located);

    // A seed row and the two caller depths above it, which hold the same call.
    const fakeRow = (data: unknown, parent?: unknown) =>
      ({ getData: () => data, getTreeParent: () => parent ?? false }) as unknown as RowComponent;
    const seed = fakeRow({ id: -1, text: 'seed', eventIndexes: [8] });
    const depth2 = fakeRow({ id: -2, text: 'B', eventIndexes: [8] }, seed);
    pick?.(null, [seed]);
    pick?.(null, [depth2]);
    pick?.(null, [fakeRow({ id: -3, text: 'A', eventIndexes: [8] }, depth2)]);

    document.removeEventListener(INSPECTOR_LOCATE_EVENT, located);
    // The seed names its own calls; each caller depth names itself.
    expect(
      seen.map((selection) => (selection?.kind === 'aggregate' ? selection.calledBy : null)),
    ).toEqual([undefined, 'B', 'A']);
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
