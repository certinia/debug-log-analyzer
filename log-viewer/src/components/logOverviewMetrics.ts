/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { Limits } from 'apex-log-parser';

import { formatByteSize } from '../core/utility/Util.js';
import type { GaugeMetric } from '../features/database/components/GovernorSummary.js';
import type { HeatStripTimeSeries } from '../features/timeline/types/flamechart.types.js';

/** How many gauges the strip shows before it stops being at-a-glance. */
const MAX_GAUGES = 6;

/**
 * Shown where the log records no governor usage at all, so there is nothing to read. Shared by
 * `LogOverview`, `GovernorTrends` and `DatabaseRowBudget` so they give the same reason.
 */
export const NO_GOVERNOR_USAGE_TEXT = 'This log records no governor usage.';

/**
 * Shown where figures exist but the log reported no limits to measure them against. Deliberately
 * silent on how to get them: a debug level is no guarantee, and complete logs at Apex Profiling
 * FINE and INFO alike carry no limit block.
 */
export const NO_REPORTED_LIMITS_TEXT =
  'This log reports no governor limits, so each figure is a level, not a share of one.';

/**
 * Every governor-tracked metric, with the label the inspector shows for it. A
 * local list rather than the timeline adapter's `APEX_METRICS`, which is
 * internal to that feature. The gauges and the governor trend charts read it
 * through {@link rankedLimitMetrics}, and the log diagnostics read it
 * directly, so every surface names the same metrics the same way.
 */
export const GOVERNOR_METRICS: ReadonlyArray<{ key: keyof Limits; label: string }> = [
  { key: 'cpuTime', label: 'CPU Time' },
  { key: 'heapSize', label: 'Heap Size' },
  { key: 'soqlQueries', label: 'SOQL' },
  { key: 'queryRows', label: 'Query Rows' },
  { key: 'dmlStatements', label: 'DML' },
  { key: 'dmlRows', label: 'DML Rows' },
  { key: 'soslQueries', label: 'SOSL' },
  { key: 'publishImmediateDml', label: 'Publish Immediate DML' },
  { key: 'callouts', label: 'Callouts' },
  { key: 'emailInvocations', label: 'Email Invocations' },
  { key: 'futureCalls', label: 'Future Calls' },
  { key: 'queueableJobsAddedToQueue', label: 'Queueable Jobs' },
  { key: 'mobileApexPushCalls', label: 'Mobile Push Calls' },
];

/** A metric's highest level across the series. */
function peakUsed(series: HeatStripTimeSeries, key: keyof Limits): number {
  let peak = 0;
  for (const event of series.events) {
    const used = event.values.get(key)?.used ?? 0;
    if (used > peak) {
      peak = used;
    }
  }
  return peak;
}

/** A governor metric's peak level, ranked against its limit. */
export interface RankedLimitMetric {
  key: keyof Limits;
  label: string;
  used: number;
  limit: number;
  /** used/limit as a percentage — the metric's rank. */
  ratio: number;
}

/** Memo of {@link limitTotals} per series: every surface asks for the same log. */
const totalsCache = new WeakMap<HeatStripTimeSeries, Limits>();

/**
 * Whole-log usage and limit for every governor metric, read from the metric
 * strip's time series — the one source every governor surface shares, so a
 * metric reads the same on the strip, the trend charts, the gauges, the
 * Database overview and the Analysis findings.
 *
 * Every metric reads its **peak** across the series, not its final level. No
 * metric is monotonic: heap falls on a deallocation, and the log's own
 * cumulative reports can fall too (a later block reporting a lower total than
 * an earlier one). A governor charges the transaction at its highest point, so
 * the peak is what breached and what the reader must be told. The metric strip
 * keeps drawing the series itself, dips included — it shows what the log says
 * happened.
 *
 * These are whole-transaction totals: the series sums usage across
 * namespaces, so in a namespaced org a metric can pass 100% of a single
 * namespace's limit without a breach (#862) — accepted so every surface
 * matches the charts and the strip.
 */
export function limitTotals(series: HeatStripTimeSeries): Limits {
  let totals = totalsCache.get(series);
  if (totals) {
    return totals;
  }
  const final = series.events[series.events.length - 1]?.values;
  totals = {} as Limits;
  for (const { key } of GOVERNOR_METRICS) {
    totals[key] = {
      used: peakUsed(series, key),
      limit: final?.get(key)?.limit ?? 0,
    };
  }
  totalsCache.set(series, totals);
  return totals;
}

/**
 * The governor metrics worth showing, capped at `max`, from {@link limitTotals}. A metric with no
 * consumption is left out.
 *
 * Tightest first where the log reported limits. Where it reported none there is nothing to rank by
 * — an absolute count cannot say which metric is nearest breaking, and ordering by size would read
 * as if it could — so {@link GOVERNOR_METRICS} reading order stands in and every row keeps a
 * predictable slot.
 */
export function rankedLimitMetrics(series: HeatStripTimeSeries, max: number): RankedLimitMetric[] {
  const totals = limitTotals(series);
  const consumed = GOVERNOR_METRICS.flatMap<RankedLimitMetric>(({ key, label }) => {
    const { used, limit } = totals[key];
    return used > 0
      ? [{ key, label, used, limit, ratio: limit > 0 ? (used / limit) * 100 : 0 }]
      : [];
  });
  const ranked = consumed.some((metric) => metric.limit > 0)
    ? consumed.sort((a, b) => b.ratio - a.ratio)
    : consumed;
  return ranked.slice(0, max);
}

/** Fewest points that read as a shape rather than a couple of dots. */
const MIN_SPARK_POINTS = 5;

/** Most points worth plotting across a gauge-width sparkline. */
const MAX_SPARK_POINTS = 20;

/** Memo of {@link metricSparkline}: the gauges re-render on every selection. */
const sparkCache = new WeakMap<HeatStripTimeSeries, Map<keyof Limits, readonly number[]>>();

/**
 * A metric's level over the log, oldest first, for a gauge that has no limit to fill a bar
 * against. Sampled at even intervals rather than reduced to peaks, so a dip stays visible. Empty
 * below {@link MIN_SPARK_POINTS} readings — too few to read as a shape.
 */
export function metricSparkline(series: HeatStripTimeSeries, key: keyof Limits): readonly number[] {
  let byKey = sparkCache.get(series);
  if (!byKey) {
    byKey = new Map();
    sparkCache.set(series, byKey);
  }
  const cached = byKey.get(key);
  if (cached) {
    return cached;
  }

  const levels: number[] = [];
  for (const event of series.events) {
    const value = event.values.get(key);
    if (value) {
      levels.push(value.used);
    }
  }

  let spark: readonly number[] = [];
  if (levels.length >= MIN_SPARK_POINTS) {
    spark =
      levels.length <= MAX_SPARK_POINTS
        ? levels
        : Array.from(
            { length: MAX_SPARK_POINTS },
            (_, i) => levels[Math.round((i * (levels.length - 1)) / (MAX_SPARK_POINTS - 1))]!,
          );
  }
  byKey.set(key, spark);
  return spark;
}

/**
 * The whole-log gauges, capped at {@link MAX_GAUGES}. A gauge with no reported limit has no bar to
 * fill, so it carries a sparkline of its own level instead and the caller shows
 * {@link NO_REPORTED_LIMITS_TEXT} alongside.
 */
export function seriesGauges(series: HeatStripTimeSeries): GaugeMetric[] {
  return rankedLimitMetrics(series, MAX_GAUGES).map(({ key, label, used, limit }) => ({
    label,
    found: used,
    used,
    limit,
    ...(limit > 0 ? {} : { spark: metricSparkline(series, key) }),
    ...(key === 'heapSize' ? { format: formatByteSize } : {}),
  }));
}

/** Whether the log reported a limit for any metric it recorded usage for. */
export function hasReportedLimits(series: HeatStripTimeSeries): boolean {
  const totals = limitTotals(series);
  return GOVERNOR_METRICS.some(({ key }) => totals[key].limit > 0);
}
