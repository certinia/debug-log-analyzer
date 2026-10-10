/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import type { ApexLog, LogEvent } from '@apexdevtools/apex-log-parser';

// VsSelect extends vscode-single-select, whose setFormValue needs an
// ElementInternals jsdom lacks; the render would upgrade it.
jest.mock('../../../../components/VsSelect.js', () => ({}));
// Connecting the view reads settings twice: the column view loads, and category
// colouring subscribes. This suite has no extension host to answer.
jest.mock('../../../settings/Settings.js', () => ({
  ...jest.requireActual<object>('../../../settings/Settings.js'),
  getSettings: () => Promise.resolve({}),
  subscribeSettings: (apply: (settings: object) => void) => {
    applySettings = apply;
    return () => {};
  },
}));
jest.mock('../../../../components/grid/exportCsv.js', () => ({ exportCsv: jest.fn() }));

import { governorLimits } from '#test-helpers/limits.js';
import {
  eventBus,
  type DetailSelection,
  type DetailSource,
} from '../../../../core/events/EventBus.js';
import { exportCsv } from '../../../../components/grid/exportCsv.js';
import { logStoreFor } from '../../../../core/log/LogStore.js';
import { toBottomUpTree, type BottomUpRow } from '../../../call-tree/utils/Aggregation.js';
import { AnalysisView } from '../AnalysisView.js';

/** Pushes settings to the view, as the extension does on a change. */
let applySettings: (settings: object) => void = () => {};

/** The log's own index, which a reveal resolves its frame through, and which the
 *  fixture's event indexes count off. */
let byEventIndex: LogEvent[] = [];

function frame(
  text: string,
  self: number,
  total: number,
  parent: LogEvent | null,
  type = 'METHOD_ENTRY',
): LogEvent {
  const event = {
    eventIndex: byEventIndex.length,
    type,
    namespace: 'default',
    text,
    parent,
    children: [],
    duration: { self, total },
    dmlCount: { self: 0, total: 0 },
    soqlCount: { self: 0, total: 0 },
    soslCount: { self: 0, total: 0 },
    dmlRowCount: { self: 0, total: 0 },
    soqlRowCount: { self: 0, total: 0 },
    soslRowCount: { self: 0, total: 0 },
    thrownCount: { self: 0, total: 0 },
    heapAllocated: { self: 0, total: 0 },
    heapGross: { self: 0, total: 0 },
    heapPeak: 0,
  } as unknown as LogEvent;
  parent?.children.push(event);
  byEventIndex.push(event);
  return event;
}

/**
 * A -> B -> A on one branch, A -> C -> A on the other, and a debug line with no
 * time, under a log root as the parser leaves it: a bottom-up chain runs out to
 * the root and stops there.
 */
function recursiveLog(): ApexLog {
  const root = frame('LOG_ROOT', 0, 150, null);
  const outer1 = frame('A', 10, 100, root);
  const b1 = frame('B', 20, 90, outer1);
  frame('A', 70, 70, b1);
  const outer2 = frame('A', 5, 50, root);
  const c1 = frame('C', 15, 45, outer2);
  frame('A', 30, 30, c1);
  frame('debug', 0, 0, root, 'USER_DEBUG');
  return Object.assign(root, {
    eventsById: byEventIndex,
    namespaces: [],
    governorLimits: governorLimits(),
  }) as unknown as ApexLog;
}

/** The index of the debug line `recursiveLog` ends with. */
const DEBUG_LINE = 7;

/** jsdom has no IntersectionObserver, and the build waits on one. */
class AlwaysVisible {
  private _callback: IntersectionObserverCallback;

  constructor(callback: IntersectionObserverCallback) {
    this._callback = callback;
  }

  observe(element: Element): void {
    this._callback(
      [{ isIntersecting: true, target: element } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
  disconnect(): void {}
}

/** Let the build's promise chain run out. */
async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function findRow(rows: readonly BottomUpRow[], text: string): BottomUpRow {
  const row = rows.find((candidate) => candidate.text === text);
  if (!row) {
    throw new Error(`Unable to find row for ${text}`);
  }
  return row;
}

describe('analysis-view', () => {
  let view: AnalysisView;
  let log: ApexLog;
  let seen: Array<{ source: DetailSource; selection: DetailSelection | null }>;
  let off: () => void;

  const grid = () => {
    const found = view.grid;
    if (!found) {
      throw new Error('grid not shown');
    }
    return found;
  };
  const roots = (): readonly BottomUpRow[] => grid().source?.roots ?? [];
  const fireOnGrid = (type: string, detail: object) =>
    grid().dispatchEvent(new CustomEvent(type, { detail, bubbles: true }));
  const select = (row: BottomUpRow | null) => fireOnGrid('lv-grid-select', { row, target: row });

  beforeEach(async () => {
    globalThis.IntersectionObserver = AlwaysVisible as unknown as typeof IntersectionObserver;
    byEventIndex = [];
    log = recursiveLog();
    view = new AnalysisView();
    document.body.append(view);
    await view.updateComplete;
    view.timelineRoot = log;
    await view.updateComplete;
    await settle();
    await view.updateComplete;
    seen = [];
    off = eventBus.on('detail:select', (detail) => seen.push(detail));
  });

  afterEach(() => {
    off();
    view.remove();
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it('shows the bottom-up tree of the log, ranked by self time, without rows that have no details', () => {
    expect(roots().map((row) => row.text)).toEqual(
      toBottomUpTree(log.children, logStoreFor(log).keyPathIds()).map((row) => row.text),
    );
    expect(grid().sort).toEqual({ column: 'totalSelfTime', dir: 'desc' });
    const debug = findRow(roots(), 'debug');
    expect(grid().filters.every((filter) => filter.test(debug))).toBe(false);
  });

  it('scopes a root row to every call it counts', () => {
    const rootRow = findRow(roots(), 'A');

    select(rootRow);

    expect(seen).toEqual([
      {
        source: 'analysis',
        view: 'callers',
        selection: {
          kind: 'aggregate',
          instances: rootRow.instances.map((event) => event.eventIndex),
          frames: rootRow.instances.map((event) => event.eventIndex),
          // The root row names the calls it counts, so nothing made them but it.
          calledBy: undefined,
        },
      },
    ]);
  });

  it('scopes a caller row to the calls it holds, and names the row they were reached through', () => {
    const rootRow = findRow(roots(), 'A');
    const throughB = findRow(rootRow._children ?? [], 'B');
    const throughBA = findRow(throughB._children ?? [], 'A');

    select(throughB);
    select(throughBA);

    const derived = rootRow.instances.filter((event) => event.parent?.text === 'B');
    expect(derived).toHaveLength(1);
    expect(seen.map((detail) => detail.selection)).toEqual([
      // Both rows hold the same one call, so the row is what tells them apart:
      // reached through B, then through the A above B. `frames` is the caller
      // each row is, a level up from the call its totals count.
      {
        kind: 'aggregate',
        instances: derived.map((event) => event.eventIndex),
        frames: [2],
        calledBy: 'B',
      },
      {
        kind: 'aggregate',
        instances: derived.map((event) => event.eventIndex),
        frames: [1],
        calledBy: 'A',
      },
    ]);
  });

  it('clears the inspector when the selection goes', () => {
    select(null);

    expect(seen).toEqual([{ source: 'analysis', selection: null, view: 'callers' }]);
  });

  it('tells the inspector which calls the pointer is over', () => {
    const located: number[][] = [];
    const stop = eventBus.on('detail:locate', ({ eventIndexes }) =>
      located.push([...eventIndexes]),
    );

    fireOnGrid('lv-grid-locate', { row: findRow(roots(), 'B') });
    fireOnGrid('lv-grid-locate', { row: null });
    stop();

    expect(located).toEqual([[2], []]);
  });

  it('reveals the bucket a frame heads, without echoing the select', async () => {
    const goTo = jest.spyOn(grid(), 'goTo').mockImplementation(async () => {
      select(findRow(roots(), 'B'));
      return true;
    });

    // Frame 2 is the log's own `B` call, which the `B` bucket heads.
    eventBus.emit('inspector:reveal', { source: 'analysis', eventIndex: 2 });
    await settle();

    expect(goTo).toHaveBeenCalledWith([findRow(roots(), 'B').id], { scrollIfVisible: false });
    expect(seen).toEqual([]);
  });

  it('turns Details on to reveal a bucket the filter hides', async () => {
    const goTo = jest.spyOn(grid(), 'goTo').mockResolvedValue(true);

    eventBus.emit('inspector:reveal', { source: 'analysis', eventIndex: DEBUG_LINE });
    await settle();

    expect(grid().filters).toEqual([]);
    expect(goTo).toHaveBeenCalledWith([findRow(roots(), 'debug').id], { scrollIfVisible: false });
  });

  it('moves to the bucket a picked inspector row names, and only marks for a hover', async () => {
    const goTo = jest.spyOn(grid(), 'goTo').mockResolvedValue(true);
    const bucketB = findRow(roots(), 'B').id;

    eventBus.emit('inspector:locate', { source: 'analysis', eventIndexes: [2], sticky: false });
    await settle();
    expect(goTo).not.toHaveBeenCalled();
    expect([...grid().marked]).toContain(bucketB);

    eventBus.emit('inspector:locate', { source: 'analysis', eventIndexes: [2], sticky: true });
    await settle();
    expect(goTo).toHaveBeenCalledWith([bucketB], { scrollIfVisible: false });
  });

  it('groups by the picked field, and ungroups for None', async () => {
    const pick = async (value: string) => {
      const picker = view.renderRoot.querySelector('#groupby-dropdown') as HTMLElement & {
        value: string;
      };
      picker.value = value;
      picker.dispatchEvent(new Event('change'));
      await view.updateComplete;
    };

    await pick('Caller Namespace');
    expect(grid().groupBy?.({ callerNamespace: 'ns' } as BottomUpRow)).toBe('ns');

    await pick('None');
    expect(grid().groupBy).toBeNull();
  });

  it('shows the rows with no details when Details is on', async () => {
    view.renderRoot.querySelector<HTMLButtonElement>('button.pill-toggle')?.click();
    await view.updateComplete;

    expect(grid().filters).toEqual([]);
  });

  it('exports analysis.csv and copies from the grid', () => {
    const copy = jest.spyOn(grid(), 'copy').mockResolvedValue(undefined);
    const click = (label: string) =>
      view.renderRoot
        .querySelector<HTMLElement>(`vscode-toolbar-button[label="${label}"]`)
        ?.click();

    click('Export to CSV');
    click('Copy to clipboard');

    expect(exportCsv).toHaveBeenCalledWith(grid(), 'analysis.csv');
    expect(copy).toHaveBeenCalled();
  });

  it('keeps a picked column view across renders', async () => {
    const shown = () =>
      grid()
        .columns.filter((column) => !column.hidden)
        .map((column) => column.id);
    const before = shown();

    const picker = view.renderRoot.querySelector('#column-view') as HTMLElement & {
      value: string;
    };
    picker.value = 'Governor Limits';
    picker.dispatchEvent(new Event('change'));
    await view.updateComplete;
    // Any later render binds the columns again.
    view.requestUpdate();
    await view.updateComplete;

    expect(shown()).not.toEqual(before);
    expect(shown()).toContain('text');
  });

  it('tints the Name cells when category colouring is on', async () => {
    applySettings({ timeline: { customThemes: {} }, callTree: { categoryColorize: true } });
    await view.updateComplete;

    expect(grid().hasAttribute('category-colorize')).toBe(true);
  });

  it('drops the search when the grid is reshaped under it', async () => {
    jest.spyOn(grid(), 'clientHeight', 'get').mockReturnValue(100);
    jest.spyOn(grid(), 'find').mockResolvedValue(2);
    jest.spyOn(grid(), 'setCurrentMatch').mockResolvedValue(undefined);
    const totals: number[] = [];
    const heard = (e: Event) =>
      totals.push((e as CustomEvent<{ totalMatches: number }>).detail.totalMatches);
    document.addEventListener('lv-find-results', heard);

    document.dispatchEvent(
      new CustomEvent('lv-find', {
        detail: { text: 'A', count: 1, options: { matchCase: false } },
      }),
    );
    await settle();
    fireOnGrid('lv-grid-reshape', { reason: 'filter' });
    document.removeEventListener('lv-find-results', heard);

    expect(totals).toEqual([2, 0]);
  });
});
