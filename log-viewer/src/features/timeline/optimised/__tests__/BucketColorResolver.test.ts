/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from 'vitest';

import type { CategoryAggregation, CategoryStats } from '../../types/flamechart.types.js';
import { type BatchColorInfo, resolveColor } from '../BucketColorResolver.js';

const COLORS: Record<string, number> = {
  Apex: 0x2b8f81,
  'Code Unit': 0x88ae58,
  System: 0x8d6e63,
  Automation: 0x51a16e,
  DML: 0xb06868,
  SOQL: 0x6d4c7d,
  Callout: 0xcca033,
  Validation: 0x5c8fa6,
};
const BATCH_COLORS = new Map<string, BatchColorInfo>(
  Object.entries(COLORS).map(([name, color]) => [name, { color }]),
);
const GRAY = 0x888888;

/** Each category as [count, totalDuration]. */
function statsOf(categories: Record<string, [number, number]>): CategoryStats {
  return {
    byCategory: new Map<string, CategoryAggregation>(
      Object.entries(categories).map(([name, [count, totalDuration]]) => [
        name,
        { count, totalDuration },
      ]),
    ),
    dominantCategory: '',
  };
}

describe('resolveColor', () => {
  // Priority wins outright, so each row gives the winner the least time and the fewest events.
  it.each<[string, Record<string, [number, number]>, string]>([
    ['DML over SOQL and Apex', { DML: [1, 100], SOQL: [10, 1000], Apex: [100, 10000] }, 'DML'],
    [
      'SOQL over Apex and Code Unit',
      { SOQL: [1, 100], Apex: [10, 1000], 'Code Unit': [100, 10000] },
      'SOQL',
    ],
    [
      'Callout over Apex and System',
      { Callout: [1, 100], Apex: [10, 1000], System: [100, 10000] },
      'Callout',
    ],
    [
      'Apex over Code Unit and System',
      { Apex: [1, 100], 'Code Unit': [10, 1000], System: [100, 10000] },
      'Apex',
    ],
    ['System over Automation', { System: [1, 100], Automation: [10, 1000] }, 'System'],
    ['Automation over Validation', { Automation: [1, 100], Validation: [10, 1000] }, 'Automation'],
    ['Validation alone', { Validation: [5, 500] }, 'Validation'],
    [
      'a known category over an unknown one',
      { Unknown: [100, 10000], Automation: [1, 100] },
      'Automation',
    ],
  ])('picks %s', (_name, categories, winner) => {
    expect(resolveColor(statsOf(categories), BATCH_COLORS)).toEqual({
      color: COLORS[winner],
      dominantCategory: winner,
    });
  });

  // Only categories outside the priority list can tie on it.
  it.each<[string, Record<string, [number, number]>, string]>([
    ['an unknown category alone', { Unknown: [5, 500] }, 'Unknown'],
    ['the longer of two unknown categories', { Short: [10, 100], Long: [1, 500] }, 'Long'],
    [
      'the busier of two unknown categories of equal time',
      { Quiet: [1, 500], Busy: [10, 500] },
      'Busy',
    ],
  ])('paints %s gray, and names it', (_name, categories, winner) => {
    expect(resolveColor(statsOf(categories), BATCH_COLORS)).toEqual({
      color: GRAY,
      dominantCategory: winner,
    });
  });

  it('paints no categories gray, and names none', () => {
    expect(resolveColor(statsOf({}), BATCH_COLORS)).toEqual({ color: GRAY, dominantCategory: '' });
  });
});
