/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { GovernorLimits } from 'apex-log-parser';

import { DEFAULT_NAMESPACE } from '../core/utility/CallerNamespace.js';
import { formatByteSize } from '../core/utility/Util.js';
import { GOVERNOR_METRICS } from './logOverviewMetrics.js';

/** How many trend charts to draw before the section stops being at-a-glance. */
const MAX_TRENDS = 4;

/** One sampled point of a metric's consumption. */
export interface TrendPoint {
  /** Nanoseconds since the start of the log. */
  t: number;
  /** Percentage of the limit consumed at this instant. */
  ratio: number;
  /** Raw consumption at this instant, for the hover readout. */
  used: number;
  /** The limit recorded in this point's own snapshot. */
  limit: number;
}

/** One metric's usage-over-time series, ready to chart. */
export interface TrendSeries {
  label: string;
  points: TrendPoint[];
  /** Final consumption, for the value column and the tier colour. */
  used: number;
  limit: number;
  /** Final used/limit as a percentage — the series' rank. */
  finalRatio: number;
  format: (value: number) => string;
}

const integer = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

/**
 * Usage-over-time series for the governor metrics closest to their limits,
 * tightest first, capped at {@link MAX_TRENDS}.
 *
 * For each metric the tightest namespace is chosen by its final used/limit
 * ratio — per namespace, never a sum over namespaces (#862) — and that
 * namespace's snapshots become the points. Each point's percentage uses the
 * limit recorded in its own snapshot, never a hardcoded one: limits differ
 * between synchronous and asynchronous transactions. A leading zero point
 * anchors every series at the start of the log.
 *
 * A metric needs at least two snapshots to show a trend; with fewer, it is
 * left out (the gauges above already show its final value).
 */
export function governorTrendSeries(limits: GovernorLimits): TrendSeries[] {
  const series = GOVERNOR_METRICS.flatMap<TrendSeries>(({ key, label }) => {
    let tightestNamespace: string | null = null;
    let tightestRatio = 0;
    for (const [namespace, forNamespace] of limits.byNamespace) {
      const metric = forNamespace[key];
      if (metric.limit <= 0 || metric.used <= 0) {
        continue;
      }
      const ratio = metric.used / metric.limit;
      if (tightestNamespace === null || ratio > tightestRatio) {
        tightestNamespace = namespace;
        tightestRatio = ratio;
      }
    }
    if (tightestNamespace === null) {
      return [];
    }

    const sampled: TrendPoint[] = [];
    for (const snapshot of limits.snapshots) {
      if (snapshot.namespace !== tightestNamespace) {
        continue;
      }
      const metric = snapshot.limits[key];
      if (metric.limit <= 0) {
        continue;
      }
      sampled.push({
        t: snapshot.timestamp,
        ratio: (metric.used / metric.limit) * 100,
        used: metric.used,
        limit: metric.limit,
      });
    }
    const firstSample = sampled[0];
    if (!firstSample || sampled.length < 2) {
      // Fewer than two real snapshots — a single sample is a gauge, not a trend.
      return [];
    }
    // A zero point anchors the series at the start of the log; nothing was
    // consumed yet, so it borrows the first sample's limit.
    const points: TrendPoint[] = [
      { t: 0, ratio: 0, used: 0, limit: firstSample.limit },
      ...sampled,
    ];

    const final = limits.byNamespace.get(tightestNamespace)?.[key];
    if (!final) {
      return [];
    }
    return [
      {
        label: tightestNamespace === DEFAULT_NAMESPACE ? label : `${label} (${tightestNamespace})`,
        points,
        used: final.used,
        limit: final.limit,
        finalRatio: tightestRatio * 100,
        format: key === 'heapSize' ? formatByteSize : integer.format,
      },
    ];
  });

  return series.sort((a, b) => b.finalRatio - a.finalRatio).slice(0, MAX_TRENDS);
}

/**
 * The series' value at time `t`, linearly interpolated between the samples
 * around it — a moving readout that follows the drawn line exactly. Past the
 * last sample the level holds and only the timestamp moves, matching the
 * chart's area (consumption never resets inside a transaction). Each
 * interpolated point reports its segment's ending limit. Points must be
 * ascending by `t`, which {@link governorTrendSeries} guarantees. Returns
 * `null` only for an empty series.
 */
export function pointAt(points: TrendPoint[], t: number): TrendPoint | null {
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) {
    return null;
  }
  if (t <= first.t) {
    return first;
  }
  if (t >= last.t) {
    return { ...last, t };
  }
  let prev = first;
  for (const point of points) {
    if (t <= point.t) {
      const span = point.t - prev.t;
      const fraction = span > 0 ? (t - prev.t) / span : 1;
      return {
        t,
        ratio: prev.ratio + fraction * (point.ratio - prev.ratio),
        used: prev.used + fraction * (point.used - prev.used),
        limit: point.limit,
      };
    }
    prev = point;
  }
  return last;
}
