/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import type { ApexLog } from '@apexdevtools/apex-log-parser';

import type { DatabaseCallNode, DatabaseOverview } from '../../services/databaseOverview.js';

const node = (
  label: string,
  kind: DatabaseCallNode['kind'],
  eventIndexes: number[],
  children: DatabaseCallNode[] = [],
): DatabaseCallNode =>
  ({
    label,
    kind,
    timeNs: 10,
    selfNs: 4,
    count: eventIndexes.length,
    eventIndexes,
    children,
  }) as DatabaseCallNode;

// A method that ran one query, and a query run twice from one line, merged.
const TREE = [
  node('Account.load()', null, [1], [node('SELECT Id FROM Account', 'SOQL', [2])]),
  node('SELECT Id FROM Contact', 'SOQL', [5, 6]),
];

let derived = 0;
jest.mock('../../services/databaseOverview.js', () => ({
  ...jest.requireActual('../../services/databaseOverview.js'),
  databaseOverview: (): DatabaseOverview => {
    derived++;
    return {
      time: {
        timeNs: 30,
        logNs: 1_000_000_000,
        percentOfLog: 0,
        soql: { timeNs: 0, statements: 0 },
        dml: { timeNs: 0, statements: 0 },
        sosl: { timeNs: 0, statements: 0 },
      },
      ranked: [],
      tree: TREE,
      askedBy: [],
      burnedIn: [],
    };
  },
}));

import { stubStore } from '#test-helpers/apexLog.js';
import type { AppGrid } from '../../../../components/grid/AppGrid.js';
import {
  INSPECTOR_LOCATE_EVENT,
  INSPECTOR_REVEAL_EVENT,
} from '../../../../components/inspectorReveal.js';
import { eventBus } from '../../../../core/events/EventBus.js';
import type { DatabaseTime, DatabaseTreeRow } from '../DatabaseTimeTree.js';
import '../DatabaseTimeTree.js';

const settle = async (element: DatabaseTime): Promise<void> => {
  await element.updateComplete;
  await new Promise((resolve) => setTimeout(resolve));
  await element.updateComplete;
};

describe('database-time', () => {
  let element: DatabaseTime;
  let events: Array<{ type: string; detail: unknown }>;
  const record = (e: Event) => events.push({ type: e.type, detail: (e as CustomEvent).detail });

  const grid = (): AppGrid<DatabaseTreeRow> => {
    const found = element.shadowRoot?.querySelector('lv-app-grid');
    if (!found) {
      throw new Error('No grid');
    }
    return found as AppGrid<DatabaseTreeRow>;
  };
  const roots = (): readonly DatabaseTreeRow[] => grid().source?.roots ?? [];
  const fire = (type: string, detail: object): void => {
    grid().dispatchEvent(new CustomEvent(type, { detail, bubbles: true }));
  };

  beforeEach(async () => {
    derived = 0;
    events = [];
    element = document.createElement('database-time');
    element.logStore = stubStore({} as ApexLog);
    document.body.append(element);
    await settle(element);
    document.addEventListener(INSPECTOR_LOCATE_EVENT, record);
    document.addEventListener(INSPECTOR_REVEAL_EVENT, record);
  });

  afterEach(() => {
    document.removeEventListener(INSPECTOR_LOCATE_EVENT, record);
    document.removeEventListener(INSPECTOR_REVEAL_EVENT, record);
    document.body.replaceChildren();
  });

  it('shows the paths to the database for the log it is given, closed', () => {
    expect(roots().map((row) => row.label)).toEqual(['Account.load()', 'SELECT Id FROM Contact']);
    expect(grid().expanded).toBe(false);
    expect(element.shadowRoot?.querySelector('grid-skeleton')?.hasAttribute('pending')).toBe(false);
  });

  it('totals self time over every row, children included', () => {
    const self = grid().columns.find((column) => column.id === 'selfNs')?.calc;

    // Three rows of 4 ns each, one of them a child.
    expect(self?.of(roots())).toBe(12);
  });

  it('keeps its rows through a move', async () => {
    const source = grid().source;

    document.body.append(document.createElement('div'), element);
    await settle(element);

    expect(derived).toBe(1);
    expect(grid().source).toBe(source);
  });

  it('lets go of its rows on a detach, and builds them again on a re-attach', async () => {
    element.remove();
    await Promise.resolve();
    await element.updateComplete;
    expect(grid().source).toBeNull();

    document.body.append(element);
    await settle(element);

    expect(derived).toBe(2);
    expect(roots()).toHaveLength(2);
  });

  it('marks the frames located before its rows were built', async () => {
    element.remove();
    await Promise.resolve();
    document.body.append(element);
    eventBus.emit('detail:locate', { source: 'database', eventIndexes: [6] });
    await settle(element);

    expect([...grid().marked]).toEqual([roots()[1]?.id]);
  });

  it('reveals a picked statement, and holds a mark on every occurrence of a merged one', () => {
    const query = roots()[0]?._children?.[0];
    const merged = roots()[1];

    fire('lv-grid-select', { row: query, target: query?.id });
    fire('lv-grid-select', { row: merged, target: merged?.id });

    expect(events).toEqual([
      { type: INSPECTOR_REVEAL_EVENT, detail: { eventIndex: 2 } },
      {
        type: INSPECTOR_LOCATE_EVENT,
        detail: { eventIndexes: [5, 6], sticky: true, selection: null },
      },
    ]);
  });

  it('drops a pick when the tab clears its selection', () => {
    // The grid holds a pick, so a deselect clears one.
    const deselect = jest.spyOn(grid(), 'deselect').mockReturnValue(true);

    eventBus.emit('selection:clear', { source: 'database' });

    expect(deselect).toHaveBeenCalled();
    expect(events).toEqual([
      { type: INSPECTOR_LOCATE_EVENT, detail: { eventIndexes: [], sticky: true, selection: null } },
    ]);
  });

  it('locates the statements under the pointer', () => {
    fire('lv-grid-locate', { row: roots()[1] });
    fire('lv-grid-locate', { row: null });

    expect(events.map((e) => (e.detail as { eventIndexes: unknown }).eventIndexes)).toEqual([
      [5, 6],
      [],
    ]);
  });

  it('marks every row that names a statement under the pointer in the grid beside', async () => {
    eventBus.emit('detail:locate', { source: 'database', eventIndexes: [2, 6] });
    await element.updateComplete;

    const ids = [roots()[0]?._children?.[0]?.id, roots()[1]?.id];
    expect([...grid().marked].sort()).toEqual(ids.sort());
  });
});
