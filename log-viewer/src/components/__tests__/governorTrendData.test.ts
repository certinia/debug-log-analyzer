/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';
import type { GovernorLimits, GovernorSnapshot, Limits } from 'apex-log-parser';

import { formatByteSize } from '../../core/utility/Util.js';
import { governorTrendSeries, pointAt, type TrendPoint } from '../governorTrendData.js';
import { emptyLimits } from './limitsTestUtils.js';

const withMetrics = (metrics: Partial<Limits>): Limits => ({ ...emptyLimits(), ...metrics });

const snapshot = (
  timestamp: number,
  namespace: string,
  metrics: Partial<Limits>,
): GovernorSnapshot => ({ timestamp, namespace, limits: withMetrics(metrics) });

const governorLimits = (
  byNamespace: Record<string, Partial<Limits>>,
  snapshots: GovernorSnapshot[],
): GovernorLimits => ({
  ...emptyLimits(),
  byNamespace: new Map(
    Object.entries(byNamespace).map(([ns, metrics]) => [ns, withMetrics(metrics)]),
  ),
  snapshots,
});

describe('governorTrendSeries', () => {
  it('charts a metric with two or more snapshots, anchored at the start of the log', () => {
    const limits = governorLimits({ default: { cpuTime: { used: 9_000, limit: 10_000 } } }, [
      snapshot(1_000, 'default', { cpuTime: { used: 2_000, limit: 10_000 } }),
      snapshot(2_000, 'default', { cpuTime: { used: 9_000, limit: 10_000 } }),
    ]);

    const series = governorTrendSeries(limits);

    expect(series).toHaveLength(1);
    expect(series[0]).toMatchObject({
      label: 'CPU Time',
      used: 9_000,
      limit: 10_000,
      finalRatio: 90,
    });
    expect(series[0]?.points).toEqual([
      // The anchor consumed nothing yet, so it borrows the first sample's limit.
      { t: 0, ratio: 0, used: 0, limit: 10_000 },
      { t: 1_000, ratio: 20, used: 2_000, limit: 10_000 },
      { t: 2_000, ratio: 90, used: 9_000, limit: 10_000 },
    ]);
  });

  it("computes each point against its own snapshot's limit, never a fixed one", () => {
    const limits = governorLimits({ default: { cpuTime: { used: 30_000, limit: 60_000 } } }, [
      snapshot(1_000, 'default', { cpuTime: { used: 5_000, limit: 10_000 } }),
      snapshot(2_000, 'default', { cpuTime: { used: 30_000, limit: 60_000 } }),
    ]);

    const [series] = governorTrendSeries(limits);

    expect(series?.points.map((p) => p.ratio)).toEqual([0, 50, 50]);
  });

  it('leaves out a metric with fewer than two snapshots', () => {
    const limits = governorLimits({ default: { soqlQueries: { used: 40, limit: 100 } } }, [
      snapshot(1_000, 'default', { soqlQueries: { used: 40, limit: 100 } }),
    ]);

    expect(governorTrendSeries(limits)).toEqual([]);
  });

  it('picks the tightest namespace per metric and names a non-default one', () => {
    const limits = governorLimits(
      {
        default: { soqlQueries: { used: 10, limit: 100 } },
        certinia: { soqlQueries: { used: 90, limit: 100 } },
      },
      [
        snapshot(1_000, 'default', { soqlQueries: { used: 5, limit: 100 } }),
        snapshot(2_000, 'default', { soqlQueries: { used: 10, limit: 100 } }),
        snapshot(1_500, 'certinia', { soqlQueries: { used: 40, limit: 100 } }),
        snapshot(2_500, 'certinia', { soqlQueries: { used: 90, limit: 100 } }),
      ],
    );

    const series = governorTrendSeries(limits);

    expect(series).toHaveLength(1);
    expect(series[0]?.label).toBe('SOQL (certinia)');
    expect(series[0]?.points).toEqual([
      { t: 0, ratio: 0, used: 0, limit: 100 },
      { t: 1_500, ratio: 40, used: 40, limit: 100 },
      { t: 2_500, ratio: 90, used: 90, limit: 100 },
    ]);
  });

  it('ranks the tightest metrics first and caps the set at four', () => {
    const metric = (used: number) => ({ used, limit: 100 });
    const limits = governorLimits(
      {
        default: {
          soqlQueries: metric(90),
          dmlStatements: metric(70),
          queryRows: metric(50),
          callouts: metric(30),
          futureCalls: metric(10),
        },
      },
      [1_000, 2_000].map((t) =>
        snapshot(t, 'default', {
          soqlQueries: metric((t / 1_000) * 45),
          dmlStatements: metric((t / 1_000) * 35),
          queryRows: metric((t / 1_000) * 25),
          callouts: metric((t / 1_000) * 15),
          futureCalls: metric((t / 1_000) * 5),
        }),
      ),
    );

    const labels = governorTrendSeries(limits).map((s) => s.label);

    expect(labels).toEqual(['SOQL', 'DML', 'Query Rows', 'Callouts']);
  });

  it('formats heap as bytes and everything else as integers', () => {
    const limits = governorLimits(
      {
        default: {
          heapSize: { used: 3_000_000, limit: 6_000_000 },
          cpuTime: { used: 4_000, limit: 10_000 },
        },
      },
      [1_000, 2_000].map((t) =>
        snapshot(t, 'default', {
          heapSize: { used: t * 1_000, limit: 6_000_000 },
          cpuTime: { used: t * 2, limit: 10_000 },
        }),
      ),
    );

    const series = governorTrendSeries(limits);
    const heap = series.find((s) => s.label === 'Heap Size');
    const cpu = series.find((s) => s.label === 'CPU Time');

    expect(heap?.format).toBe(formatByteSize);
    expect(cpu?.format(4_000)).toBe('4,000');
  });
});

describe('pointAt', () => {
  const point = (t: number, used: number): TrendPoint => ({ t, ratio: used, used, limit: 100 });
  const points = [point(0, 0), point(1_000, 40), point(4_000, 100)];

  it('interpolates linearly between the samples around t', () => {
    expect(pointAt(points, 500)).toEqual({ t: 500, ratio: 20, used: 20, limit: 100 });
    expect(pointAt(points, 2_500)).toEqual({ t: 2_500, ratio: 70, used: 70, limit: 100 });
  });

  it('returns a sample exactly at its own time', () => {
    expect(pointAt(points, 1_000)).toEqual(points[1]);
  });

  it('holds the last level past the end and clamps before the start', () => {
    // Past the last sample only the timestamp moves — the chart's area does
    // the same, since consumption never resets inside a transaction.
    expect(pointAt(points, 9_000)).toEqual({ t: 9_000, ratio: 100, used: 100, limit: 100 });
    expect(pointAt(points, -50)).toEqual(points[0]);
  });

  it('returns null only for an empty series', () => {
    expect(pointAt([], 100)).toBeNull();
  });
});
