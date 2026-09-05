/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';

import type { WindowCounts } from '../../core/log/windowStats.js';
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

describe('seriesGauges for a window', () => {
  const none = {
    soqlCount: 0,
    soqlRowCount: 0,
    dmlCount: 0,
    dmlRowCount: 0,
    soslCount: 0,
  };

  /** The log reports these statements one by one, so they are windowable. */
  const reported = { ...none, soqlCount: 9, dmlCount: 4 };
  const windowOf = (counts: WindowCounts, logCounts: WindowCounts = reported) => ({
    counts,
    logCounts,
  });

  const series = () =>
    timeSeries([
      seriesEvent(1_000, {
        cpuTime: { used: 15_163, limit: 10_000 },
        soqlQueries: { used: 9, limit: 100 },
        dmlStatements: { used: 4, limit: 150 },
        heapSize: { used: 219_591, limit: 6_000_000 },
      }),
    ]);

  // Rows must not appear, vanish or reorder as the viewport moves.
  it('shows the same metrics in the same order as the whole log', () => {
    const whole = seriesGauges(series()).map((gauge) => gauge.label);

    expect(seriesGauges(series(), windowOf(none)).map((gauge) => gauge.label)).toEqual(whole);
  });

  it('reads a metric the window did not use as zero, not as missing', () => {
    const gauges = seriesGauges(series(), windowOf(none));

    expect(gauges.find((gauge) => gauge.label === 'SOQL')).toMatchObject({
      used: 0,
      found: 0,
      limit: 100,
    });
  });

  it('reads what the window ran', () => {
    const gauges = seriesGauges(series(), windowOf({ ...none, soqlCount: 6, dmlCount: 2 }));

    expect(gauges.find((gauge) => gauge.label === 'SOQL')).toMatchObject({ used: 6, limit: 100 });
    expect(gauges.find((gauge) => gauge.label === 'DML')).toMatchObject({ used: 2, limit: 150 });
  });

  // Both are cumulative readings the log reports only in total.
  it('keeps CPU time and heap whole-log, and says so', () => {
    const gauges = seriesGauges(series(), windowOf(none));

    expect(gauges.find((gauge) => gauge.label === 'CPU Time')).toMatchObject({
      used: 15_163,
      limit: 10_000,
      wholeLog: true,
    });
    expect(gauges.find((gauge) => gauge.label === 'Heap Size')).toMatchObject({ wholeLog: true });
    expect(gauges.find((gauge) => gauge.label === 'SOQL')?.wholeLog).toBeUndefined();
  });

  // The whole-log figure then came from the cumulative block, which no window
  // can cut. Reading 0 would say no statements ran.
  it('keeps a counter the log never reported one by one whole-log', () => {
    const gauges = seriesGauges(series(), windowOf(none, none));

    expect(gauges.find((gauge) => gauge.label === 'SOQL')).toMatchObject({
      used: 9,
      limit: 100,
      wholeLog: true,
    });
  });
});
