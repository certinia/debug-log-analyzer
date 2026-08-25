/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { beforeEach, describe, expect, it } from '@jest/globals';
import type { ApexLog } from 'apex-log-parser';
import type { LitElement } from 'lit';

import type { StackedTimeBar } from '../../../../components/StackedTimeBar.js';
import type { LogStore } from '../../../../core/log/LogStore.js';
import type { RowBudget, RowBudgets } from '../../services/rowBudget.js';

// The bars colour by statement kind, so the log needs no namespace list.
const apexLog = { namespaces: ['pkg'] } as unknown as ApexLog;
let budgets: RowBudgets;

jest.mock('../../services/rowBudget.js', () => ({
  rowBudgets: () => budgets,
}));

import '../DatabaseRowBudget.js';

const full = (): RowBudgets => ({
  budgets: [
    {
      kind: 'SOQL',
      used: 45_000,
      observed: 45_000,
      limit: 50_000,
      groups: [
        { sObject: 'Contact', rows: 40_000, statements: 3 },
        { sObject: 'Account', rows: 5_000, statements: 1 },
      ],
    },
    {
      kind: 'DML',
      used: 400,
      observed: 300,
      limit: 10_000,
      groups: [{ sObject: 'Case', rows: 300, statements: 1 }],
    },
  ],
  objects: [
    { sObject: 'Contact', rowsRead: 40_000, rowsWritten: 0, rows: 40_000 },
    { sObject: 'Account', rowsRead: 5_000, rowsWritten: 0, rows: 5_000 },
    { sObject: 'Case', rowsRead: 0, rowsWritten: 300, rows: 300 },
  ],
  counts: [
    { label: 'SOQL', used: 62, limit: 100 },
    { label: 'DML', used: 14, limit: 150 },
    { label: 'SOSL', used: 2, limit: 20 },
  ],
  worstSearch: { rows: 1_800, limit: 2000 },
  hasLimits: true,
  statements: 6,
});

/** `full()` with one change per budget, for the cases that vary one figure. */
const withBudgets = (...changes: Partial<RowBudget>[]): RowBudgets => {
  const base = full();
  return {
    ...base,
    budgets: base.budgets.map((budget, index) => ({ ...budget, ...changes[index] })),
  };
};

async function mount(): Promise<LitElement> {
  const element = document.createElement('database-rows');
  // No provider in the test, so the consumed store is assigned straight on.
  (element as unknown as { logStore: LogStore }).logStore = {
    log: apexLog,
  } as unknown as LogStore;
  document.body.append(element);
  await element.updateComplete;
  return element;
}

const texts = (element: Element, selector: string) =>
  [...(element.shadowRoot?.querySelectorAll(selector) ?? [])].map((node) =>
    (node.textContent ?? '').replace(/\s+/g, ' ').trim(),
  );

const bars = (element: Element) =>
  [...(element.shadowRoot?.querySelectorAll('stacked-time-bar') ?? [])] as StackedTimeBar[];

const barOf = (element: Element, label: string) =>
  bars(element).find((bar) => bar.getAttribute('label') === label);

beforeEach(() => {
  document.body.replaceChildren();
  budgets = full();
});

describe('database-rows', () => {
  it('shows each row limit as the used figure over the limit', async () => {
    const element = await mount();

    expect(texts(element, '.budget__head')).toEqual([
      'Query rows 45,000 / 50,000',
      'DML rows 400 / 10,000',
    ]);
  });

  it('measures the bar against the limit, not against the rows it holds', async () => {
    const element = await mount();

    expect(
      ['Query rows', 'DML rows'].map((label) => {
        const bar = barOf(element, label);
        return [bar?.format(1_000), bar?.total];
      }),
    ).toEqual([
      ['1,000', 50_000],
      ['1,000', 10_000],
    ]);
  });

  it('splits the bar by SObject, biggest first, and names what each holds', async () => {
    const [queryRows] = bars(await mount());

    expect(
      queryRows?.segments.map((segment) => [segment.label, segment.value, segment.detail]),
    ).toEqual([
      ['Contact', 40_000, '3 statements'],
      ['Account', 5_000, '1 statement'],
    ]);
  });

  it('gives the rows no statement holds a segment of their own', async () => {
    const dmlRows = bars(await mount())[1];

    expect(dmlRows?.segments.at(-1)).toMatchObject({ label: 'Not accounted for', value: 100 });
  });

  it('holds no unaccounted segment when the statements sum past the peak', async () => {
    budgets = withBudgets({ used: 40_000, observed: 45_000 });

    expect(bars(await mount())[0]?.segments.map((segment) => segment.label)).toEqual([
      'Contact',
      'Account',
    ]);
  });

  it('warns as a limit is approached, and alarms once it is near breach', async () => {
    const element = await mount();

    // 90% of the query rows, 4% of the DML rows.
    expect(texts(element, '.budget__figure--warn')).toEqual(['45,000 / 50,000']);
    expect(texts(element, '.budget__figure--safe')).toEqual(['400 / 10,000']);
  });

  it('counts the statements of every kind against its own limit', async () => {
    const element = await mount();

    expect(texts(element, '.counts > span')).toEqual(['SOQL 62/100', 'DML 14/150', 'SOSL 2/20']);
  });

  it('gives a search its per-query cap, never a bar', async () => {
    const element = await mount();

    expect(texts(element, '.note')).toEqual(['Worst search 1,800 of 2,000 rows per query.']);
  });

  it('leaves out a limit the log holds nothing against', async () => {
    budgets = withBudgets({}, { used: 0, observed: 0, groups: [] });

    expect(texts(await mount(), '.budget__head')).toEqual(['Query rows 45,000 / 50,000']);
  });

  it('says why the rows can pass a limit that the bar is drawn against', async () => {
    budgets = withBudgets({ used: 60_000, observed: 60_000 });

    expect(texts(await mount(), '.note')[0]).toContain('certified package holds its own limits');
  });

  it('says why the bar overflows when the statements pass a limit the peak holds', async () => {
    budgets = withBudgets({ observed: 55_000 });

    expect(texts(await mount(), '.note')[0]).toContain('certified package holds its own limits');
  });

  it('says nothing of a certified package while every limit holds', async () => {
    expect(texts(await mount(), '.note')).toEqual(['Worst search 1,800 of 2,000 rows per query.']);
  });

  it('says the figures are observed when the log captured no cumulative limits', async () => {
    budgets = { ...full(), hasLimits: false };

    expect(texts(await mount(), '.note').at(-1)).toContain('CUMULATIVE_LIMIT_USAGE');
  });

  it('shows the rows the statements held when the log captured no governor peak', async () => {
    budgets = { ...withBudgets({ used: null }, { used: null }), hasLimits: false };

    expect(texts(await mount(), '.budget__head')).toEqual([
      'Query rows 45,000 / 50,000',
      'DML rows 300 / 10,000',
    ]);
  });

  it('brings the two limits together per SObject, read beside written', async () => {
    const objects = barOf(await mount(), 'Query and DML rows by SObject');

    expect(
      objects?.segments.map((segment) => [segment.label, segment.value, segment.detail]),
    ).toEqual([
      ['Contact', 40_000, '40,000 read · 0 written'],
      ['Account', 5_000, '5,000 read · 0 written'],
      ['Case', 300, '0 read · 300 written'],
    ]);
    // Rows against no one limit, so the bar measures itself.
    expect(objects?.total).toBe(0);
  });

  it('leaves the SObject split out when the service brings nothing together', async () => {
    budgets = { ...full(), objects: [] };

    expect(texts(await mount(), '.objects__head')).toEqual([]);
  });

  it('says so when the log records no database statements', async () => {
    budgets = { ...full(), statements: 0 };

    expect(texts(await mount(), '.note')).toEqual(['The log records no database statements.']);
  });
});
