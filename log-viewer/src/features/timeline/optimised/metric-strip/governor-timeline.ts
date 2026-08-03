/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * governor-timeline
 *
 * Pure fold that turns a stream of granular governor-limit observations into a dense
 * time series for the metric strip. Boundary-safe: no parser imports.
 *
 * Model (per namespace, per metric):
 * - `tracked`  — running total of counted deltas. Counters only increment; heap deltas may go
 *   negative (a deallocation is a negative HEAP_ALLOCATE), so the heap line can fall.
 * - `displayed` = baseline + (tracked − trackedAtBaseline), the value drawn on the line.
 *
 * Two observation kinds:
 * - `delta`    — adds to `tracked` (and therefore to `displayed`); marks the metric delta-tracked.
 * - `absolute` — corrective. Sets the baseline to `max(reported, displayed)`. The `max` floor keeps
 *   monotonic counters from dipping when a subset-scoped report or fluctuating heap comes in low.
 *   For heap, `reported` is the authoritative cumulative "Maximum heap size" (a peak, often our only
 *   source since FINE logs emit no HEAP_ALLOCATE events).
 *
 * At each observation timestamp a single combined point is emitted, summing the last-known
 * per-namespace values (carry-forward step merge). `tracked` is surfaced on the emitted value only
 * for delta-tracked metrics and only when it diverges below `used` (the log dropped events the
 * cumulative snapshot still counted).
 */

import type {
  HeatStripEvent,
  HeatStripMetric,
  HeatStripMetricValue,
  HeatStripTimeSeries,
} from '../../types/flamechart.types.js';

/** A granular +delta contribution to a metric (e.g. one SOQL query, N heap bytes). */
export interface LimitDeltaObservation {
  kind: 'delta';
  timestamp: number;
  namespace: string;
  metric: string;
  delta: number;
}

/** A cumulative "used" report that corrects the running total. Limit is resolved separately. */
export interface LimitAbsoluteObservation {
  kind: 'absolute';
  timestamp: number;
  namespace: string;
  metric: string;
  used: number;
}

export type LimitObservation = LimitDeltaObservation | LimitAbsoluteObservation;

interface MetricState {
  /** Increment-only running total (sum of all deltas). */
  tracked: number;
  /** Value of `displayed` at the last corrective observation. */
  baseline: number;
  /** `tracked` at the last corrective observation. */
  trackedAtBaseline: number;
  /** Whether this metric ever received a delta observation. */
  sawDelta: boolean;
}

const displayedOf = (s: MetricState): number => s.baseline + (s.tracked - s.trackedAtBaseline);

/** Target max emitted points per metric per namespace (drives the delta-coalescing threshold). */
const POINT_BUDGET = 500;

/**
 * Stable sort by timestamp on a shallow copy. Array.prototype.sort is stable (ES2019+), so equal
 * timestamps keep input order without an index-decoration pass.
 */
function sortByTime(observations: LimitObservation[]): LimitObservation[] {
  return observations.slice().sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Coalesce consecutive same-`(namespace, metric)` deltas: accumulate and emit a single delta only
 * once `|pending| ≥ max(1, floor(limit / POINT_BUDGET))`, on the triggering event's timestamp.
 * Pending deltas are flushed before any absolute for the same key (so the correction sees them) and
 * at end of stream. Counts (small limits → threshold 1) stay per-event; rows/heap coalesce. Absolutes
 * pass through untouched. Input must be time-sorted; output is re-sorted (the flush order can differ).
 */
function coalesceDeltas(
  sorted: LimitObservation[],
  limits: Map<string, number>,
): LimitObservation[] {
  const out: LimitObservation[] = [];
  // namespace -> metric -> accumulated delta + latest timestamp
  const pending = new Map<string, Map<string, { sum: number; ts: number }>>();

  const flush = (namespace: string, metric: string): void => {
    const p = pending.get(namespace)?.get(metric);
    if (p) {
      pending.get(namespace)!.delete(metric);
      if (p.sum !== 0) {
        out.push({ kind: 'delta', timestamp: p.ts, namespace, metric, delta: p.sum });
      }
    }
  };

  for (const obs of sorted) {
    if (obs.kind === 'delta') {
      const threshold = Math.max(1, Math.floor((limits.get(obs.metric) ?? 0) / POINT_BUDGET));
      let byMetric = pending.get(obs.namespace);
      if (!byMetric) {
        byMetric = new Map();
        pending.set(obs.namespace, byMetric);
      }
      let p = byMetric.get(obs.metric);
      if (!p) {
        p = { sum: 0, ts: obs.timestamp };
        byMetric.set(obs.metric, p);
      }
      p.sum += obs.delta;
      p.ts = obs.timestamp;
      if (Math.abs(p.sum) >= threshold) {
        flush(obs.namespace, obs.metric);
      }
    } else {
      flush(obs.namespace, obs.metric);
      out.push(obs);
    }
  }
  for (const [namespace, byMetric] of pending) {
    for (const metric of [...byMetric.keys()]) {
      flush(namespace, metric);
    }
  }

  return sortByTime(out);
}

/**
 * Fold granular observations into a dense combined-namespace time series.
 *
 * @param observations - Delta and absolute observations, any order.
 * @param metrics - Metric definitions to attach to the series.
 * @param limits - Authoritative, fixed per-metric limit (the "out of" total). Resolved once by the
 *   caller (max cumulative-snapshot limit, else default) so the total never changes across the
 *   series. A metric is emitted only once it has a limit here (> 0) and at least one observation.
 */
export function buildGovernorTimeSeries(
  observations: LimitObservation[],
  metrics: Map<string, HeatStripMetric>,
  limits: Map<string, number>,
): HeatStripTimeSeries {
  if (observations.length === 0) {
    return { metrics, events: [] };
  }

  // Stable sort by timestamp, then coalesce high-frequency deltas so one point isn't emitted per
  // heap allocation on huge logs (bounds points to ~POINT_BUDGET per metric per namespace).
  const sorted = coalesceDeltas(sortByTime(observations), limits);

  // namespace -> metric -> state
  const state = new Map<string, Map<string, MetricState>>();
  const getState = (ns: string, metric: string): MetricState => {
    let byMetric = state.get(ns);
    if (!byMetric) {
      byMetric = new Map();
      state.set(ns, byMetric);
    }
    let s = byMetric.get(metric);
    if (!s) {
      s = { tracked: 0, baseline: 0, trackedAtBaseline: 0, sawDelta: false };
      byMetric.set(metric, s);
    }
    return s;
  };

  const events: HeatStripEvent[] = [];
  let idx = 0;
  while (idx < sorted.length) {
    const timestamp = sorted[idx]!.timestamp;
    // Apply every observation sharing this timestamp before emitting a point.
    while (idx < sorted.length && sorted[idx]!.timestamp === timestamp) {
      const obs = sorted[idx]!;
      const s = getState(obs.namespace, obs.metric);
      if (obs.kind === 'delta') {
        s.tracked += obs.delta;
        s.sawDelta = true;
      } else {
        s.baseline = Math.max(obs.used, displayedOf(s));
        s.trackedAtBaseline = s.tracked;
      }
      idx++;
    }
    const point = emitPoint(timestamp, state, limits);
    if (point.values.size > 0) {
      events.push(point);
    }
  }

  return { metrics, events };
}

/** Emit one combined point: sum last-known per-namespace values for every metric with a known limit. */
function emitPoint(
  timestamp: number,
  state: Map<string, Map<string, MetricState>>,
  limits: Map<string, number>,
): HeatStripEvent {
  const agg = new Map<string, { used: number; trackedSum: number; anyDelta: boolean }>();

  for (const byMetric of state.values()) {
    for (const [metric, s] of byMetric) {
      const disp = displayedOf(s);
      let a = agg.get(metric);
      if (!a) {
        a = { used: 0, trackedSum: 0, anyDelta: false };
        agg.set(metric, a);
      }
      a.used += disp;
      // Namespaces without a granular source contribute their displayed value so they
      // don't manufacture a divergence for the combined metric.
      a.trackedSum += s.sawDelta ? s.tracked : disp;
      a.anyDelta = a.anyDelta || s.sawDelta;
    }
  }

  const values = new Map<string, HeatStripMetricValue>();
  for (const [metric, a] of agg) {
    const limit = limits.get(metric) ?? 0;
    if (limit <= 0) {
      continue;
    }
    const value: HeatStripMetricValue = { used: a.used, limit };
    if (a.anyDelta && a.trackedSum < a.used) {
      value.tracked = a.trackedSum;
    }
    values.set(metric, value);
  }

  return { timestamp, namespace: 'combined', values };
}
