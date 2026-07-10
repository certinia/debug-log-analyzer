/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';
import type { HeatStripMetric } from '../../types/flamechart.types.js';
import { buildGovernorTimeSeries, type LimitObservation } from './governor-timeline.js';

const METRICS = new Map<string, HeatStripMetric>([
  ['soqlQueries', { id: 'soqlQueries', displayName: 'SOQL Queries', unit: '', priority: 1 }],
  ['queryRows', { id: 'queryRows', displayName: 'Query Rows', unit: '', priority: 2 }],
  ['cpuTime', { id: 'cpuTime', displayName: 'CPU Time', unit: 'ms', priority: 0 }],
]);

// Authoritative fixed limits. soqlQueries → threshold 1 (per-event); queryRows → threshold 100.
const LIMITS = new Map<string, number>([
  ['soqlQueries', 100],
  ['queryRows', 50000],
  ['cpuTime', 10000],
]);

const delta = (
  timestamp: number,
  metric: string,
  d: number,
  namespace = 'default',
): LimitObservation => ({ kind: 'delta', timestamp, namespace, metric, delta: d });

const absolute = (
  timestamp: number,
  metric: string,
  used: number,
  namespace = 'default',
): LimitObservation => ({ kind: 'absolute', timestamp, namespace, metric, used });

const build = (observations: LimitObservation[]) =>
  buildGovernorTimeSeries(observations, METRICS, LIMITS);

describe('buildGovernorTimeSeries', () => {
  it('returns no events for no observations', () => {
    expect(build([]).events).toEqual([]);
  });

  it('accumulates deltas onto the fixed limit', () => {
    const series = build([delta(10, 'soqlQueries', 1), delta(20, 'soqlQueries', 1)]);
    expect(series.events.map((e) => e.values.get('soqlQueries')?.used)).toEqual([1, 2]);
    expect(series.events[0]?.values.get('soqlQueries')?.limit).toBe(100);
    expect(series.events.every((e) => e.values.get('soqlQueries')?.tracked === undefined)).toBe(
      true,
    );
  });

  it('does not emit a metric with no limit in the map', () => {
    const series = buildGovernorTimeSeries(
      [delta(10, 'soqlQueries', 1)],
      METRICS,
      new Map(), // no limits
    );
    expect(series.events).toEqual([]);
  });

  it('corrects up to the cumulative snapshot and records the tracked divergence', () => {
    // Tracked one query, but the snapshot reports 3 (log dropped 2 SOQL_EXECUTE_BEGIN events).
    const series = build([
      absolute(0, 'soqlQueries', 0),
      delta(10, 'soqlQueries', 1),
      absolute(20, 'soqlQueries', 3),
    ]);
    const corrected = series.events[2]?.values.get('soqlQueries');
    expect(corrected?.used).toBe(3);
    expect(corrected?.tracked).toBe(1);
  });

  it('keeps a monotonic line from dipping when an absolute comes in low (max floor)', () => {
    const series = build([
      absolute(0, 'soqlQueries', 0),
      delta(10, 'soqlQueries', 5),
      absolute(20, 'soqlQueries', 2),
    ]);
    expect(series.events[2]?.values.get('soqlQueries')?.used).toBe(5);
    expect(series.events[2]?.values.get('soqlQueries')?.tracked).toBeUndefined();
  });

  it('continues accumulating deltas after a corrective baseline', () => {
    const series = build([
      absolute(0, 'soqlQueries', 0),
      delta(10, 'soqlQueries', 1),
      absolute(20, 'soqlQueries', 3),
      delta(30, 'soqlQueries', 1),
    ]);
    expect(series.events[3]?.values.get('soqlQueries')?.used).toBe(4);
  });

  it('sums last-known values across namespaces (carry-forward)', () => {
    const series = build([
      delta(10, 'soqlQueries', 2, 'default'),
      delta(20, 'soqlQueries', 3, 'pkg'),
    ]);
    expect(series.events.at(-1)?.values.get('soqlQueries')?.used).toBe(5);
  });

  it('never surfaces tracked for an absolute-only metric (e.g. CPU)', () => {
    const series = build([absolute(0, 'cpuTime', 100), absolute(10, 'cpuTime', 500)]);
    expect(series.events.every((e) => e.values.get('cpuTime')?.tracked === undefined)).toBe(true);
    expect(series.events[1]?.values.get('cpuTime')?.used).toBe(500);
  });

  it('coalesces high-frequency deltas but preserves the running total', () => {
    // queryRows threshold = floor(50000 / 500) = 100. 250 unit deltas → far fewer than 250 points.
    const observations = Array.from({ length: 250 }, (_, i) => delta(i + 1, 'queryRows', 1));
    const series = build(observations);
    expect(series.events.length).toBeLessThan(10);
    expect(series.events.at(-1)?.values.get('queryRows')?.used).toBe(250);
  });

  it('does not coalesce count metrics (threshold 1)', () => {
    const observations = Array.from({ length: 5 }, (_, i) => delta(i + 1, 'soqlQueries', 1));
    const series = build(observations);
    expect(series.events.length).toBe(5);
  });
});
