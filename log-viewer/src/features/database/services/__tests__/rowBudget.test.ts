/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { beforeEach, describe, expect, it } from '@jest/globals';
import type { ApexLog, Limits } from 'apex-log-parser';

import { emptyLimits } from '../../../../components/__tests__/limitsTestUtils.js';

import {
  UNKNOWN_OBJECT,
  type DatabaseOverview,
  type DatabaseStatement,
} from '../databaseOverview.js';

// The section reads three things: the statements, the governor peaks and whether
// the log captured any. Each is stubbed so the budgets are the only logic tested.
let overview: DatabaseOverview;
let peaks: Limits;

jest.mock('../databaseOverview.js', () => ({
  ...jest.requireActual('../databaseOverview.js'),
  databaseOverview: () => overview,
}));
jest.mock('../../../timeline/optimised/apex-limit-series.js', () => ({
  apexLimitTimeSeries: () => ({ events: [] }),
}));
jest.mock('../../../../components/logOverviewMetrics.js', () => ({
  ...jest.requireActual('../../../../components/logOverviewMetrics.js'),
  limitTotals: () => peaks,
}));

import { rowBudgets } from '../rowBudget.js';

const statement = (fields: Partial<DatabaseStatement>): DatabaseStatement => ({
  eventIndex: 1,
  eventIndexes: [1],
  kind: 'SOQL',
  label: 'SELECT Id FROM Account',
  sObject: 'Account',
  timeNs: 1_000_000,
  netNs: 1_000_000,
  selfNs: 1_000_000,
  rows: 0,
  maxRows: 0,
  repeats: 1,
  ...fields,
});

const overviewOf = (
  ranked: DatabaseStatement[],
  counts = { soql: 2, dml: 1, sosl: 1 },
): DatabaseOverview => ({
  time: {
    timeNs: 0,
    logNs: 1_000_000_000,
    percentOfLog: 0,
    soql: { timeNs: 0, statements: counts.soql },
    dml: { timeNs: 0, statements: counts.dml },
    sosl: { timeNs: 0, statements: counts.sosl },
  },
  ranked,
  tree: [],
  askedBy: [],
  burnedIn: [],
});

const logWith = (snapshots: number) =>
  ({ governorLimits: { snapshots: Array.from({ length: snapshots }) } }) as unknown as ApexLog;

const defaultPeaks = (): Limits => ({
  ...emptyLimits(),
  soqlQueries: { used: 2, limit: 100 },
  queryRows: { used: 300, limit: 50_000 },
  dmlStatements: { used: 1, limit: 150 },
  dmlRows: { used: 40, limit: 10_000 },
  soslQueries: { used: 1, limit: 20 },
});

beforeEach(() => {
  peaks = defaultPeaks();
  overview = overviewOf([]);
});

describe('rowBudgets', () => {
  it('splits each row limit by the SObject that holds it, biggest first', () => {
    overview = overviewOf([
      statement({ rows: 100, maxRows: 100 }),
      statement({ rows: 200, maxRows: 200, sObject: 'Contact' }),
      statement({ rows: 40, maxRows: 20, kind: 'DML', sObject: 'Case' }),
    ]);

    const { budgets } = rowBudgets(logWith(1));

    expect(budgets.map((budget) => [budget.kind, budget.limit, budget.used])).toEqual([
      ['SOQL', 50_000, 300],
      ['DML', 10_000, 40],
    ]);
    expect(budgets[0]?.groups).toEqual([
      { sObject: 'Contact', rows: 200, statements: 1 },
      { sObject: 'Account', rows: 100, statements: 1 },
    ]);
    expect(budgets[1]?.groups).toEqual([{ sObject: 'Case', rows: 40, statements: 1 }]);
  });

  it('gathers every statement on one SObject into one group', () => {
    overview = overviewOf([
      statement({ rows: 100, maxRows: 100 }),
      statement({ rows: 25, maxRows: 25, label: 'SELECT Name FROM Account' }),
    ]);

    expect(rowBudgets(logWith(1)).budgets[0]?.groups).toEqual([
      { sObject: 'Account', rows: 125, statements: 2 },
    ]);
  });

  it('counts every run of a repeated statement, not the statement once', () => {
    overview = overviewOf([statement({ rows: 40_000, maxRows: 200, repeats: 200 })]);

    expect(rowBudgets(logWith(1)).budgets[0]?.groups).toEqual([
      { sObject: 'Account', rows: 40_000, statements: 200 },
    ]);
  });

  it('reports the rows the governor counted that no statement accounts for', () => {
    overview = overviewOf([statement({ rows: 100, maxRows: 100 })]);

    const budget = rowBudgets(logWith(1)).budgets[0];

    expect(budget).toMatchObject({ used: 300, observed: 100 });
  });

  it('has no governor figure without a snapshot, so the observed rows answer', () => {
    overview = overviewOf([statement({ rows: 100, maxRows: 100 })]);

    const { budgets, hasLimits } = rowBudgets(logWith(0));

    expect(hasLimits).toBe(false);
    expect(budgets[0]).toMatchObject({ used: null, observed: 100 });
  });

  it('counts the statements of every kind against its own limit', () => {
    expect(rowBudgets(logWith(1)).counts).toEqual([
      { label: 'SOQL', used: 2, limit: 100 },
      { label: 'DML', used: 1, limit: 150 },
      { label: 'SOSL', used: 1, limit: 20 },
    ]);
  });

  it('counts the statements the tree held when the log captured no governor peak', () => {
    overview = overviewOf([], { soql: 60, dml: 3, sosl: 0 });

    expect(rowBudgets(logWith(0)).counts).toEqual([
      { label: 'SOQL', used: 60, limit: 100 },
      { label: 'DML', used: 3, limit: 150 },
      { label: 'SOSL', used: 0, limit: 20 },
    ]);
  });

  it('gives a search its per-query cap only, never a transaction total', () => {
    overview = overviewOf([
      statement({ kind: 'SOSL', sObject: null, rows: 900, maxRows: 600 }),
      statement({ kind: 'SOSL', sObject: null, rows: 40, maxRows: 40, label: 'FIND :other' }),
    ]);

    const { budgets, worstSearch } = rowBudgets(logWith(1));

    expect(worstSearch).toEqual({ rows: 600, limit: 2000 });
    expect(budgets.every((budget) => budget.groups.length === 0)).toBe(true);
  });

  it('names no worst search when the log holds none', () => {
    expect(rowBudgets(logWith(1)).worstSearch).toBeNull();
  });

  it('leaves out a statement that read or wrote no rows', () => {
    overview = overviewOf([statement({ rows: 0 })]);

    expect(rowBudgets(logWith(1)).budgets[0]?.groups).toEqual([]);
  });

  it('holds the rows of a statement that names no SObject under the unknown label', () => {
    overview = overviewOf([statement({ rows: 10, sObject: null })]);

    expect(rowBudgets(logWith(1)).budgets[0]?.groups).toEqual([
      { sObject: UNKNOWN_OBJECT, rows: 10, statements: 1 },
    ]);
  });

  it('brings an SObject read and written together, biggest total first', () => {
    overview = overviewOf([
      statement({ rows: 100, maxRows: 100 }),
      statement({ rows: 40, kind: 'DML', sObject: 'Account', repeats: 3 }),
      statement({ rows: 60, maxRows: 60, sObject: 'Contact' }),
    ]);

    expect(rowBudgets(logWith(1)).objects).toEqual([
      { sObject: 'Account', rowsRead: 100, rowsWritten: 40, rows: 140 },
      { sObject: 'Contact', rowsRead: 60, rowsWritten: 0, rows: 60 },
    ]);
  });

  it('leaves the split out while one limit holds every row, which is its own bar', () => {
    overview = overviewOf([statement({ rows: 100, maxRows: 100 })]);

    expect(rowBudgets(logWith(1)).objects).toEqual([]);
  });

  it('brings one SObject together when the two sides name it in a different case', () => {
    overview = overviewOf([
      statement({ rows: 100, maxRows: 100, sObject: 'account' }),
      statement({ rows: 5, kind: 'DML', sObject: 'Account' }),
    ]);

    expect(rowBudgets(logWith(1)).objects).toEqual([
      { sObject: 'account', rowsRead: 100, rowsWritten: 5, rows: 105 },
    ]);
  });

  it('leaves the unknown label out of the split, a bucket of objects and not one', () => {
    overview = overviewOf([
      statement({ rows: 100, sObject: null }),
      statement({ rows: 5, kind: 'DML', sObject: null }),
      statement({ rows: 10, maxRows: 10 }),
      statement({ rows: 2, kind: 'DML', sObject: 'Case' }),
    ]);

    expect(rowBudgets(logWith(1)).objects).toEqual([
      { sObject: 'Account', rowsRead: 10, rowsWritten: 0, rows: 10 },
      { sObject: 'Case', rowsRead: 0, rowsWritten: 2, rows: 2 },
    ]);
  });

  it('leaves a search out of the SObject split, which holds rows against no total', () => {
    overview = overviewOf([
      statement({ rows: 30, maxRows: 30, kind: 'SOSL', sObject: 'Lead' }),
      statement({ rows: 10, maxRows: 10 }),
      statement({ rows: 5, kind: 'DML', sObject: 'Case' }),
    ]);

    expect(rowBudgets(logWith(1)).objects).toEqual([
      { sObject: 'Account', rowsRead: 10, rowsWritten: 0, rows: 10 },
      { sObject: 'Case', rowsRead: 0, rowsWritten: 5, rows: 5 },
    ]);
  });
});
