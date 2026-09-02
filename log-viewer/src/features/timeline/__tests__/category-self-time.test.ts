/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';
import type { ApexLog, LogCategory, LogEvent } from 'apex-log-parser';

import { categorySelfTimes, toTimelineKeys } from '../utils/category-self-time.js';

function node(category: LogCategory, self: number, children: LogEvent[] = []): LogEvent {
  return {
    category,
    duration: { self, total: self },
    children,
  } as unknown as LogEvent;
}

function log(children: LogEvent[]): ApexLog {
  return node('', 0, children) as ApexLog;
}

describe('categorySelfTimes', () => {
  it('sums self time per category across siblings and nesting', () => {
    const root = log([
      node('Apex', 10, [node('SOQL', 5), node('Apex', 3)]),
      node('DML', 7),
      node('Apex', 2),
    ]);

    const totals = categorySelfTimes(root);

    expect(totals.get('Apex')).toBe(15);
    expect(totals.get('SOQL')).toBe(5);
    expect(totals.get('DML')).toBe(7);
  });

  it('counts only self time, so a parent excludes its children', () => {
    const root = log([node('Apex', 10, [node('Apex', 4)])]);

    expect(categorySelfTimes(root).get('Apex')).toBe(14);
  });

  it('skips uncategorised events but still walks their children', () => {
    const root = log([node('', 100, [node('SOQL', 5)])]);

    const totals = categorySelfTimes(root);

    expect(totals.get('SOQL')).toBe(5);
    expect(totals.has('')).toBe(false);
  });

  it('returns an empty map for an empty log', () => {
    expect(categorySelfTimes(log([])).size).toBe(0);
  });

  it('handles a 5000-deep chain without a stack overflow', () => {
    let chain = node('Apex', 1);
    for (let i = 0; i < 4999; i++) {
      chain = node('Apex', 1, [chain]);
    }

    expect(categorySelfTimes(log([chain])).get('Apex')).toBe(5000);
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

    expect(keys.map((k) => k.label)).toEqual([
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

    expect(keys.find((k) => k.label === 'Apex')?.selfTimeNs).toBe(15);
    expect(keys.find((k) => k.label === 'SOQL')?.selfTimeNs).toBe(5);
  });

  it('reads 0 for a category the log never used', () => {
    const keys = toTimelineKeys(color, new Map<LogCategory, number>([['Apex', 15]]));

    expect(keys.find((k) => k.label === 'DML')?.selfTimeNs).toBe(0);
    expect(keys.find((k) => k.label === 'Callout')?.selfTimeNs).toBe(0);
  });

  describe('the legacy chart', () => {
    /** Its key names 6 groups, not the 7 categories, and draws them in this order. */
    it('names the groups the legacy chart draws', () => {
      expect(toTimelineKeys(color, undefined, true).map((k) => k.label)).toEqual([
        'Method',
        'Code Unit',
        'System Method',
        'Workflow',
        'DML',
        'SOQL',
      ]);
    });

    /**
     * Apex and Callout are both `Method` there. Left unfolded the legend showed two
     * chips of one colour, naming neither of them what the chart's own key says.
     * Validation folds into System Method the same way, once the parser reports it.
     */
    it('folds the categories that share one group, and sums their self time', () => {
      const keys = toTimelineKeys(
        color,
        new Map<LogCategory, number>([
          ['Apex', 15],
          ['Callout', 5],
          ['System', 3],
          ['Validation', 4],
        ]),
        true,
      );

      const method = keys.find((k) => k.label === 'Method');
      expect(method?.selfTimeNs).toBe(20);
      expect(method?.fillColor).toBe('#a1');
      expect(method?.categories).toEqual(['Apex', 'Callout']);
      expect(keys.find((k) => k.label === 'System Method')?.selfTimeNs).toBe(7);
    });
  });
});
