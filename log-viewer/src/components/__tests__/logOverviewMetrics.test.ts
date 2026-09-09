/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';

import {
  GOVERNOR_METRICS,
  limitTotals,
  metricSparkline,
  seriesGauges,
} from '../logOverviewMetrics.js';
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

    expect(gauges).toMatchObject([{ label: 'SOQL', found: 70, used: 70, limit: 100 }]);
  });

  it('ranks by percentage, drops zero usage, and caps at six', () => {
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

  describe('a log that reported no limits', () => {
    const levels = [3, 5, 5, 9, 12];
    const noLimitSeries = () =>
      timeSeries(
        levels.map((used, i) =>
          seriesEvent((i + 1) * 1_000, {
            soqlQueries: { used, limit: 0 },
            dmlStatements: { used: used * 2, limit: 0 },
          }),
        ),
      );

    // Nothing to rank by, so reading order stands in rather than ordering by raw size, which
    // would read as a ranking it cannot be.
    it('keeps the metrics in reading order', () => {
      expect(seriesGauges(noLimitSeries()).map((gauge) => gauge.label)).toEqual(['SOQL', 'DML']);
    });

    it('carries a sparkline instead of a bar', () => {
      const [soql] = seriesGauges(noLimitSeries());

      expect(soql).toMatchObject({ label: 'SOQL', used: 12, limit: 0 });
      expect(soql?.spark).toEqual(levels);
    });
  });

  it('carries no sparkline where the log reported a limit', () => {
    const gauges = seriesGauges(
      timeSeries([seriesEvent(1_000, { soqlQueries: { used: 70, limit: 100 } })]),
    );

    expect(gauges[0]?.spark).toBeUndefined();
  });
});

describe('metricSparkline', () => {
  const of = (levels: number[]) =>
    timeSeries(levels.map((used, i) => seriesEvent(i + 1, { soqlQueries: { used, limit: 0 } })));

  // Four readings are dots, not a shape, so the gauge is left with its figure alone.
  it('draws nothing below five readings', () => {
    expect(metricSparkline(of([1, 2, 3, 4]), 'soqlQueries')).toEqual([]);
  });

  it('keeps every reading up to twenty', () => {
    const levels = [1, 2, 3, 4, 5, 6];
    expect(metricSparkline(of(levels), 'soqlQueries')).toEqual(levels);
  });

  // Bucket extremes, so both the spike and the dip survive the downsample.
  it('reduces a long series to twenty readings, first and last kept', () => {
    const levels = Array.from({ length: 500 }, (_, i) => (i === 250 ? 0 : i));
    const spark = metricSparkline(of(levels), 'soqlQueries');

    expect(spark).toHaveLength(20);
    expect(spark[0]).toBe(0);
    expect(spark[spark.length - 1]).toBe(499);
  });

  // An even-interval sample stepped over the one reading that spiked — the whole point of the
  // shape, and the figure printed beside it.
  it('keeps a spike that falls between the sample intervals', () => {
    const levels = Array.from({ length: 500 }, (_, i) => (i === 137 ? 9_999 : 1));

    expect(metricSparkline(of(levels), 'soqlQueries')).toContain(9_999);
  });

  it('answers the same array for the same series and metric', () => {
    const series = of([1, 2, 3, 4, 5]);
    expect(metricSparkline(series, 'soqlQueries')).toBe(metricSparkline(series, 'soqlQueries'));
  });
});
