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
  it("reads the selection against the log's own total, with the limit as a qualifier", () => {
    const parts = usageParts(3, 12, 100, String, '1');

    expect(parts.primary).toBe('3 of 12');
    expect(parts.qualifiers).toEqual(['25.00% of log', '3.00% of the 100 limit', 'self 1']);
  });

  // The log reported no limit, so there is no share of one to give.
  it('keeps the contribution and drops the limit where none was reported', () => {
    const parts = usageParts(3, 12, 0, String, null);

    expect(parts.primary).toBe('3 of 12');
    expect(parts.qualifiers).toEqual(['25.00% of log']);
  });

  // A whole-log reading's share of itself is 100%, which says nothing.
  it('carries no denominator when the selection is the whole log', () => {
    const parts = usageParts(7, 7, 0, String, null);

    expect(parts.primary).toBe('7');
    expect(parts.qualifiers).toEqual([]);
  });

  // Only the whole-log reading drops the denominator: a reading past the log's own total is an
  // anomaly, and a bare number would hide it.
  it('keeps the denominator where the selection reads past the log total', () => {
    const parts = usageParts(15, 12, 0, String, null);

    expect(parts.primary).toBe('15 of 12');
    expect(parts.qualifiers).toEqual(['125.00% of log']);
  });

  // Heap is signed: a selection that frees more than it allocates gave the transaction heap back.
  it('keeps a net-negative reading signed', () => {
    const parts = usageParts(-5, 300, 0, String, null);

    expect(parts.primary).toBe('-5 of 300');
    expect(parts.qualifiers).toEqual(['-1.67% of log']);
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
