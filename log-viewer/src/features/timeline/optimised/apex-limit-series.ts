/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * apex-limit-series - Apex adapter: builds the metric-strip governor-limit time series.
 *
 * This is adapter-layer code (like ApexLogTimeline) and may import parser types.
 * The metric-strip/ classifier and renderers stay Apex-agnostic — they consume the generic
 * HeatStripTimeSeries this module produces.
 */

import {
  type HeapAllocateLine,
  LOG_CATEGORY,
  type LimitUsageLine,
  type LimitMetricUnit,
  type Limits,
} from '@apexdevtools/apex-log-parser';
import { UNCATEGORISED } from '../../../core/log/LogIndex.js';
import type { Derivation } from '../../../core/log/LogStore.js';
import { GOVERNOR_METRICS } from '../../../core/metrics/governorMetrics.js';
import { CHECK_EVERY, frameBudget } from '../../../core/utility/FrameBudget.js';
import type { HeatStripMetric, HeatStripTimeSeries } from '../types/flamechart.types.js';
import { extractMarkers, noDataSpans } from '../utils/marker-utils.js';
import {
  buildGovernorTimeSeries,
  type LimitObservation as GranularObservation,
} from './metric-strip/governor-timeline.js';

const STRIP_UNIT: Record<LimitMetricUnit, string> = { millisecond: 'ms', byte: 'bytes', count: '' };

/** The heat strip's metrics, in strip priority order. */
const APEX_METRICS: Map<keyof Limits, HeatStripMetric> = new Map(
  [...GOVERNOR_METRICS]
    .sort((a, b) => a.priority - b.priority)
    .map(({ key, label, unit, priority }) => [
      key,
      { id: key, displayName: label, unit: STRIP_UNIT[unit], priority },
    ]),
);

/**
 * The dense governor-limit time series for the metric strip, built once per log
 * and shared by every surface that charts it.
 *
 * Combines two sources into one stream of observations and folds them (see
 * governor-timeline.ts): cumulative `LIMIT_USAGE_FOR_NS` snapshots act as multi-metric
 * correctives, while detailed log events (SOQL/DML/SOSL/callout/heap and the single-line
 * `LIMIT_USAGE` / flow `*_LIMIT_USAGE` reports) add intermediate data points so the line
 * rises as usage happens rather than only at code-unit boundaries.
 */
export const apexLimitSeries: Derivation<HeatStripTimeSeries> = async (index, store) => {
  const apexLog = store.log;
  const metrics = new Map<string, HeatStripMetric>();
  for (const [key, metric] of APEX_METRICS) {
    metrics.set(key, metric);
  }

  const observations: GranularObservation[] = [];

  // The log is the only source of a limit: the highest one it reported anywhere, fixed for the
  // whole series so the "out of" total never flips (a log can report both the synchronous and the
  // asynchronous ceiling). A metric the log never named keeps limit 0 — its consumers scale it by
  // its own peak rather than measure it against a number the log never gave.
  const metricLimits = new Map<string, number>();
  const reportLimit = (metric: keyof Limits, limit: number): void => {
    if (limit > 0) {
      metricLimits.set(metric, Math.max(metricLimits.get(metric) ?? 0, limit));
    }
  };

  // Cumulative snapshots — authoritative multi-metric correctives (transaction usage).
  for (const snapshot of apexLog.governorLimits.snapshots) {
    for (const [metric, value] of Object.entries(snapshot.limits) as [
      keyof Limits,
      { used: number; limit: number },
    ][]) {
      observations.push({
        kind: 'absolute',
        timestamp: snapshot.timestamp,
        namespace: snapshot.namespace,
        metric,
        used: value.used,
        scope: 'cumulative',
      });
      reportLimit(metric, value.limit);
    }
  }

  const { categoryId, rowCount, subtreeEnd } = index;
  const granular: { observation: GranularObservation; end: number }[] = [];
  let row = 0;
  const observe = (observation: GranularObservation): void => {
    granular.push({ observation, end: subtreeEnd[row]! }); // in range: `row` is a row of `index`
  };
  const pushDelta = (
    timestamp: number,
    namespace: string,
    metric: keyof Limits,
    delta: number,
  ): void => {
    if (delta) {
      observe({ kind: 'delta', timestamp, namespace, metric, delta });
    }
  };

  // Each count is read once, from the event that owns it, so none is counted twice.
  const tick = frameBudget({});
  const soqlId = index.categoryNames.indexOf(LOG_CATEGORY.SOQL);
  const dmlId = index.categoryNames.indexOf(LOG_CATEGORY.DML);
  const calloutId = index.categoryNames.indexOf(LOG_CATEGORY.Callout);
  for (row = 0; row < rowCount; row++) {
    if (row % CHECK_EVERY === 0) {
      await tick();
    }
    const category = categoryId[row];
    if (
      category !== UNCATEGORISED &&
      category !== soqlId &&
      category !== dmlId &&
      category !== calloutId
    ) {
      continue;
    }
    const event = index.event(row);
    const timestamp = event.timestamp;
    const namespace = event.namespace || 'default';
    switch (event.type) {
      case 'SOQL_EXECUTE_BEGIN':
        // Row count is copied onto the begin line by its onEnd, so read both here (not on END).
        pushDelta(timestamp, namespace, 'soqlQueries', event.soqlCount.self);
        pushDelta(timestamp, namespace, 'queryRows', event.soqlRowCount.self);
        break;
      case 'SOSL_EXECUTE_BEGIN':
        pushDelta(timestamp, namespace, 'soslQueries', event.soslCount.self);
        break;
      case 'DML_BEGIN':
        pushDelta(timestamp, namespace, 'dmlStatements', event.dmlCount.self);
        pushDelta(timestamp, namespace, 'dmlRows', event.dmlRowCount.self);
        break;
      case 'CALLOUT_REQUEST':
        pushDelta(timestamp, namespace, 'callouts', 1);
        break;
      // A deallocation is normally a negative HEAP_ALLOCATE (|Bytes:-N|), so add as-is;
      // HEAP_DEALLOCATE is a rarer distinct form. Each is one event type, so applying
      // both cases never double-subtracts a free.
      case 'HEAP_ALLOCATE':
      case 'BULK_HEAP_ALLOCATE':
        pushDelta(timestamp, namespace, 'heapSize', (event as HeapAllocateLine).bytes);
        break;
      case 'HEAP_DEALLOCATE':
        pushDelta(timestamp, namespace, 'heapSize', -Math.abs((event as HeapAllocateLine).bytes));
        break;
      case 'LIMIT_USAGE':
      case 'FLOW_START_INTERVIEW_LIMIT_USAGE':
      case 'FLOW_INTERVIEW_FINISHED_LIMIT_USAGE':
      case 'FLOW_ELEMENT_LIMIT_USAGE':
      case 'FLOW_BULK_ELEMENT_LIMIT_USAGE': {
        const usage = (event as LimitUsageLine).limitUsage;
        // Flow CPU time is flow-scoped with a different limit (15000 vs the 10000 apex limit),
        // so skip it here — CPU stays sourced from LIMIT_USAGE_FOR_NS to keep percentages consistent.
        if (usage && !(event.type !== 'LIMIT_USAGE' && usage.metric === 'cpuTime')) {
          // These lines report a block's usage, but the limit they name is the transaction's, and
          // some logs carry them with no cumulative block at all.
          reportLimit(usage.metric, usage.limit);
          observe({
            kind: 'absolute',
            timestamp,
            namespace,
            metric: usage.metric,
            used: usage.used,
            // Each of these lines reports the block it closes, not the transaction.
            scope: 'scoped',
          });
        }
        break;
      }
      default:
        break;
    }
  }

  // Ties in time keep the order a last-child-first walk meets them in; the sort is stable.
  granular.sort((a, b) => a.observation.timestamp - b.observation.timestamp || b.end - a.end);
  for (const { observation } of granular) {
    observations.push(observation);
  }

  return {
    ...(await buildGovernorTimeSeries(observations, metrics, metricLimits, tick)),
    // On the series itself, not added by the Timeline alone: every surface drawing it has to
    // leave the spans the log recorded nothing in blank.
    gaps: noDataSpans(extractMarkers(apexLog)),
  };
};
