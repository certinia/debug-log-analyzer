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
 * Why governor figures are missing, and the likely fix. Shared by every
 * surface that needs the cumulative snapshots (`LogOverview`,
 * `GovernorTrends`) so they all give the same reason. The parser samples the
 * snapshots from CUMULATIVE_LIMIT_USAGE events, which the Apex Profiling
 * debug category emits at INFO and above — though some INFO logs still lack
 * them, so the copy hedges.
 */
export const NO_CUMULATIVE_LIMITS_TEXT =
  'This log has no CUMULATIVE_LIMIT_USAGE events, so governor totals are unknown. This can happen when the Apex Profiling debug level is below INFO.';

/** Short caveat under figures that were estimated without cumulative snapshots. */
export const ESTIMATED_LIMITS_TEXT =
  'No CUMULATIVE_LIMIT_USAGE events in the log; figures are estimated from logged events. An Apex Profiling debug level of INFO or higher usually includes them.';

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
 * The governor metrics closest to a limit, tightest first, capped at `max`,
 * from {@link limitTotals}. A metric with no consumption, or no limit, is left
 * out.
 */
export function rankedLimitMetrics(series: HeatStripTimeSeries, max: number): RankedLimitMetric[] {
  const totals = limitTotals(series);
  return GOVERNOR_METRICS.flatMap<RankedLimitMetric>(({ key, label }) => {
    const { used, limit } = totals[key];
    return limit > 0 && used > 0 ? [{ key, label, used, limit, ratio: (used / limit) * 100 }] : [];
  })
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, max);
}

/**
 * The whole-log gauges closest to a limit, capped at {@link MAX_GAUGES}.
 * Without cumulative snapshots the totals are estimates, and the caller shows
 * {@link ESTIMATED_LIMITS_TEXT} alongside them.
 */
export function seriesGauges(series: HeatStripTimeSeries): GaugeMetric[] {
  return rankedLimitMetrics(series, MAX_GAUGES).map(({ key, label, used, limit }) => ({
    label,
    found: used,
    used,
    limit,
    ...(key === 'heapSize' ? { format: formatByteSize } : {}),
  }));
}
