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
 * Every governor-tracked metric, with the label its gauge shows. A local list
 * rather than the timeline adapter's `APEX_METRICS`, which is internal to that
 * feature. The gauges and the governor trend charts both read it through
 * {@link rankedLimitMetrics}, so both surfaces name the same metrics the same
 * way.
 */
const GOVERNOR_METRICS: ReadonlyArray<{ key: keyof Limits; label: string }> = [
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

/** A metric's highest level across the series, for the non-monotonic metrics. */
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

/** A governor metric's level (final, or the peak for heap), ranked against its limit. */
export interface RankedLimitMetric {
  key: keyof Limits;
  label: string;
  used: number;
  limit: number;
  /** used/limit as a percentage — the metric's rank. */
  ratio: number;
}

/**
 * The governor metrics closest to a limit, tightest first, capped at `max`,
 * read from the metric strip's time series — the same source the timeline and
 * the trend charts draw, so every surface shows one figure per metric. The
 * series is dense (every event carries every known metric forward), so the
 * last event holds each metric's final level. Heap is the one non-monotonic
 * metric — deallocations pull the line back down — so it reads its peak across
 * the series, matching the "Maximum heap size" governor. A metric with no
 * consumption is left out.
 *
 * These are whole-transaction totals: the series sums usage across
 * namespaces, so in a namespaced org a metric can pass 100% of a single
 * namespace's limit without a breach (#862) — accepted so every surface
 * matches the charts and the strip.
 */
export function rankedLimitMetrics(series: HeatStripTimeSeries, max: number): RankedLimitMetric[] {
  const final = series.events[series.events.length - 1]?.values;
  if (!final) {
    return [];
  }

  return GOVERNOR_METRICS.flatMap<RankedLimitMetric>(({ key, label }) => {
    const value = final.get(key);
    if (!value || value.limit <= 0) {
      return [];
    }
    const used = key === 'heapSize' ? peakUsed(series, key) : value.used;
    return used > 0
      ? [{ key, label, used, limit: value.limit, ratio: (used / value.limit) * 100 }]
      : [];
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
