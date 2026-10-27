/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

// The walk is what this suite is about, so it's stubbed; each test says whether
// it yields a tree or nothing, and when.
jest.mock('../scopedCallTree.js', () => ({
  buildScopedCallTree: jest.fn(() => Promise.resolve(null)),
  buildWholeLogCallTree: jest.fn(() => Promise.resolve(null)),
  // Keep the real row readers: the hover test is about which rows name a frame.
  revealableEventIndex: jest.requireActual('../scopedCallTree.js').revealableEventIndex,
  locatableEventIndexes: jest.requireActual('../scopedCallTree.js').locatableEventIndexes,
  frameEventIndexes: jest.requireActual('../scopedCallTree.js').frameEventIndexes,
  rowIdsByPath: jest.requireActual('../scopedCallTree.js').rowIdsByPath,
}));

import type { ApexLog } from '@apexdevtools/apex-log-parser';

import { runCalc } from '#test-helpers/calcs.js';

import type { CallTreeDetail } from '../CallTreeDetail.js';
import '../CallTreeDetail.js';
import type { AppGrid } from '../grid/AppGrid.js';
import {
  buildScopedCallTree,
  buildWholeLogCallTree,
  type LiveWindow,
  type ScopedCallTree,
  type ScopedRow,
} from '../scopedCallTree.js';
import { INSPECTOR_LOCATE_EVENT, type InspectorLocateEvent } from '../inspectorReveal.js';
import { eventBus, type DetailSelection } from '../../core/events/EventBus.js';
import { logStoreFor, type LogStore } from '../../core/log/LogStore.js';
import { ROOT_PATH_ID } from '../../core/log/keyPathIds.js';
import { setRange, type TimeWindow } from '../../core/log/rangeScope.js';

const build = jest.mocked(buildScopedCallTree);
const wholeBuild = jest.mocked(buildWholeLogCallTree);

const MODES = ['time-order', 'aggregated', 'bottom-up'];

/** A row of one frame, keyed by its event index. */
function frameRow(id: number, children: ScopedRow[] | null = null): ScopedRow {
  return {
    id,
    originalData: { eventIndex: id, type: 'METHOD_ENTRY', text: `m${id}` },
    text: `m${id}`,
    type: 'METHOD_ENTRY',
    duration: { total: 10, self: 5 },
    callCount: 1,
    eventIndexes: null,
    _children: children,
  } as unknown as ScopedRow;
}

/** A scoped tree whose views hold `rows`. */
function tree(rootTotal: number, rows: ScopedRow[] = []): ScopedCallTree {
  return {
    rootTotal,
    calls: 1,
    logTotal: 5_000_000,
    timeOrderMerged: false,
    timeOrder: () => Promise.resolve(rows),
    aggregated: () => Promise.resolve(rows),
    bottomUp: () => Promise.resolve(rows),
  };
}

/** Holds every build open, so a test decides when — and in which order — the
 *  walks finish. Returns the resolvers, one per build, in start order. */
function deferBuilds(): Array<(scoped: ScopedCallTree | null) => void> {
  const resolvers: Array<(scoped: ScopedCallTree | null) => void> = [];
  build.mockImplementation(() => new Promise((resolve) => resolvers.push(resolve)));
  return resolvers;
}

function gridOf(el: CallTreeDetail, mode = 'time-order'): AppGrid<ScopedRow> {
  const grid = el.shadowRoot?.querySelectorAll('lv-app-grid')[MODES.indexOf(mode)];
  if (!grid) {
    throw new Error(`No ${mode} grid`);
  }
  return grid as AppGrid<ScopedRow>;
}

/** The Name column's tooltip, read off the grid. */
function nameTooltip(el: CallTreeDetail, node: { text: string; type: string }): string {
  const name = gridOf(el).columns.find((column) => column.id === 'text');
  if (!name?.tooltip) {
    throw new Error('Name column has no tooltip');
  }
  return name.tooltip({ originalData: node, type: node.type } as unknown as ScopedRow);
}

/** The footer a column's calc gives over the grid's rows. */
function footer(grid: AppGrid<ScopedRow>, id: string): number | undefined {
  const calc = grid.columns.find((column) => column.id === id)?.calc;
  return runCalc(calc, grid.source?.roots ?? []);
}

function fire(grid: AppGrid<ScopedRow>, type: string, detail: object): void {
  grid.dispatchEvent(new CustomEvent(type, { detail, bubbles: true }));
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

  it('fills the same grid for a new selection', async () => {
    const next = [frameRow(6)];
    build.mockImplementation((eventIndex) =>
      Promise.resolve(tree(eventIndex * 1000, eventIndex === 6 ? next : [frameRow(5)])),
    );
    const el = await mount(5);
    await frame(el);
    const grid = gridOf(el);

    el.eventIndex = 6;
    await el.updateComplete;
    await frame(el);

    expect(gridOf(el)).toBe(grid);
    expect(grid.source?.roots).toBe(next);
  });

  it('lets its grids go on a detach, and fills them again without walking again', async () => {
    build.mockImplementation((eventIndex) =>
      Promise.resolve(tree(eventIndex * 1000, [frameRow(5)])),
    );
    const el = await mount(5);
    await frame(el);
    const roots = gridOf(el).source?.roots;
    build.mockClear();

    el.remove();
    await Promise.resolve();
    await el.updateComplete;
    expect(gridOf(el).source).toBeNull();

    document.body.append(el);
    await frame(el);

    expect(build).not.toHaveBeenCalled();
    expect(gridOf(el).source?.roots).toEqual(roots);
  });

  it('moves the mark without re-walking, since the anchor holds the scope', async () => {
    build.mockImplementation((eventIndex) =>
      Promise.resolve(tree(eventIndex * 1000, [frameRow(5), frameRow(9)])),
    );
    const el = await mount(5);
    await frame(el);
    const grid = gridOf(el);
    const source = grid.source;
    const goTo = jest.spyOn(grid, 'goTo').mockResolvedValue(true);
    build.mockClear();

    el.activeEventIndex = 9;
    await frame(el);

    expect(goTo).toHaveBeenCalledWith([9], { scrollIfVisible: false });
    expect(build).not.toHaveBeenCalled();
    expect(grid.source).toBe(source);
  });

  it('opens the way to an active frame deep in the tree', async () => {
    const store = logStoreFor({ eventsById: [] } as unknown as ApexLog);
    jest
      .spyOn(store, 'stackByEventIndex')
      .mockReturnValue([{ eventIndex: 5 }, { eventIndex: 7 }] as never);
    build.mockResolvedValue(tree(5000, [frameRow(5, [frameRow(7, [frameRow(9)])])]));
    const el = await mount(5);
    el.logStore = store;
    await frame(el);
    const goTo = jest.spyOn(gridOf(el), 'goTo').mockResolvedValue(true);

    el.activeEventIndex = 9;
    await frame(el);

    expect(goTo).toHaveBeenCalledWith([5, 7, 9], { scrollIfVisible: false });
  });

  it('marks an active frame that moved while another view was on screen', async () => {
    build.mockResolvedValue(tree(5000, [frameRow(5), frameRow(9)]));
    const el = await mount(5);
    // The view picked is kept per log, so a switch needs one.
    el.logStore = logStoreFor({ eventsById: [] } as unknown as ApexLog);
    await frame(el);
    const goTo = jest.spyOn(gridOf(el), 'goTo').mockResolvedValue(true);
    const switcher = el.shadowRoot?.querySelector('view-mode-switch');
    const showMode = async (value: string) => {
      switcher?.dispatchEvent(new CustomEvent('view-mode-change', { detail: { value } }));
      await frame(el);
    };

    await showMode('aggregated');
    el.activeEventIndex = 9;
    await frame(el);
    expect(goTo).not.toHaveBeenCalled();
    await showMode('time-order');

    expect(goTo).toHaveBeenCalledWith([9], { scrollIfVisible: false });
  });

  it('marks the active frame again when a click clears its row', async () => {
    build.mockResolvedValue(tree(5000, [frameRow(5), frameRow(9)]));
    const el = await mount(5);
    await frame(el);
    const goTo = jest.spyOn(gridOf(el), 'goTo').mockResolvedValue(true);
    el.activeEventIndex = 9;
    await frame(el);
    goTo.mockClear();

    fire(gridOf(el), 'lv-grid-select', { row: null, target: null, user: true });
    await Promise.resolve();

    expect(goTo).toHaveBeenCalledWith([9], { scrollIfVisible: false });
  });

  it('keeps the picked row where a view merges occurrences', async () => {
    build.mockImplementation((eventIndex) => Promise.resolve(tree(eventIndex * 1000)));
    // A tab showing callees opens the inspector on bottom up, whose rows merge.
    const el = await mount(5, 'callees');
    await frame(el);
    const grid = gridOf(el, 'bottom-up');
    const goTo = jest.spyOn(grid, 'goTo');
    const deselect = jest.spyOn(grid, 'deselect');

    el.activeEventIndex = 9;
    await frame(el);

    expect(goTo).not.toHaveBeenCalled();
    expect(deselect).not.toHaveBeenCalled();
  });

  it('retargets the percentage denominator without touching the columns', async () => {
    build.mockImplementation((eventIndex) => Promise.resolve(tree(eventIndex * 1000)));
    const el = await mount(5);
    await frame(el);
    const grid = gridOf(el);
    const columns = grid.columns;
    expect(footer(grid, 'duration.total')).toBe(5000);

    el.eventIndex = 6;
    await el.updateComplete;
    await frame(el);

    // The cells and footers read the total at paint, so the columns stay as they were.
    expect(footer(grid, 'duration.total')).toBe(6000);
    expect(grid.columns).toBe(columns);
  });

  it('clears the stale rows and says the walk is running', async () => {
    const resolvers = deferBuilds();
    const el = await mount(5);
    await frame(el);
    resolvers[0]!(tree(5000, [frameRow(5)]));
    await settle(el);
    const grid = gridOf(el);
    expect(grid.placeholder).toBe('No call tree available');

    el.eventIndex = 6;
    await el.updateComplete;
    await frame(el);

    // The rows on screen describe the previous selection, so they go before the walk starts.
    expect(grid.source?.roots).toEqual([]);
    expect(grid.placeholder).toBe('Building the call tree…');

    resolvers[1]!(tree(6000));
    await settle(el);
    expect(grid.placeholder).toBe('No call tree available');
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
    expect(footer(gridOf(el), 'duration.total')).toBe(6000);

    resolvers[0]!(tree(5000));
    await settle(el);
    // The epoch guard drops it — the denominator still describes what's shown.
    expect(footer(gridOf(el), 'duration.total')).toBe(6000);
  });

  /** A log whose frames 8 and 12 call the same method from the root, and the bucket path of that call. */
  function samePathLog(): { log: ApexLog; pathId: number } {
    const event = { eventIndex: 8, type: 'METHOD_ENTRY', namespace: '', text: 'm' };
    const log = { eventsById: [] as unknown[], children: [] };
    log.eventsById[8] = { ...event, parent: log, children: [] };
    log.eventsById[12] = { ...event, eventIndex: 12, parent: log, children: [] };
    const paths = logStoreFor(log as unknown as ApexLog).keyPathIds();
    const pathId = paths.step(ROOT_PATH_ID, paths.keyId('METHOD_ENTRY||m'));
    return { log: log as unknown as ApexLog, pathId };
  }

  it('marks the rows a frame names once the merged view has its rows', async () => {
    // A merged row is named by the bucket path it stands for, so the frame the
    // pointer reports has to be reachable through the log to be translated.
    const { log, pathId } = samePathLog();
    const merged = [
      { ...frameRow(-3), eventIndexes: [8, 12], _pathId: pathId },
    ] as unknown as ScopedRow[];
    const resolvers = deferBuilds();
    const el = await mount(5, 'callees');
    el.logStore = { log } as unknown as LogStore;
    await frame(el);

    // The pointer reports a frame while the walk is still running.
    eventBus.emit('detail:locate', { source: 'timeline', eventIndexes: [8] });
    await el.updateComplete;
    expect([...gridOf(el, 'bottom-up').marked]).toEqual([]);

    resolvers[0]!({
      ...tree(5000),
      aggregated: () => Promise.resolve(merged),
      bottomUp: () => Promise.resolve(merged),
    });
    await frame(el);

    // The tree finished after the report, so the fill marks what was reported.
    expect([...gridOf(el, 'bottom-up').marked]).toEqual([-3]);
  });

  it('moves the marks to the rows of the view switched to', async () => {
    const { log, pathId } = samePathLog();
    const merged = [
      { ...frameRow(-3), eventIndexes: [8, 12], _pathId: pathId },
    ] as unknown as ScopedRow[];
    build.mockResolvedValue({
      ...tree(5000, [frameRow(8)]),
      bottomUp: () => Promise.resolve(merged),
    });
    const el = await mount(5);
    el.logStore = { log } as unknown as LogStore;
    await frame(el);
    eventBus.emit('detail:locate', { source: 'timeline', eventIndexes: [8] });
    await el.updateComplete;
    expect([...gridOf(el).marked]).toEqual([8]);

    el.shadowRoot
      ?.querySelector('view-mode-switch')
      ?.dispatchEvent(new CustomEvent('view-mode-change', { detail: { value: 'bottom-up' } }));
    await frame(el);

    expect([...gridOf(el).marked]).toEqual([]);
    expect([...gridOf(el, 'bottom-up').marked]).toEqual([-3]);
  });

  it('leaves a frame the scope does not hold unmarked, path or no path', async () => {
    // The scoped views hold only the selection's own calls, but a merged row is
    // named by its bucket path — which a second call of the same method
    // elsewhere in the log shares.
    const { log, pathId } = samePathLog();
    const merged = [
      { ...frameRow(-3), eventIndexes: [8], _pathId: pathId },
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
    const grid = gridOf(el, 'bottom-up');

    // Frame 12 sits at the same path as the row, but the scope never held it.
    eventBus.emit('detail:locate', { source: 'timeline', eventIndexes: [12] });
    await el.updateComplete;
    expect([...grid.marked]).toEqual([]);

    eventBus.emit('detail:locate', { source: 'timeline', eventIndexes: [8] });
    await el.updateComplete;
    expect([...grid.marked]).toEqual([-3]);
  });

  it('hovers a truncated name with the label the cell shows', async () => {
    build.mockResolvedValue(tree(5000, [frameRow(5)]));
    const el = await mount(5);
    await frame(el);

    // `eventLabel` prefixes the type where the text cannot stand alone, which is
    // what the cell renders — the raw `text` field alone would say only "true".
    expect(nameTooltip(el, { text: 'true', type: 'STATEMENT_EXECUTE' })).toBe(
      'STATEMENT_EXECUTE: true',
    );
  });

  it('keeps the generics in a signature the hover has to show', async () => {
    build.mockResolvedValue(tree(5000, [frameRow(5)]));
    const el = await mount(5);
    await frame(el);

    const signature = 'ContactTriggerHandler.handleAfterUpdate(List<Contact>, Map<Id,Contact>)';
    expect(nameTooltip(el, { text: signature, type: 'METHOD_ENTRY' })).toBe(signature);
  });

  it('names each grid by its view for a screen reader', async () => {
    build.mockResolvedValue(tree(5000, [frameRow(5)]));
    const el = await mount(5);

    expect(MODES.map((mode) => gridOf(el, mode).label)).toEqual([
      'Call tree, Time Order',
      'Call tree, Aggregated',
      'Call tree, Bottom-Up',
    ]);
  });

  it('names the picked bottom-up row, so one caller depth reads apart from the next', async () => {
    // A seed row and the two caller depths above it, which hold the same call.
    const a = { ...frameRow(-3), text: 'A', eventIndexes: [8] };
    const depth2 = { ...frameRow(-2, [a]), text: 'B', eventIndexes: [8] };
    const seed = { ...frameRow(-1, [depth2]), text: 'seed', eventIndexes: [8] };
    build.mockResolvedValue(tree(5000, [seed]));
    const el = await mount(5, 'callees');
    await frame(el);
    const grid = gridOf(el, 'bottom-up');

    const seen: Array<DetailSelection | null | undefined> = [];
    const located = (e: Event) => seen.push((e as InspectorLocateEvent).detail.selection);
    document.addEventListener(INSPECTOR_LOCATE_EVENT, located);
    for (const row of [seed, depth2, a]) {
      fire(grid, 'lv-grid-select', { row, target: row.id, user: true });
    }
    document.removeEventListener(INSPECTOR_LOCATE_EVENT, located);

    // The seed names its own calls; each caller depth names itself.
    expect(
      seen.map((selection) => (selection?.kind === 'aggregate' ? selection.calledBy : null)),
    ).toEqual([undefined, 'B', 'A']);
  });

  it('holds a mark on every frame a picked merged row stands for', async () => {
    const merged = { ...frameRow(-3), eventIndexes: [8, 12] };
    build.mockResolvedValue(tree(5000, [merged]));
    const el = await mount(5, 'callees');
    await frame(el);

    const seen: unknown[] = [];
    const located = (e: Event) => seen.push((e as InspectorLocateEvent).detail);
    document.addEventListener(INSPECTOR_LOCATE_EVENT, located);
    fire(gridOf(el, 'bottom-up'), 'lv-grid-select', { row: merged, target: -3, user: true });
    document.removeEventListener(INSPECTOR_LOCATE_EVENT, located);

    expect(seen).toEqual([
      {
        eventIndexes: [8, 12],
        sticky: true,
        selection: { kind: 'aggregate', instances: [8, 12], frames: [8, 12], calledBy: undefined },
      },
    ]);
  });

  it('drops on Escape the row picked in the view on screen, whichever view last picked', async () => {
    build.mockResolvedValue(tree(5000, [frameRow(5)]));
    const el = await mount(5, 'callees');
    await frame(el);
    // The view on screen still holds a pick, though another view cleared its own since.
    const deselect = jest.spyOn(gridOf(el, 'bottom-up'), 'deselect').mockReturnValue(true);
    fire(gridOf(el, 'time-order'), 'lv-grid-select', { row: null, target: null, user: true });

    const seen: Array<{ eventIndexes: readonly number[]; sticky: boolean }> = [];
    const located = (e: Event) => seen.push((e as InspectorLocateEvent).detail);
    document.addEventListener(INSPECTOR_LOCATE_EVENT, located);
    eventBus.emit('selection:clear', { source: 'calltree' });
    deselect.mockReturnValue(false);
    eventBus.emit('selection:clear', { source: 'calltree' });
    document.removeEventListener(INSPECTOR_LOCATE_EVENT, located);

    // Once for the pick it dropped; nothing when there was none.
    expect(seen.map(({ eventIndexes, sticky }) => ({ eventIndexes, sticky }))).toEqual([
      { eventIndexes: [], sticky: true },
    ]);
  });

  it('reports every occurrence the row under the pointer stands for', async () => {
    build.mockResolvedValue(tree(5000));
    const el = await mount(5);
    await frame(el);
    const grid = gridOf(el);

    const seen: Array<readonly number[]> = [];
    const located = (e: Event) => seen.push((e as InspectorLocateEvent).detail.eventIndexes);
    document.addEventListener(INSPECTOR_LOCATE_EVENT, located);
    fire(grid, 'lv-grid-locate', { row: { id: 8, originalData: { eventIndex: 8 } } });
    // A grouped row cannot be revealed, but every occurrence it merges is marked.
    fire(grid, 'lv-grid-locate', { row: { id: -3, eventIndexes: [8, 12] } });
    document.removeEventListener(INSPECTOR_LOCATE_EVENT, located);

    expect(seen).toEqual([[8], [8, 12]]);
  });
});

describe('CallTreeDetail whole-log tree following the window', () => {
  /** Every window the tree was read in, in order. */
  let readIn: Array<TimeWindow | null>;
  /** How the next read-ahead lands; a test can hold it open. */
  let prepare: jest.Mock<Promise<boolean>, Parameters<LiveWindow['prepare']>>;
  /** Rows the next `waiting()` hands back. */
  let waiting: ScopedRow[];
  let admit: jest.Mock<boolean, [ScopedRow]>;

  function liveTree(): ScopedCallTree {
    const live: LiveWindow = {
      prepare,
      figures: (window) => ({
        rootTotal: window ? window.end - window.start : 5000,
        calls: 7,
        self: window ? 42 : null,
        frameSelf: window ? 40 : null,
      }),
      set: (window) => {
        readIn.push(window);
        return live.figures(window);
      },
      admit,
      waiting: () => waiting.splice(0),
    };
    return { ...tree(5000, [frameRow(1)]), liveWindow: () => live };
  }

  beforeEach(() => {
    document.body.replaceChildren();
    wholeBuild.mockReset();
    wholeBuild.mockImplementation(() => Promise.resolve(liveTree()));
    readIn = [];
    waiting = [];
    admit = jest.fn<boolean, [ScopedRow]>(() => true);
    prepare = jest.fn<Promise<boolean>, Parameters<LiveWindow['prepare']>>(() =>
      Promise.resolve(true),
    );
  });

  afterEach(() => {
    setRange(null);
    jest.restoreAllMocks();
  });

  /** Mounts the whole-log tree with each grid's refresh counted, not run. */
  async function mountWholeLog(): Promise<CallTreeDetail> {
    const el = document.createElement('call-tree-detail') as CallTreeDetail;
    el.wholeLog = true;
    // A picked view is remembered per log, so without one a pick does not hold.
    el.logStore = { log: {} } as unknown as LogStore;
    document.body.appendChild(el);
    await el.updateComplete;
    for (const mode of MODES) {
      jest.spyOn(gridOf(el, mode), 'refresh').mockResolvedValue();
    }
    await frame(el);
    return el;
  }

  async function show(el: CallTreeDetail, value: string): Promise<void> {
    el.shadowRoot!.querySelector('view-mode-switch')!.dispatchEvent(
      new CustomEvent('view-mode-change', { detail: { value } }),
    );
    await frame(el);
  }

  it('filters its rows through the window once the rows are read ahead', async () => {
    const el = await mountWholeLog();
    const row = frameRow(1);

    // Not yet read ahead, so a filter would keep every row.
    expect(gridOf(el).filters).toEqual([]);

    setRange({ start: 100, end: 300 });
    await settle(el);
    admit.mockReturnValue(false);

    expect(gridOf(el).filters[0]?.test(row)).toBe(false);
    expect(admit).toHaveBeenCalledWith(row);
  });

  it('follows a moving window in the same rows, without walking the log again', async () => {
    const el = await mountWholeLog();
    const grid = gridOf(el);
    const source = grid.source;
    wholeBuild.mockClear();

    setRange({ start: 100, end: 300 });
    await settle(el);

    expect(wholeBuild).not.toHaveBeenCalled();
    expect(grid.source).toBe(source);
    expect(grid.refresh).toHaveBeenCalledTimes(1);
    expect(readIn.at(-1)).toEqual({ start: 100, end: 300 });
    // The bars and footers read the window's total.
    expect(footer(grid, 'duration.total')).toBe(200);
  });

  // The first window reads ahead in slices; until it lands the rows keep the
  // whole log's figures rather than read themselves in one frame.
  it('reads the rows ahead before the first window, then follows it', async () => {
    let land: (ready: boolean) => void = () => {};
    prepare.mockImplementation(() => new Promise<boolean>((resolve) => (land = resolve)));
    const el = await mountWholeLog();
    const grid = gridOf(el);

    setRange({ start: 100, end: 300 });
    await settle(el);
    setRange({ start: 100, end: 400 });
    await settle(el);

    expect(prepare).toHaveBeenCalledTimes(1);
    expect(grid.refresh).not.toHaveBeenCalled();

    land(true);
    await settle(el);

    // Straight to the window on screen now, not the one that started the read.
    // Until then it reads only the whole log.
    expect(readIn.filter(Boolean)).toEqual([{ start: 100, end: 400 }]);
    expect(grid.refresh).toHaveBeenCalledTimes(1);
  });

  it('reads the whole log again once the window goes', async () => {
    setRange({ start: 100, end: 300 });
    const el = await mountWholeLog();

    setRange(null);
    await settle(el);

    expect(readIn.at(-1)).toBeNull();
    expect(footer(gridOf(el), 'duration.total')).toBe(5000);
    expect(wholeBuild).toHaveBeenCalledTimes(1);
  });

  it('catches a view up on the window it missed while hidden', async () => {
    const el = await mountWholeLog();
    const first = gridOf(el);
    await show(el, 'aggregated');
    jest.mocked(first.refresh).mockClear();

    setRange({ start: 100, end: 300 });
    await settle(el);
    expect(first.refresh).not.toHaveBeenCalled();

    await show(el, 'time-order');

    expect(first.refresh).toHaveBeenCalledTimes(1);
  });

  it('totals Self from the window rather than reading every row into it', async () => {
    const el = await mountWholeLog();
    const self = gridOf(el).columns.find((column) => column.id === 'duration.self')?.calc;
    // Before a window, Self is summed over every row that passes the filters.
    expect(self?.scope).toBe('all');

    setRange({ start: 100, end: 300 });
    await settle(el);

    expect(self?.scope).toBe('top');
    expect(footer(gridOf(el), 'duration.self')).toBe(42);
  });

  // Bottom-Up has no row for a pinned block, so a Self total with its time would not match the rows.
  it('totals Bottom-Up Self without the pinned blocks', async () => {
    const el = await mountWholeLog();
    setRange({ start: 100, end: 300 });
    await settle(el);
    await show(el, 'bottom-up');

    expect(footer(gridOf(el, 'bottom-up'), 'duration.self')).toBe(40);
    expect(footer(gridOf(el), 'duration.self')).toBe(42);
  });

  it('reads ahead the rows of many calls a window or an expand left waiting', async () => {
    const el = await mountWholeLog();
    setRange({ start: 100, end: 300 });
    await settle(el);
    const hot = { id: -1 } as unknown as ScopedRow;

    waiting = [hot];
    setRange({ start: 100, end: 400 });
    await settle(el);
    expect(prepare.mock.calls.at(-1)?.[0]).toEqual([hot]);

    waiting = [hot];
    fire(gridOf(el), 'lv-grid-expand', { row: frameRow(1) });
    await settle(el);
    expect(prepare).toHaveBeenCalledTimes(3);
  });

  it('keeps the whole log’s totals on a view still reading ahead', async () => {
    const el = await mountWholeLog();
    await show(el, 'aggregated');
    await show(el, 'time-order');
    setRange({ start: 100, end: 300 });
    await settle(el);
    expect(footer(gridOf(el), 'duration.total')).toBe(200);

    prepare.mockImplementation(() => new Promise<boolean>(() => {}));
    await show(el, 'aggregated');

    expect(footer(gridOf(el, 'aggregated'), 'duration.total')).toBe(5000);
    // Back to the view that follows the window: its figures, and the window it reads.
    await show(el, 'time-order');
    expect(footer(gridOf(el), 'duration.total')).toBe(200);
    expect(readIn.at(-1)).toEqual({ start: 100, end: 300 });
  });

  it('reads ahead again for a new log, abandoning the old read', async () => {
    prepare.mockImplementationOnce(() => new Promise<boolean>(() => {}));
    const el = await mountWholeLog();
    setRange({ start: 100, end: 300 });
    await settle(el);

    el.logStore = { log: {} } as unknown as LogStore;
    await settle(el);
    await frame(el);

    expect(wholeBuild).toHaveBeenCalledTimes(2);
    expect(prepare.mock.calls[0]?.[1].signal?.aborted).toBe(true);
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(gridOf(el).refresh).toHaveBeenCalledTimes(1);
  });
});
