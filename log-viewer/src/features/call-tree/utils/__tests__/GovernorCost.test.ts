/**
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';
import type { GovernorLimits } from 'apex-log-parser';

import {
  governorCost,
  governorCostBreakdown,
  governorCostMax,
  type GovernorCostRow,
} from '../GovernorCost.js';

function limits(overrides: Record<string, number> = {}): GovernorLimits {
  const metric = (limit: number) => ({ used: 0, limit });
  return {
    soqlQueries: metric(overrides.soqlQueries ?? 100),
    dmlStatements: metric(overrides.dmlStatements ?? 150),
    soslQueries: metric(overrides.soslQueries ?? 20),
    queryRows: metric(overrides.queryRows ?? 50000),
    dmlRows: metric(overrides.dmlRows ?? 10000),
    heapSize: metric(overrides.heapSize ?? 6000000),
  } as unknown as GovernorLimits;
}

function row(overrides: Partial<Record<string, number>> = {}): GovernorCostRow {
  const st = (total: number) => ({ self: 0, total });
  return {
    soqlCount: st(overrides.soql ?? 0),
    dmlCount: st(overrides.dml ?? 0),
    soslCount: st(overrides.sosl ?? 0),
    soqlRowCount: st(overrides.soqlRows ?? 0),
    dmlRowCount: st(overrides.dmlRows ?? 0),
    soslRowCount: st(overrides.soslRows ?? 0),
    // `heap` drives the Heap cost metric (which reads heapPeak); heapAllocated (net) and
    // heapGross (churn) are not read by the cost and are here only to satisfy the shape.
    heapAllocated: st(overrides.heapNet ?? 0),
    heapGross: st(overrides.heapGross ?? 0),
    heapPeak: overrides.heap ?? 0,
    governorCost: 0,
    governorCostMax: 0,
  };
}

// COST_METRICS has 6 entries (SOQL, DML, SOSL, SOQL Rows, DML Rows, Heap);
// limits() reports a limit for all 6, so the divisor is 6 in these tests. SOSL
// rows are excluded — they have no governor limit.
const REPORTED_GOVERNORS = 6;

describe('governorCost', () => {
  it('averages each governor as a percentage of its own limit, across all reported governors', () => {
    // SOQL 50% + DML 10% + Heap 50%, three others 0% → (50 + 10 + 50) / 6
    expect(governorCost(row({ soql: 50, dml: 15, heap: 3000000 }), limits())).toBeCloseTo(
      110 / REPORTED_GOVERNORS,
      5,
    );
  });

  it('reaches 100% only when every reported governor is maxed', () => {
    const maxed = row({
      soql: 100,
      dml: 150,
      sosl: 20,
      soqlRows: 50000,
      dmlRows: 10000,
      heap: 6000000,
    });
    expect(governorCost(maxed, limits())).toBeCloseTo(100, 5);
  });

  it('dilutes a single maxed governor by the untouched ones', () => {
    // SOQL alone at its limit → 100 / 7
    expect(governorCost(row({ soql: 100 }), limits())).toBeCloseTo(100 / REPORTED_GOVERNORS, 5);
  });

  it('divides only by governors with a known limit', () => {
    // Only heap has a limit → average over a single governor = heap's own %.
    expect(
      governorCost(
        row({ soql: 100, heap: 600000 }),
        limits({
          soqlQueries: 0,
          dmlStatements: 0,
          soslQueries: 0,
          queryRows: 0,
          dmlRows: 0,
          heapSize: 6000000,
        }),
      ),
    ).toBe(10);
  });

  it('is 0 when nothing is consumed', () => {
    expect(governorCost(row(), limits())).toBe(0);
  });
});

describe('governorCostMax', () => {
  it('returns the single tightest governor, undiluted', () => {
    // SOQL 90% is the peak among SOQL 90 / DML 10 / Heap 50.
    expect(governorCostMax(row({ soql: 90, dml: 15, heap: 3000000 }), limits())).toBeCloseTo(90, 5);
  });

  it('can exceed 100% when one limit is breached', () => {
    expect(governorCostMax(row({ soql: 150 }), limits())).toBeCloseTo(150, 5);
  });

  it('is 0 when nothing is consumed', () => {
    expect(governorCostMax(row(), limits())).toBe(0);
  });
});

describe('governorCostBreakdown', () => {
  it('lists each consumed metric, highest contribution first', () => {
    const breakdown = governorCostBreakdown(row({ soql: 90, dml: 15, heap: 3000000 }), limits());
    expect(breakdown.map((m) => m.label)).toEqual(['SOQL', 'Heap', 'DML']);
    expect(breakdown[0]).toEqual({ label: 'SOQL', used: 90, limit: 100, percent: 90 });
  });

  it('omits metrics with no usage or no known limit', () => {
    const breakdown = governorCostBreakdown(row({ soql: 5, dml: 2 }), limits({ dmlStatements: 0 }));
    // dml has usage but no limit; sosl/rows/heap have no usage.
    expect(breakdown.map((m) => m.label)).toEqual(['SOQL']);
  });
});

describe('heap uses peak-live heap, not signed net allocation', () => {
  it('never produces a negative cost from a net-negative subtree', () => {
    // A subtree that frees more than it allocates has a negative heapAllocated.total
    // but a real (≥0) peak live heap. Cost must reflect the peak, never go negative.
    const r = row({ heap: 3000000, heapNet: -5000000 });
    expect(governorCost(r, limits())).toBeCloseTo(50 / REPORTED_GOVERNORS, 5); // heap 50% / 6
    expect(governorCostMax(r, limits())).toBeCloseTo(50, 5);
  });

  it('scores 0 when peak heap is 0 regardless of net allocation', () => {
    expect(governorCost(row({ heapNet: -5000000 }), limits())).toBe(0);
    expect(governorCostMax(row({ heapNet: -5000000 }), limits())).toBe(0);
  });
});

describe('SOSL rows', () => {
  it('do not contribute to governor cost — they have no governor limit', () => {
    // SOSL rows are not governed (only SOSL queries, to 20) and do not count
    // against the SOQL query-rows limit, so a path consuming only SOSL rows
    // scores 0 across every measure.
    expect(governorCost(row({ soslRows: 50000 }), limits())).toBe(0);
    expect(governorCostMax(row({ soslRows: 50000 }), limits())).toBe(0);
    expect(governorCostBreakdown(row({ soslRows: 50000 }), limits())).toEqual([]);
  });
});
