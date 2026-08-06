/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { describe, expect, it, beforeEach } from '@jest/globals';
import type { GovernorLimits, LogEvent } from 'apex-log-parser';

const revealed: number[] = [];
const copied: string[] = [];
let event: LogEvent | null = null;
let limits: GovernorLimits | null = null;

jest.mock('../../features/call-tree/navigation.js', () => ({
  goToRow: async (target: { eventIndex: number }) => {
    revealed.push(target.eventIndex);
  },
}));
jest.mock('../../core/utility/Clipboard.js', () => ({
  copyToClipboard: (text: string) => copied.push(text),
}));
jest.mock('../../features/database/services/Database.js', () => ({
  DatabaseAccess: {
    instance: () => ({
      getEventByIndex: (i: number) => (i === 42 ? event : null),
      getApexLog: () => ({ governorLimits: limits }),
    }),
  },
}));

import { PANEL_ROW_MENU_ITEMS, runPanelRowAction } from '../panelRowMenu.js';

function makeEvent(overrides: Partial<LogEvent> = {}): LogEvent {
  return {
    text: 'MyClass.run()',
    suffix: null,
    type: 'METHOD_ENTRY',
    parent: null,
    exitStamp: 1000,
    cpuType: '',
    duration: { self: 1_000_000, total: 2_000_000 },
    dmlCount: { self: 0, total: 0 },
    dmlRowCount: { self: 0, total: 0 },
    soqlCount: { self: 0, total: 0 },
    soqlRowCount: { self: 0, total: 0 },
    soslCount: { self: 0, total: 0 },
    soslRowCount: { self: 0, total: 0 },
    ...overrides,
  } as unknown as LogEvent;
}

beforeEach(() => {
  revealed.length = 0;
  copied.length = 0;
  event = makeEvent();
  limits = null;
});

describe('PANEL_ROW_MENU_ITEMS', () => {
  it('offers reveal plus the three copy actions, reveal separated from them', () => {
    const ids = PANEL_ROW_MENU_ITEMS.filter((i) => !i.separator).map((i) => i.id);
    expect(ids).toEqual(['show-in-call-tree', 'copy-name', 'copy-details', 'copy-call-stack']);
    expect(PANEL_ROW_MENU_ITEMS.some((i) => i.separator)).toBe(true);
  });
});

describe('runPanelRowAction', () => {
  it('reveals the frame in the Call Tree tab', () => {
    runPanelRowAction('show-in-call-tree', 42);
    expect(revealed).toEqual([42]);
    expect(copied).toEqual([]);
  });

  it('copies the frame name, including its suffix', () => {
    event = makeEvent({ suffix: ' (exception)' });
    runPanelRowAction('copy-name', 42);
    expect(copied).toEqual(['MyClass.run() (exception)']);
  });

  it('copies details with the governor limits the log reported', () => {
    // The parser always populates every pool, so mirror that shape.
    limits = {
      dmlStatements: { used: 0, limit: 150 },
      dmlRows: { used: 0, limit: 10000 },
      soqlQueries: { used: 1, limit: 100 },
      queryRows: { used: 0, limit: 50000 },
      soslQueries: { used: 0, limit: 20 },
    } as unknown as GovernorLimits;
    event = makeEvent({ soqlCount: { self: 1, total: 1 } } as Partial<LogEvent>);

    runPanelRowAction('copy-details', 42);

    expect(copied[0]).toContain('Name: MyClass.run()');
    expect(copied[0]).toContain('SOQL: 1/100 (self 1)');
  });

  it('copies the call stack outermost first', () => {
    const root = makeEvent({ text: 'execute_anonymous_apex' });
    event = makeEvent({ parent: root } as Partial<LogEvent>);

    runPanelRowAction('copy-call-stack', 42);

    expect(copied).toEqual(['execute_anonymous_apex\nMyClass.run()']);
  });

  it('ignores a copy action for a row with no resolvable event', () => {
    runPanelRowAction('copy-name', 99);
    expect(copied).toEqual([]);
  });

  it('still reveals when the event cannot be resolved, since goToRow owns that lookup', () => {
    runPanelRowAction('show-in-call-tree', 99);
    expect(revealed).toEqual([99]);
  });

  it('ignores an unknown menu id', () => {
    runPanelRowAction('copy-everything', 42);
    expect(copied).toEqual([]);
    expect(revealed).toEqual([]);
  });
});
