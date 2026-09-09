/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { Limits } from 'apex-log-parser';

import { formatByteSize, formatInteger, sharePercent } from '../core/utility/Util.js';
import type { GaugeMetric } from '../features/database/components/GovernorSummary.js';
import type { HeatStripTimeSeries } from '../features/timeline/types/flamechart.types.js';

/** How many gauges the strip shows before it stops being at-a-glance. */
const MAX_GAUGES = 6;

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
 * as if it could — so every ratio is 0 and the stable sort leaves {@link GOVERNOR_METRICS} reading
 * order standing, which keeps every row in a predictable slot.
 */
export function rankedLimitMetrics(series: HeatStripTimeSeries, max: number): RankedLimitMetric[] {
  const totals = limitTotals(series);
  return GOVERNOR_METRICS.flatMap<RankedLimitMetric>(({ key, label }) => {
    const { used, limit } = totals[key];
    return used > 0 ? [{ key, label, used, limit, ratio: sharePercent(used, limit) }] : [];
  })
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, max);
}

/** Fewest points that read as a shape rather than a couple of dots. */
const MIN_SPARK_POINTS = 5;

/** Most points worth plotting across a gauge-width sparkline. */
const MAX_SPARK_POINTS = 20;

/** Memo of {@link metricSparkline}: the gauges re-render on every selection. */
const sparkCache = new WeakMap<HeatStripTimeSeries, Map<keyof Limits, readonly number[]>>();

/** Each bucket's lowest and highest reading, in the order they occurred. */
function bucketExtremes(levels: readonly number[]): readonly number[] {
  if (levels.length <= MAX_SPARK_POINTS) {
    return [...levels];
  }
  const buckets = Math.floor(MAX_SPARK_POINTS / 2);
  const spark: number[] = [];
  for (let bucket = 0; bucket < buckets; bucket++) {
    const start = Math.floor((bucket * levels.length) / buckets);
    const end = Math.floor(((bucket + 1) * levels.length) / buckets);
    let lowAt = start;
    let highAt = start;
    for (let i = start + 1; i < end; i++) {
      if (levels[i]! < levels[lowAt]!) {
        lowAt = i;
      } else if (levels[i]! > levels[highAt]!) {
        highAt = i;
      }
    }
    // Chronological, so a rise reads as a rise: whichever extreme came first goes first.
    const [first, second] = lowAt <= highAt ? [lowAt, highAt] : [highAt, lowAt];
    spark.push(levels[first]!);
    if (second !== first) {
      spark.push(levels[second]!);
    }
  }
  return spark;
}

/**
 * A metric's level over the log, oldest first, for a gauge that has no limit to fill a bar
 * against. Empty below {@link MIN_SPARK_POINTS} readings — too few to read as a shape.
 *
 * Reduced by taking each bucket's lowest and highest reading, in the order they occurred: an
 * even-interval sample would step over the one allocation that spiked, and the peak is both the
 * point of the shape and the figure printed beside it.
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

  const spark = levels.length < MIN_SPARK_POINTS ? [] : bucketExtremes(levels);
  byKey.set(key, spark);
  return spark;
}

/**
 * The whole-log gauges, capped at {@link MAX_GAUGES}. A gauge with no reported limit has no bar to
 * fill, so it carries a sparkline of its own level instead.
 */
export function seriesGauges(series: HeatStripTimeSeries): GaugeMetric[] {
  return rankedLimitMetrics(series, MAX_GAUGES).map(({ key, label, used, limit }) => ({
    label,
    found: used,
    used,
    limit,
    spark: limit > 0 ? undefined : metricSparkline(series, key),
    format: key === 'heapSize' ? formatByteSize : formatInteger,
  }));
}
