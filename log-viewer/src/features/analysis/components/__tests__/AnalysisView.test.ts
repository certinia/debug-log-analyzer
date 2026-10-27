/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import type { ApexLog } from '@apexdevtools/apex-log-parser';

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

import { frameLines, rawStoreOf } from '#test-helpers/apexLog.js';
import { AlwaysVisible, NeverVisible, settle } from '#test-helpers/visibility.js';
import {
  eventBus,
  type DetailSelection,
  type DetailSource,
} from '../../../../core/events/EventBus.js';
import { exportCsv } from '../../../../components/grid/exportCsv.js';
import { logStoreFor } from '../../../../core/log/LogStore.js';
import { BOTTOM_UP_DETAILS } from '../../../call-tree/grid/columns.js';
import { MergedTree } from '../../../call-tree/grid/mergedRows.js';
import type { BottomUpRow } from '../../../call-tree/utils/Aggregation.js';
import { AnalysisView } from '../AnalysisView.js';

/** Pushes settings to the view, as the extension does on a change. */
let applySettings: (settings: object) => void = () => {};

/**
 * A -> B -> A on one branch, A -> C -> A on the other, then a debug line with no
 * time: a bottom-up chain runs out to the top of the log and stops there.
 */
async function recursiveLog(): Promise<ApexLog> {
  const { log } = await rawStoreOf(
    frameLines([
      {
        text: 'A',
        self: 10,
        children: [{ text: 'B', self: 20, children: [{ text: 'A', self: 70 }] }],
      },
      {
        text: 'A',
        self: 5,
        children: [{ text: 'C', self: 15, children: [{ text: 'A', self: 30 }] }],
      },
    ]) + '09:18:22.6 (1150)|USER_DEBUG|[1]|DEBUG|debug\n',
  );
  return log;
}

/** The index of the debug line `recursiveLog` ends with. */
const DEBUG_LINE = 7;

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
    log = await recursiveLog();
    view = new AnalysisView();
    document.body.append(view);
    await view.updateComplete;
    view.logStore = logStoreFor(log);
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
    expect(roots().map((row) => [row.text, row.totalSelfTime])).toEqual(
      expect.arrayContaining([
        ['A', 115],
        ['B', 20],
        ['C', 15],
        ['DEBUG | debug', 0],
      ]),
    );
    expect(roots()).toHaveLength(4);
    expect(grid().sort).toEqual({ column: 'totalSelfTime', dir: 'desc' });
    const debug = findRow(roots(), 'DEBUG | debug');
    expect(grid().filters.every((filter) => filter.test(debug))).toBe(false);
  });

  it('gives the expand button the grid once it mounts', () => {
    const button = view.shadowRoot?.querySelector('tree-expand-button');
    expect(button?.grid).toBe(grid());
  });

  it('names the grid for a screen reader', () => {
    expect(grid().label).toBe('Analysis');
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
          instances: [...rootRow.instances],
          frames: [...rootRow.instances],
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

    const { parent, text } = log.columns;
    const derived = rootRow.instances.filter((id) => text.at(parent[id]!) === 'B');
    expect(derived).toHaveLength(1);
    expect(seen.map((detail) => detail.selection)).toEqual([
      // Both rows hold the same one call, so the row is what tells them apart:
      // reached through B, then through the A above B. `frames` is the caller
      // each row is, a level up from the call its totals count.
      {
        kind: 'aggregate',
        instances: derived,
        frames: [2],
        calledBy: 'B',
      },
      {
        kind: 'aggregate',
        instances: derived,
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
    expect(goTo).toHaveBeenCalledWith([findRow(roots(), 'DEBUG | debug').id], {
      scrollIfVisible: false,
    });
  });

  it('moves to the bucket a picked inspector row names, and only marks for a hover', async () => {
    const goTo = jest.spyOn(grid(), 'goTo').mockResolvedValue(true);
    const bucketB = findRow(roots(), 'B').id;

    eventBus.emit('inspector:locate', { source: 'analysis', eventIndexes: [2], sticky: false });
    await settle();
    expect(goTo).not.toHaveBeenCalled();
    // Frame 2 heads bucket B, and is the B caller row under the A it called.
    const callerB = findRow(findRow(roots(), 'A')._children ?? [], 'B').id;
    expect(grid().marked).toEqual(new Set([bucketB, callerB]));

    eventBus.emit('inspector:locate', { source: 'analysis', eventIndexes: [2], sticky: true });
    await settle();
    expect(goTo).toHaveBeenCalledWith([bucketB], { scrollIfVisible: false });
  });

  describe('filters', () => {
    const MS = 1_000_000;
    const row = (namespace: string, totalMs: number, selfMs: number, details = true) =>
      ({
        namespace,
        totalTime: totalMs * MS,
        totalSelfTime: selfMs * MS,
        _hasDetailsDeep: details,
      }) as unknown as BottomUpRow;
    const kept = (rows: BottomUpRow[]) =>
      rows.filter((r) => grid().filters.every((filter) => filter.test(r)));
    /** The filters this toolbar adds, apart from Details. */
    const added = () => grid().filters.filter((filter) => filter !== BOTTOM_UP_DETAILS);
    const fire = async (selector: string, type: string, detail: object) => {
      view.renderRoot
        .querySelector(selector)
        ?.dispatchEvent(new CustomEvent(type, { detail, bubbles: true }));
      await view.updateComplete;
    };
    const pickNamespaces = (selected: string[]) =>
      fire('datagrid-facet-filter[label="Namespace"]', 'datagrid-facet-change', { selected });

    it('offers the namespaces of the log', () => {
      const facet = view.renderRoot.querySelector('datagrid-facet-filter[label="Namespace"]') as
        (HTMLElement & { values: unknown }) | null;

      expect(facet?.values).toBe(log.namespaces);
    });

    it('keeps the rows in the picked namespaces, with their callers, and Details still applies', async () => {
      const [ns1, ns2, noDetails] = [row('ns1', 1, 1), row('ns2', 1, 1), row('ns1', 1, 1, false)];
      await pickNamespaces(['ns1']);

      expect(kept([ns1, ns2, noDetails])).toEqual([ns1]);
      expect(added().map((filter) => filter.keepAncestors)).toEqual([true]);
    });

    it.each([
      ['Total Time', row('ns', 3, 1), row('ns', 1, 3)],
      ['Self Time', row('ns', 1, 3), row('ns', 3, 1)],
    ])(
      'keeps the rows inside the %s range, with their callers, until cleared',
      async (label, inside, outside) => {
        const setRange = (start: number | null) =>
          fire(`datagrid-range-filter[label="${label}"]`, 'datagrid-range-change', {
            range: { start, end: null },
          });
        await setRange(2);
        expect(kept([inside, outside])).toEqual([inside]);
        expect(added().map((filter) => filter.keepAncestors)).toEqual([true]);

        await setRange(null);
        expect(added()).toEqual([]);
      },
    );

    it('keeps each filter object while its input is unchanged', async () => {
      await pickNamespaces(['ns1']);
      const [namespace] = added();
      [...view.renderRoot.querySelectorAll<HTMLElement>('button.pill-toggle')]
        .find((button) => button.textContent?.trim() === 'Details')
        ?.click();
      await view.updateComplete;

      expect(added()[0]).toBe(namespace);
    });
  });

  it.each([
    ['Namespace', { namespace: 'ns' }, 'ns'],
    ['Caller Namespace', { callerNamespace: 'caller' }, 'caller'],
    ['Type', { type: 'METHOD_ENTRY' }, 'METHOD_ENTRY'],
  ])('groups by %s, and ungroups for None', async (option, row, group) => {
    const options = [...view.renderRoot.querySelectorAll('#groupby-dropdown vscode-option')];
    const pick = async (value: string) => {
      const picker = view.renderRoot.querySelector('#groupby-dropdown') as HTMLElement & {
        value: string;
      };
      picker.value = value;
      picker.dispatchEvent(new Event('change'));
      await view.updateComplete;
    };

    await pick(option);
    expect(options.map((el) => el.textContent)).toContain(option);
    expect(grid().groupBy?.(row as BottomUpRow)).toBe(group);

    await pick('None');
    expect(grid().groupBy).toBeNull();
  });

  it('shows the rows with no details when Details is on', async () => {
    view.renderRoot.querySelector<HTMLButtonElement>('button.pill-toggle')?.click();
    await view.updateComplete;

    expect(grid().filters).toEqual([]);
  });

  it('stops a rebuild that a newer log overtook', async () => {
    const bottomUp = jest.spyOn(MergedTree, 'bottomUp');

    view.logStore = logStoreFor(await recursiveLog());
    await view.updateComplete;
    view.logStore = logStoreFor(await recursiveLog());
    await view.updateComplete;
    await settle();

    const signals = bottomUp.mock.calls.map(([, options]) => options?.signal?.aborted);
    expect(signals).toEqual([true, false]);
  });

  it('drops a build a newer log overtook while it read the limit usage', async () => {
    // The newer log lands after this tree resolves but before its usage read does.
    const olderTree = await MergedTree.bottomUp(logStoreFor(await recursiveLog()));
    let finish: (tree: typeof olderTree) => void = () => {};
    jest
      .spyOn(MergedTree, 'bottomUp')
      .mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)))
      .mockImplementationOnce(() => new Promise(() => {}));

    view.logStore = logStoreFor(await recursiveLog());
    await view.updateComplete;
    finish(olderTree);
    view.logStore = logStoreFor(await recursiveLog());
    await view.updateComplete;
    await settle();
    await view.updateComplete;

    expect(roots()).not.toBe(olderTree?.source.roots);
  });

  it('gives the grid it has the rows of a new log, and keeps Details on', async () => {
    view.renderRoot.querySelector<HTMLButtonElement>('button.pill-toggle')?.click();
    await view.updateComplete;
    const shownGrid = grid();
    const before = roots();

    view.logStore = logStoreFor(await recursiveLog());
    await view.updateComplete;
    await settle();
    await view.updateComplete;

    expect(grid()).toBe(shownGrid);
    expect(roots()).not.toBe(before);
    expect(roots().map((row) => row.text)).toEqual(before.map((row) => row.text));
    expect(grid().filters).toEqual([]);
  });

  it('exports analysis.csv and copies from the grid', () => {
    const copy = jest.spyOn(grid(), 'copy').mockResolvedValue(undefined);
    const click = (label: string) =>
      view.renderRoot.querySelector<HTMLElement>(`toolbar-action[label="${label}"]`)?.click();

    click('Export to CSV');
    click('Copy to Clipboard');

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

  it('opens the column menu once for a header right-click, after the view is moved', async () => {
    const menu = view.renderRoot.querySelector('context-menu') as HTMLElement & {
      show: (...args: unknown[]) => void;
    };
    const show = jest.spyOn(menu, 'show').mockImplementation(() => {});
    view.remove();
    document.body.append(view);
    await view.updateComplete;

    const event = new MouseEvent('contextmenu', { cancelable: true });
    fireOnGrid('lv-grid-header-context', { column: 'text', event });

    expect(show).toHaveBeenCalledTimes(1);
  });

  it('tints the Name cells while category colouring is on', async () => {
    const colorize = async (on: boolean) => {
      applySettings({ timeline: { customThemes: {} }, callTree: { categoryColorize: on } });
      await view.updateComplete;
    };

    await colorize(true);
    expect(grid().hasAttribute('category-colorize')).toBe(true);

    await colorize(false);
    expect(grid().hasAttribute('category-colorize')).toBe(false);
  });

  it('searches again when the grid is reshaped under it', async () => {
    Object.defineProperty(view, 'clientHeight', { configurable: true, value: 100 });
    jest
      .spyOn(grid(), 'find')
      .mockResolvedValueOnce({ total: 2, current: -1 })
      .mockResolvedValueOnce({ total: 1, current: -1 });
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
    await settle();
    document.removeEventListener('lv-find-results', heard);

    expect(totals).toEqual([2, 1]);
  });
});

describe('analysis-view before it is seen', () => {
  it('builds nothing while the tab is hidden', async () => {
    globalThis.IntersectionObserver = NeverVisible as unknown as typeof IntersectionObserver;
    const view = new AnalysisView();
    document.body.append(view);
    await view.updateComplete;
    view.logStore = logStoreFor(await recursiveLog());
    await view.updateComplete;
    await settle();

    expect(view.grid).toBeNull();
    expect(view.renderRoot.querySelector('grid-skeleton')).not.toBeNull();
    view.remove();
  });
});
