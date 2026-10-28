/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { describe, expect, it, beforeEach, beforeAll } from '@jest/globals';
import type { GovernorLimits } from '@apexdevtools/apex-log-parser';

import { indexOf, storeOf } from '#test-helpers/apexLog.js';
import { governorLimits, limitValue } from '#test-helpers/limits.js';
import type { LogStore } from '#core/log/LogStore.js';

const revealed: number[] = [];
const copied: string[] = [];
let store: LogStore | null = null;
let limits: GovernorLimits | null = null;

jest.mock('../../features/call-tree/navigation.js', () => ({
  goToRow: async (target: { eventIndex: number }) => {
    revealed.push(target.eventIndex);
  },
}));
jest.mock('#core/utility/Clipboard.js', () => ({
  copyToClipboard: (text: string) => copied.push(text),
}));
jest.mock('#core/log/LogStore.js', () => ({
  ...jest.requireActual<object>('#core/log/LogStore.js'),
  currentLogStore: () =>
    store && {
      eventByIndex: (i: number) => store?.eventByIndex(i) ?? null,
      log: { limits },
    },
}));

import { PANEL_ROW_MENU_ITEMS, runPanelRowAction } from '../panelRowMenu.js';

let run = 0;
let codeUnit = 0;
const ABSENT = 99_999;

beforeAll(async () => {
  const parsed = await storeOf(
    '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|MyClass.run()\n' +
      '09:18:22.6 (1100)|SOQL_EXECUTE_BEGIN|[2]|Aggregations:0|SELECT Id FROM Account\n' +
      '09:18:22.6 (1200)|SOQL_EXECUTE_END|[2]|Rows:1\n' +
      '09:18:22.6 (3000)|METHOD_EXIT|[1]|MyClass.run()\n',
  );
  store = parsed.store;
  run = indexOf(parsed.log, 'MyClass.run()');
  codeUnit = indexOf(parsed.log, 'apex://pkg.Entry');
});

beforeEach(() => {
  revealed.length = 0;
  copied.length = 0;
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
    runPanelRowAction('show-in-call-tree', run);
    expect(revealed).toEqual([run]);
    expect(copied).toEqual([]);
  });

  it('copies the frame name, including its suffix', () => {
    runPanelRowAction('copy-name', codeUnit);
    expect(copied).toEqual(['apex://pkg.Entry (code unit)']);
  });

  it('copies details with the governor limits the log reported', () => {
    limits = governorLimits({
      dmlStatements: limitValue(0, 150),
      dmlRows: limitValue(0, 10000),
      soqlQueries: limitValue(1, 100),
      queryRows: limitValue(0, 50000),
      soslQueries: limitValue(0, 20),
    });
    runPanelRowAction('copy-details', run);

    expect(copied[0]).toContain('Name: MyClass.run()');
    expect(copied[0]).toContain('SOQL: 1/100 (self 0)');
  });

  it('copies the call stack outermost first', () => {
    runPanelRowAction('copy-call-stack', run);

    expect(copied).toEqual(['EXECUTION_STARTED\napex://pkg.Entry (code unit)\nMyClass.run()']);
  });

  it('ignores a copy action for a row with no resolvable event', () => {
    runPanelRowAction('copy-name', ABSENT);
    expect(copied).toEqual([]);
  });

  it('still reveals when the event cannot be resolved, since goToRow owns that lookup', () => {
    runPanelRowAction('show-in-call-tree', ABSENT);
    expect(revealed).toEqual([ABSENT]);
  });

  it('ignores an unknown menu id', () => {
    runPanelRowAction('copy-everything', run);
    expect(copied).toEqual([]);
    expect(revealed).toEqual([]);
  });
});
