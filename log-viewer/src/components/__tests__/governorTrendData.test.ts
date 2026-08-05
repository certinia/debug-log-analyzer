/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';

import { formatByteSize } from '../../core/utility/Util.js';
import { governorTrendSeries, pointAt, type TrendPoint } from '../governorTrendData.js';
import { seriesEvent, timeSeries } from './limitsTestUtils.js';

describe('governorTrendSeries', () => {
  it('charts a sampled metric, anchored at the start of the log', () => {
    const series = governorTrendSeries(
      timeSeries([
        seriesEvent(1_000, { cpuTime: { used: 2_000, limit: 10_000 } }),
        seriesEvent(2_000, { cpuTime: { used: 9_000, limit: 10_000 } }),
      ]),
    );

    expect(series).toHaveLength(1);
    expect(series[0]).toMatchObject({
      label: 'CPU Time',
      used: 9_000,
      limit: 10_000,
      finalRatio: 90,
    });
    expect(series[0]?.points).toEqual([
      { t: 0, ratio: 0, used: 0 },
      { t: 1_000, ratio: 20, used: 2_000 },
      { t: 2_000, ratio: 90, used: 9_000 },
    ]);
  });

  it('draws from a single sample: the input series is dense, so one is enough', () => {
    const series = governorTrendSeries(
      timeSeries([seriesEvent(1_000, { soqlQueries: { used: 40, limit: 100 } })]),
    );

    expect(series).toHaveLength(1);
    expect(series[0]?.points).toEqual([
      { t: 0, ratio: 0, used: 0 },
      { t: 1_000, ratio: 40, used: 40 },
    ]);
  });

  it('leaves out a metric whose final consumption is zero', () => {
    const series = governorTrendSeries(
      timeSeries([
        seriesEvent(1_000, {
          soqlQueries: { used: 0, limit: 100 },
          dmlStatements: { used: 3, limit: 150 },
        }),
      ]),
    );

    expect(series.map((s) => s.label)).toEqual(['DML']);
  });

  it('ranks the tightest metrics first and caps the set at four', () => {
    const metric = (used: number) => ({ used, limit: 100 });
    const series = governorTrendSeries(
      timeSeries(
        [1_000, 2_000].map((t) =>
          seriesEvent(t, {
            soqlQueries: metric((t / 1_000) * 45),
            dmlStatements: metric((t / 1_000) * 35),
            queryRows: metric((t / 1_000) * 25),
            callouts: metric((t / 1_000) * 15),
            futureCalls: metric((t / 1_000) * 5),
          }),
        ),
      ),
    );

    expect(series.map((s) => s.label)).toEqual(['SOQL', 'DML', 'Query Rows', 'Callouts']);
  });

  it('formats heap as bytes and everything else as integers', () => {
    const series = governorTrendSeries(
      timeSeries(
        [1_000, 2_000].map((t) =>
          seriesEvent(t, {
            heapSize: { used: t * 1_000, limit: 6_000_000 },
            cpuTime: { used: t * 2, limit: 10_000 },
          }),
        ),
      ),
    );
    const heap = series.find((s) => s.label === 'Heap Size');
    const cpu = series.find((s) => s.label === 'CPU Time');

    expect(heap?.format).toBe(formatByteSize);
    expect(cpu?.format(4_000)).toBe('4,000');
  });

  it('memoises per input series, returning the same array for the same log', () => {
    const input = timeSeries([
      seriesEvent(1_000, { cpuTime: { used: 2_000, limit: 10_000 } }),
      seriesEvent(2_000, { cpuTime: { used: 9_000, limit: 10_000 } }),
    ]);

    expect(governorTrendSeries(input)).toBe(governorTrendSeries(input));
  });
});

describe('pointAt', () => {
  const point = (t: number, used: number): TrendPoint => ({ t, ratio: used, used });
  const points = [point(0, 0), point(1_000, 40), point(4_000, 100)];

  it('interpolates linearly between the samples around t', () => {
    expect(pointAt(points, 500)).toEqual({ t: 500, ratio: 20, used: 20 });
    expect(pointAt(points, 2_500)).toEqual({ t: 2_500, ratio: 70, used: 70 });
  });

  it('returns a sample exactly at its own time', () => {
    expect(pointAt(points, 1_000)).toEqual(points[1]);
  });

  it('holds the last level past the end and clamps before the start', () => {
    // Past the last sample only the timestamp moves — the chart's area does
    // the same, since consumption never resets inside a transaction.
    expect(pointAt(points, 9_000)).toEqual({ t: 9_000, ratio: 100, used: 100 });
    expect(pointAt(points, -50)).toEqual(points[0]);
  });

  it('returns null only for an empty series', () => {
    expect(pointAt([], 100)).toBeNull();
  });
});
