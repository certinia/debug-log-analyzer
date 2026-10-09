/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import type { ApexLog } from '@apexdevtools/apex-log-parser';

import type { BottomUpRow } from '../../utils/Aggregation.js';

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
  buildBottomUpTree: () => buildBottomUp(),
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

import { storeOf } from '#test-helpers/apexLog.js';
import { LogStore } from '../../../../core/log/LogStore.js';
import { CalltreeView } from '../CalltreeView.js';

/** Which view each build made, in order. */
let built: string[] = [];
/** Finishes the newest Bottom Up build, where a test drives one that is in flight. */
let finishBuild: ((roots: BottomUpRow[]) => void) | null = null;
/** Whether a Bottom Up build waits to be finished by hand. */
let holdBuilds = false;
/** Pushes settings to the view, as the extension does on a change. */
let applySettings: (settings: object) => void = () => {};

function buildBottomUp(): Promise<BottomUpRow[]> {
  if (!holdBuilds) {
    return Promise.resolve([]);
  }
  return new Promise((resolve) => (finishBuild = resolve));
}

/** The grids in the view's DOM. */
function grids(view: CalltreeView): Element[] {
  return [...view.renderRoot.querySelectorAll('lv-call-tree-grid')];
}

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

class NeverVisible {
  observe(): void {}
  disconnect(): void {}
}

function apexLog(): ApexLog {
  return {
    children: [],
    eventsById: [],
    namespaces: [],
    governorLimits: null,
  } as unknown as ApexLog;
}

/** Let the build's promise chain run out: more turns than it takes, since the
 *  count of them is not what any test is about. */
async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function mountView(): Promise<CalltreeView> {
  const view = new CalltreeView();
  document.body.append(view);
  await view.updateComplete;
  view.timelineRoot = apexLog();
  await view.updateComplete;
  await settle();
  return view;
}

describe('calltree-view table lifetime', () => {
  let view: CalltreeView;

  beforeEach(async () => {
    built = [];
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

  it('builds nothing where the view goes before it is seen', async () => {
    view.remove();
    built = [];
    // Back on screen, then gone again before the visibility answer is acted on.
    document.body.append(view);
    view.remove();
    await settle();

    expect(built).toEqual([]);
  });

  it('leaves a build the detach overtook to the one that replaced it', async () => {
    holdBuilds = true;
    void view._setViewMode('bottom-up');
    await settle();
    const overtaken = finishBuild!;
    const first = view.bottomUpGrid;

    // Gone and back while the first build is still waiting on its tree.
    view.remove();
    holdBuilds = false;
    document.body.append(view);
    await settle();
    expect(built).toEqual(['time-order', 'bottom-up', 'bottom-up']);
    const newest = view.bottomUpGrid;
    const rows = newest?.source?.roots;

    overtaken([{ id: 1, _pathId: 1 } as BottomUpRow]);
    await settle();

    // The view holds the newest grid now, so the overtaken build must not fill it.
    expect(view.bottomUpGrid).toBe(newest);
    expect(newest?.source?.roots).toBe(rows);
    expect(first?.source).toBeNull();
  });

  it('rebuilds bottom up grouped the way it was left', async () => {
    await view._setViewMode('bottom-up');
    view._handleBottomUpGroupBy({ target: { value: 'Namespace' } } as unknown as Event);
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
    view.timelineRoot = storeOf(OUTER).log;
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
    view.timelineRoot = storeOf(OUTER).log;
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
    view.timelineRoot = before;
    await view.updateComplete;
    view.timelineRoot = storeOf(DML).log;
    await typeOptions();
    release();
    const types = await typeOptions();

    expect(types).toContain('DML_BEGIN');
    expect(types).not.toContain('METHOD_ENTRY');
  });
});
