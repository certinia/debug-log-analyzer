/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import type { ApexLog } from '@apexdevtools/apex-log-parser';

import type { DatabaseOverview } from '../../services/databaseOverview.js';

// Tables built and destroyed.
let built = 0;
let destroyed = 0;
// The last table's handlers, by event.
const handlers: Record<string, (...args: unknown[]) => void> = {};

jest.mock('tabulator-tables', () => ({
  Tabulator: class {
    static registerModule() {}
    constructor() {
      built++;
    }
    on(name: string, handler: (...args: unknown[]) => void) {
      handlers[name] = handler;
    }
    destroy() {
      destroyed++;
    }
  },
  Module: class {},
  Renderer: class {},
}));
jest.mock('../../services/databaseOverview.js', () => ({
  ...jest.requireActual('../../services/databaseOverview.js'),
  databaseOverview: (): DatabaseOverview => ({
    time: {
      timeNs: 0,
      logNs: 1_000_000_000,
      percentOfLog: 0,
      soql: { timeNs: 0, statements: 0 },
      dml: { timeNs: 0, statements: 0 },
      sosl: { timeNs: 0, statements: 0 },
    },
    ranked: [],
    tree: [],
    askedBy: [],
    burnedIn: [],
  }),
}));

import { stubStore } from '#test-helpers/apexLog.js';
import { waitForNextFrame } from '../../../../core/utility/FrameBudget.js';
import { INSPECTOR_LOCATE_EVENT } from '../../../../components/inspectorReveal.js';
import type { DatabaseTime } from '../DatabaseTimeTree.js';
import '../DatabaseTimeTree.js';

const settle = async (element: DatabaseTime): Promise<void> => {
  await element.updateComplete;
  await new Promise((resolve) => setTimeout(resolve));
  await waitForNextFrame();
  await element.updateComplete;
};

describe('database-time', () => {
  let element: DatabaseTime;

  beforeEach(async () => {
    built = 0;
    destroyed = 0;
    element = document.createElement('database-time');
    element.logStore = stubStore({} as ApexLog);
    document.body.append(element);
    await settle(element);
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it('builds the table for the log it is given', () => {
    expect(built).toBe(1);
  });

  it('keeps the table through a move', async () => {
    document.body.append(document.createElement('div'), element);
    await settle(element);

    expect([built, destroyed]).toEqual([1, 0]);
  });

  it('rebuilds the table after a detach and a re-attach', async () => {
    element.remove();
    await Promise.resolve();
    expect(destroyed).toBe(1);

    document.body.append(element);
    await settle(element);

    expect(built).toBe(2);
    expect(element.shadowRoot?.querySelector('grid-skeleton')?.hasAttribute('pending')).toBe(false);
  });

  it('marks nothing for the pointer over the totals row, which names no statement', () => {
    const located: unknown[] = [];
    element.addEventListener(INSPECTOR_LOCATE_EVENT, (e) =>
      located.push((e as CustomEvent<{ eventIndexes: unknown }>).detail.eventIndexes),
    );

    handlers.rowMouseEnter?.(new MouseEvent('mouseenter'), { getData: () => ({ name: 'Total' }) });

    expect(located).toEqual([[]]);
  });
});
