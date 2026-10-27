/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';
import { rawStoreOf } from '#test-helpers/apexLog.js';
import type { LogCategory } from '../../../core/log/category.js';
import { buildLogIndex } from '../../../core/log/LogIndex.js';
import { selfTimeByCategory, toTimelineKeys } from '../utils/category-self-time.js';

/** Self time by category for a whole log `body`, timestamps in nanoseconds. */
async function totalsOf(body: string): Promise<ReadonlyMap<string, number>> {
  const { log } = await rawStoreOf(body);
  return selfTimeByCategory(buildLogIndex(log));
}

const line = (ns: number, rest: string): string => `09:18:22.6 (${ns})|${rest}\n`;

describe('selfTimeByCategory', () => {
  it('sums self time per category across siblings and nesting', async () => {
    const totals = await totalsOf(
      line(0, 'METHOD_ENTRY|[1]|01p|ns.A.run()') +
        line(10, 'SOQL_EXECUTE_BEGIN|[2]|Aggregations:0|SELECT Id FROM Account') +
        line(15, 'SOQL_EXECUTE_END|[2]|Rows:1') +
        line(15, 'METHOD_ENTRY|[3]|01p|ns.A.step()') +
        line(18, 'METHOD_EXIT|[3]|ns.A.step()') +
        line(18, 'METHOD_EXIT|[1]|ns.A.run()') +
        line(18, 'DML_BEGIN|[4]|Op:Insert|Type:Account|Rows:1') +
        line(25, 'DML_END|[4]') +
        line(25, 'METHOD_ENTRY|[5]|01p|ns.A.last()') +
        line(27, 'METHOD_EXIT|[5]|ns.A.last()'),
    );

    // Apex: 10 of run's own, 3 of step, 2 of last.
    expect(totals.get('Apex')).toBe(15);
    expect(totals.get('SOQL')).toBe(5);
    expect(totals.get('DML')).toBe(7);
  });

  it('counts only self time, so a parent excludes its children', async () => {
    const totals = await totalsOf(
      line(0, 'METHOD_ENTRY|[1]|01p|ns.A.run()') +
        line(10, 'METHOD_ENTRY|[2]|01p|ns.A.step()') +
        line(14, 'METHOD_EXIT|[2]|ns.A.step()') +
        line(14, 'METHOD_EXIT|[1]|ns.A.run()'),
    );

    expect(totals.get('Apex')).toBe(14);
  });

  it('holds a zero uncategorised sum for an empty log', async () => {
    expect((await totalsOf('')).get('')).toBe(0);
  });
});

describe('toTimelineKeys', () => {
  const palette: Record<string, string> = {
    Apex: '#a1',
    'Code Unit': '#a2',
    System: '#a3',
    Automation: '#a4',
    DML: '#a5',
    SOQL: '#a6',
    Callout: '#a7',
  };
  const color = (category: string) => palette[category] ?? '';

  it('builds the legend in category order with the palette colors', () => {
    const keys = toTimelineKeys(color);

    expect(keys.map((k) => k.category)).toEqual([
      'Apex',
      'Code Unit',
      'System',
      'Automation',
      'DML',
      'SOQL',
      'Callout',
    ]);
    expect(keys.map((k) => k.fillColor)).toEqual(['#a1', '#a2', '#a3', '#a4', '#a5', '#a6', '#a7']);
    expect(keys.every((k) => k.selfTimeNs === undefined)).toBe(true);
  });

  it('attaches self time per category when provided', () => {
    const selfTimes = new Map<LogCategory, number>([
      ['Apex', 15],
      ['SOQL', 5],
    ]);

    const keys = toTimelineKeys(color, selfTimes);

    expect(keys.find((k) => k.category === 'Apex')?.selfTimeNs).toBe(15);
    expect(keys.find((k) => k.category === 'SOQL')?.selfTimeNs).toBe(5);
  });

  it('reads 0 for a category the log never used', () => {
    const keys = toTimelineKeys(color, new Map<LogCategory, number>([['Apex', 15]]));

    expect(keys.find((k) => k.category === 'DML')?.selfTimeNs).toBe(0);
    expect(keys.find((k) => k.category === 'Callout')?.selfTimeNs).toBe(0);
  });
});
