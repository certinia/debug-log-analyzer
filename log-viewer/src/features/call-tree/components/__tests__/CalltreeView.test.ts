/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import type { ApexLog } from '@apexdevtools/apex-log-parser';
import type { Tabulator } from 'tabulator-tables';

// The grids bring tabulator and its module registrations, which don't load under
// jest; this suite drives only which table the view builds, and when.
jest.mock('../TimeOrderTable.js', () => ({ createTimeOrderTable: () => build('time-order') }));
jest.mock('../AggregatedTable.js', () => ({ createAggregatedTable: () => build('aggregated') }));
jest.mock('../BottomUpTable.js', () => ({ createBottomUpTable: () => build('bottom-up') }));
// VsSelect extends vscode-single-select, whose setFormValue needs an
// ElementInternals jsdom lacks; the render would upgrade it.
jest.mock('../../../../components/VsSelect.js', () => ({}));
// Connecting the view reads settings twice: firstUpdated loads the column view,
// and category colouring subscribes. This suite has no extension host to answer.
jest.mock('../../../settings/Settings.js', () => ({
  ...jest.requireActual<object>('../../../settings/Settings.js'),
  getSettings: () => Promise.resolve({}),
  subscribeSettings: () => () => {},
}));

import { storeOf } from '#test-helpers/apexLog.js';
import { LogStore } from '../../../../core/log/LogStore.js';
import { CalltreeView } from '../CalltreeView.js';

/** Which table each build made, and which each teardown destroyed, in order. */
let built: string[] = [];
let destroyed: string[] = [];
/** The filters the newest table was given, so a rebuild can be told from a reset. */
let filtered: unknown[] = [];
/** Which tables had their columns applied, which is the tail of a build. */
let wired: string[] = [];
/** What Bottom Up was told to group on, per build. */
let groupedBy: string[] = [];
/** Finishes the newest build, where a test drives one that is in flight. */
let finishBuild: (() => void) | null = null;
/** Whether a build waits to be finished by hand. */
let holdBuilds = false;

function build(kind: string): { table: Tabulator; tableBuilt: Promise<void> } {
  built.push(kind);
  // A new table carries no filters of its own, so the record starts over with it.
  filtered = [];
  const table = {
    element: document.createElement('div'),
    on: () => {},
    getColumns: () => {
      wired.push(kind);
      return [];
    },
    redraw: () => {},
    blockRedraw: () => {},
    restoreRedraw: () => {},
    clearFilter: () => {
      filtered = [];
    },
    addFilter: (filter: unknown) => filtered.push(filter),
    clearFindHighlights: () => {},
    setSortedGroupBy: (field: string) => groupedBy.push(field),
    destroy: () => destroyed.push(kind),
  } as unknown as Tabulator;
  if (!holdBuilds) {
    return { table, tableBuilt: Promise.resolve() };
  }
  return { table, tableBuilt: new Promise<void>((resolve) => (finishBuild = resolve)) };
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
    destroyed = [];
    filtered = [];
    wired = [];
    groupedBy = [];
    finishBuild = null;
    holdBuilds = false;
    globalThis.IntersectionObserver = AlwaysVisible as unknown as typeof IntersectionObserver;
    view = await mountView();
  });

  afterEach(() => {
    view.remove();
  });

  it('builds the table for the log it is given', () => {
    expect(built).toEqual(['time-order']);
  });

  it('rebuilds the table after a detach and a re-attach', async () => {
    view.remove();
    expect(destroyed).toEqual(['time-order']);

    document.body.append(view);
    await settle();

    expect(built).toEqual(['time-order', 'time-order']);
  });

  it('rebuilds under the filters the view was left with', async () => {
    view.namespaceSelected = ['ns'];
    view._updateFiltering();
    const onShow = filtered.length;
    expect(onShow).toBeGreaterThan(0);

    view.remove();
    document.body.append(view);
    await settle();

    // The chip still reads as on, so the rebuilt table has to read the same way.
    expect(filtered).toHaveLength(onShow);
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
    view.remove();
    wired = [];
    holdBuilds = true;
    document.body.append(view);
    await settle();
    expect(built).toEqual(['time-order', 'time-order']);

    // Gone and back while the first build is still waiting on its table.
    const overtaken = finishBuild!;
    view.remove();
    holdBuilds = false;
    document.body.append(view);
    await settle();
    expect(built).toHaveLength(3);

    wired = [];
    overtaken();
    await settle();

    // The container holds the newest table now, so the overtaken build must not
    // read a header that is no longer its own.
    expect(wired).toEqual([]);
  });

  it('rebuilds bottom up grouped the way it was left', async () => {
    await view._setViewMode('bottom-up');
    view._handleBottomUpGroupBy({ target: { value: 'Namespace' } } as unknown as Event);
    await settle();
    expect(groupedBy).toEqual(['namespace']);

    view.remove();
    document.body.append(view);
    await settle();

    expect(groupedBy).toEqual(['namespace', 'namespace']);
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
