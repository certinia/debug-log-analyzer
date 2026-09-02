/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';
import type { GovernorLimits, LogEvent } from 'apex-log-parser';

import { EVENT_METRICS, formatBytes, HEAP_PEAK, usageParts } from '../eventMetrics.js';

const limits = {
  soqlQueries: { limit: 100 },
  queryRows: { limit: 50_000 },
  dmlStatements: { limit: 150 },
  dmlRows: { limit: 10_000 },
  soslQueries: { limit: 20 },
  heapSize: { limit: 6_000_000 },
} as unknown as GovernorLimits;

describe('usageParts', () => {
  it('reads used / limit with the percentage and the self reading', () => {
    const parts = usageParts(3, 100, String, '1');

    expect(parts.primary).toBe('3 / 100');
    expect(parts.qualifiers).toEqual(['3.00%', 'self 1']);
  });

  // No denominator means no share of anything, so nothing to qualify.
  it('gives the count alone, and no percentage, where there is no limit', () => {
    const parts = usageParts(7, 0, String, null);

    expect(parts.primary).toBe('7');
    expect(parts.qualifiers).toEqual([]);
  });
});

describe('EVENT_METRICS', () => {
  it('denominates SOSL rows only on a SOSL statement', () => {
    const soslRows = EVENT_METRICS.find((metric) => metric.label === 'SOSL Rows');

    expect(soslRows?.limit(limits, 'sosl')).toBe(2000);
    expect(soslRows?.limit(limits, 'soql')).toBe(0);
    expect(soslRows?.limit(limits)).toBe(0);
  });

  it('leaves throws and the two heap totals undenominated', () => {
    const undenominated = EVENT_METRICS.filter((metric) => metric.limit(limits) === 0);

    expect(undenominated.map((metric) => metric.label)).toEqual([
      'SOSL Rows',
      'Throws',
      'Heap net',
      'Heap alloc',
    ]);
  });

  // The order is the reading order in every view, so a row cannot overtake another.
  it('keeps a stable declaration order', () => {
    expect(EVENT_METRICS.map((metric) => metric.label)).toEqual([
      'SOQL',
      'SOQL Rows',
      'DML',
      'DML Rows',
      'SOSL',
      'SOSL Rows',
      'Throws',
      'Heap net',
      'Heap alloc',
    ]);
  });
});

describe('HEAP_PEAK', () => {
  it('measures against the heap governor limit', () => {
    expect(HEAP_PEAK.pick({ heapPeak: 4_000_000 } as LogEvent)).toBe(4_000_000);
    expect(HEAP_PEAK.limit(limits)).toBe(6_000_000);
  });
});

describe('formatBytes', () => {
  it('separates thousands and keeps a negative net', () => {
    expect(formatBytes(1_572_864)).toBe('1,572,864 bytes');
    expect(formatBytes(-2048)).toBe('-2,048 bytes');
  });
});
