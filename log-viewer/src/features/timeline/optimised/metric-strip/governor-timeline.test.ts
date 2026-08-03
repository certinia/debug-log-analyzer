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
  ['heapSize', { id: 'heapSize', displayName: 'Heap Size', unit: 'bytes', priority: 3 }],
]);

// Authoritative fixed limits. soqlQueries → threshold 1 (per-event); queryRows → threshold 100.
// heapSize → threshold floor(6000000/500) = 12000, so heap deltas below use ≥12000 magnitudes.
const LIMITS = new Map<string, number>([
  ['soqlQueries', 100],
  ['queryRows', 50000],
  ['cpuTime', 10000],
  ['heapSize', 6000000],
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

// Heap deltas can go negative (a deallocation is a negative HEAP_ALLOCATE), and its
// cumulative "Maximum heap size" correction is often the only source (FINE logs emit
// no HEAP_ALLOCATE events).
describe('buildGovernorTimeSeries — heap reconciliation', () => {
  const heapUsed = (obs: LimitObservation[]) =>
    build(obs).events.map((e) => e.values.get('heapSize')?.used);
  const heapTracked = (obs: LimitObservation[]) =>
    build(obs).events.map((e) => e.values.get('heapSize')?.tracked);

  it('falls on a negative delta (deallocation via negative HEAP_ALLOCATE)', () => {
    const obs = [
      delta(10, 'heapSize', 100000),
      delta(20, 'heapSize', 50000),
      delta(30, 'heapSize', -40000),
    ];
    expect(heapUsed(obs)).toEqual([100000, 150000, 110000]);
    expect(heapTracked(obs)).toEqual([undefined, undefined, undefined]);
  });

  it('re-baselines to the authoritative cumulative, then keeps tracking, flagging divergence', () => {
    const obs = [
      delta(10, 'heapSize', 50000),
      absolute(20, 'heapSize', 200000), // peak > tracked 50000: snaps up, then +30000
      delta(30, 'heapSize', 30000),
    ];
    expect(heapUsed(obs)).toEqual([50000, 200000, 230000]);
    // Our lower observed count is surfaced (grey) once cumulative-anchored.
    expect(heapTracked(obs)).toEqual([undefined, 50000, 80000]);
  });

  it('steps to the cumulative with no divergence when there are no HEAP_ALLOCATE events (FINE log)', () => {
    const obs = [
      absolute(10, 'heapSize', 0),
      absolute(20, 'heapSize', 219591),
      absolute(30, 'heapSize', 219591),
    ];
    expect(heapUsed(obs)).toEqual([0, 219591, 219591]);
    expect(heapTracked(obs)).toEqual([undefined, undefined, undefined]);
  });
});
