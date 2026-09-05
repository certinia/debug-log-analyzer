/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';

import { GOVERNOR_METRICS, limitTotals, seriesGauges } from '../logOverviewMetrics.js';
import { emptyLimits, seriesEvent, timeSeries } from './limitsTestUtils.js';

describe('limitTotals', () => {
  it('reads every metric as it rises', () => {
    const totals = limitTotals(
      timeSeries([
        seriesEvent(1_000, { soqlQueries: { used: 20, limit: 100 } }),
        seriesEvent(2_000, {
          soqlQueries: { used: 186, limit: 100 },
          cpuTime: { used: 10_712, limit: 10_000 },
        }),
      ]),
    );

    expect(totals.soqlQueries).toEqual({ used: 186, limit: 100 });
    expect(totals.cpuTime).toEqual({ used: 10_712, limit: 10_000 });
  });

  it('reads every metric from its peak: a later report can be lower', () => {
    const totals = limitTotals(
      timeSeries([
        seriesEvent(1_000, {
          heapSize: { used: 5_000_000, limit: 6_000_000 },
          cpuTime: { used: 10_712, limit: 10_000 },
          soqlQueries: { used: 101, limit: 100 },
        }),
        seriesEvent(2_000, {
          heapSize: { used: 1_000_000, limit: 6_000_000 },
          cpuTime: { used: 9_991, limit: 10_000 },
          soqlQueries: { used: 67, limit: 100 },
        }),
      ]),
    );

    // The governor charged the transaction at its highest point, breach included.
    expect(totals.heapSize).toEqual({ used: 5_000_000, limit: 6_000_000 });
    expect(totals.cpuTime).toEqual({ used: 10_712, limit: 10_000 });
    expect(totals.soqlQueries).toEqual({ used: 101, limit: 100 });
  });

  it('holds every governor metric, at zero where the series has none', () => {
    const totals = limitTotals(timeSeries([]));

    expect(totals).toEqual(emptyLimits());
    expect(Object.keys(totals)).toHaveLength(GOVERNOR_METRICS.length);
  });
});

describe('seriesGauges', () => {
  it('reads each metric as it rises', () => {
    const gauges = seriesGauges(
      timeSeries([
        seriesEvent(1_000, { soqlQueries: { used: 20, limit: 100 } }),
        seriesEvent(2_000, { soqlQueries: { used: 70, limit: 100 } }),
      ]),
    );

    expect(gauges).toEqual([{ label: 'SOQL', found: 70, used: 70, limit: 100 }]);
  });

  it('ranks by percentage, drops zero usage or limit, and caps at six', () => {
    const gauges = seriesGauges(
      timeSeries([
        seriesEvent(1_000, {
          soqlQueries: { used: 10, limit: 0 },
          dmlStatements: { used: 0, limit: 150 },
          cpuTime: { used: 9_000, limit: 10_000 },
          queryRows: { used: 100, limit: 50_000 },
          dmlRows: { used: 300, limit: 10_000 },
          soslQueries: { used: 4, limit: 20 },
          callouts: { used: 5, limit: 100 },
          futureCalls: { used: 6, limit: 50 },
          emailInvocations: { used: 7, limit: 10 },
        }),
      ]),
    );

    expect(gauges).toHaveLength(6);
    expect(gauges[0]?.label).toBe('CPU Time');
    expect(gauges.map((g) => g.label)).not.toContain('SOQL');
    expect(gauges.map((g) => g.label)).not.toContain('DML');
  });

  it('reads each metric from its peak, not the last event', () => {
    const gauges = seriesGauges(
      timeSeries([
        seriesEvent(1_000, { heapSize: { used: 5_000_000, limit: 6_000_000 } }),
        seriesEvent(2_000, { heapSize: { used: 1_000_000, limit: 6_000_000 } }),
      ]),
    );

    expect(gauges[0]).toMatchObject({ label: 'Heap Size', used: 5_000_000, limit: 6_000_000 });
  });

  it('formats heap as bytes', () => {
    const gauges = seriesGauges(
      timeSeries([seriesEvent(1_000, { heapSize: { used: 5_400_000, limit: 6_000_000 } })]),
    );

    expect(gauges[0]?.format?.(5_400_000)).toBe('5.4 MB');
  });

  it('returns nothing for a series without events', () => {
    expect(seriesGauges(timeSeries([]))).toEqual([]);
  });
});
