/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { formatByteSize, formatInteger } from '../core/utility/Util.js';
import type { HeatStripTimeSeries } from '../features/timeline/types/flamechart.types.js';
import { rankedLimitMetrics } from './logOverviewMetrics.js';

/** How many trend charts to draw before the section stops being at-a-glance. */
const MAX_TRENDS = 4;

/** One sampled point of a metric's consumption. The metric's limit is fixed
 *  for the whole series by the series builder, so it lives on
 *  {@link TrendSeries}, not here. */
export interface TrendPoint {
  /** Nanoseconds since the start of the log. */
  t: number;
  /** Percentage of the limit consumed at this instant. */
  ratio: number;
  /** Raw consumption at this instant, for the hover readout. */
  used: number;
}

/** One metric's usage-over-time series, ready to chart. */
export interface TrendSeries {
  label: string;
  points: TrendPoint[];
  /** Final consumption (the peak for heap), for the value column and the tier colour. */
  used: number;
  limit: number;
  /** used/limit as a percentage — the series' rank. */
  finalRatio: number;
  format: (value: number) => string;
}

/** Memo of {@link governorTrendSeries}: the charts re-render on every hover,
 *  but the input series is built once per log, and the stable output identity
 *  also feeds the component's per-series geometry memo. */
const seriesCache = new WeakMap<HeatStripTimeSeries, TrendSeries[]>();

/**
 * Usage-over-time series for the governor metrics closest to their limits,
 * tightest first, capped at {@link MAX_TRENDS} — the same ranking the Log
 * overview's gauges use (see `rankedLimitMetrics`), so the charts and the
 * gauges always pick and order metrics identically. Points are then sampled
 * only for the metrics that made the cut.
 *
 * The input is the metric strip's own time series (see `apexLimitTimeSeries`),
 * so the charts and the strip always show the same figures. The series is
 * dense — every emitted timestamp carries every known metric — so a single
 * observation is enough to draw. A leading zero point anchors every series at
 * the start of the log. A metric whose final consumption is zero is left out:
 * a flat line at zero says nothing the gauges do not.
 */
export function governorTrendSeries(series: HeatStripTimeSeries): TrendSeries[] {
  const cached = seriesCache.get(series);
  if (cached) {
    return cached;
  }

  const ranked = rankedLimitMetrics(series, MAX_TRENDS).map<TrendSeries>(
    ({ key, label, used, limit, ratio }) => ({
      label,
      // A zero point anchors the series at the start of the log.
      points: [
        { t: 0, ratio: 0, used: 0 },
        ...series.events.flatMap<TrendPoint>((event) => {
          const value = event.values.get(key);
          return value
            ? [{ t: event.timestamp, ratio: (value.used / value.limit) * 100, used: value.used }]
            : [];
        }),
      ],
      used,
      limit,
      finalRatio: ratio,
      format: key === 'heapSize' ? formatByteSize : formatInteger,
    }),
  );
  seriesCache.set(series, ranked);
  return ranked;
}

/**
 * The series' value at time `t`, linearly interpolated between the samples
 * around it — a moving readout that follows the drawn line exactly. Past the
 * last sample the level holds and only the timestamp moves, matching the
 * chart's area (consumption never resets inside a transaction). Points must
 * be ascending by `t`, which {@link governorTrendSeries} guarantees. Returns
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
  // Binary search for the first sample at or after t: this runs on every
  // pointer move, and a dense series holds thousands of points.
  let lo = 1;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid]!.t < t) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  const next = points[lo]!; // search hit: first.t < t <= last.t
  const prev = points[lo - 1]!; // lo >= 1: t > first.t
  const span = next.t - prev.t;
  const fraction = span > 0 ? (t - prev.t) / span : 1;
  return {
    t,
    ratio: prev.ratio + fraction * (next.ratio - prev.ratio),
    used: prev.used + fraction * (next.used - prev.used),
  };
}
