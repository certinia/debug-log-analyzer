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
  type EventOf,
  type EventType,
  eventType,
  type LimitUnit,
  type Limits,
} from '@apexdevtools/apex-log-parser';
import type { Derivation } from '#core/log/LogStore.js';
import { rowMetrics } from '#core/log/rowMetrics.js';
import { DEFAULT_NAMESPACE } from '#core/utility/CallerNamespace.js';
import { GOVERNOR_METRICS } from '#core/metrics/governorMetrics.js';
import { CHECK_EVERY, frameBudget } from '#core/utility/FrameBudget.js';
import type { HeatStripMetric, HeatStripTimeSeries } from '../types/flamechart.types.js';
import { extractMarkers, noDataSpans } from '../utils/marker-utils.js';
import {
  buildGovernorTimeSeries,
  type LimitObservation as GranularObservation,
} from './metric-strip/governor-timeline.js';

const STRIP_UNIT: Record<LimitUnit, string> = { millisecond: 'ms', byte: 'bytes', count: '' };

/** The heat strip's metrics, in strip priority order. */
const APEX_METRICS: Map<keyof Limits, HeatStripMetric> = new Map(
  [...GOVERNOR_METRICS]
    .sort((a, b) => a.priority - b.priority)
    .map(({ key, label, unit, priority }) => [
      key,
      { id: key, displayName: label, unit: STRIP_UNIT[unit], priority },
    ]),
);

const typeId = (type: EventType): number => eventType(type).typeId;
const SOQL = typeId('SOQL_EXECUTE_BEGIN');
const SOSL = typeId('SOSL_EXECUTE_BEGIN');
const DML = typeId('DML_BEGIN');
const CALLOUT = typeId('CALLOUT_REQUEST');
const HEAP_ALLOCATE = typeId('HEAP_ALLOCATE');
const BULK_HEAP_ALLOCATE = typeId('BULK_HEAP_ALLOCATE');
const HEAP_DEALLOCATE = typeId('HEAP_DEALLOCATE');
const LIMIT_USAGE = typeId('LIMIT_USAGE');
const FLOW_LIMIT_USAGE = new Set(
  (
    [
      'FLOW_START_INTERVIEW_LIMIT_USAGE',
      'FLOW_INTERVIEW_FINISHED_LIMIT_USAGE',
      'FLOW_ELEMENT_LIMIT_USAGE',
      'FLOW_BULK_ELEMENT_LIMIT_USAGE',
    ] as const
  ).map(typeId),
);

type HeapEvent = EventOf<'HEAP_ALLOCATE' | 'BULK_HEAP_ALLOCATE' | 'HEAP_DEALLOCATE'>;
type LimitUsageEvent = EventOf<
  | 'LIMIT_USAGE'
  | 'FLOW_START_INTERVIEW_LIMIT_USAGE'
  | 'FLOW_INTERVIEW_FINISHED_LIMIT_USAGE'
  | 'FLOW_ELEMENT_LIMIT_USAGE'
  | 'FLOW_BULK_ELEMENT_LIMIT_USAGE'
>;

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
  for (const snapshot of apexLog.limits.snapshots) {
    for (const [metric, value] of Object.entries(snapshot.limits) as [
      keyof Limits,
      { used: number; limit: number | null },
    ][]) {
      observations.push({
        kind: 'absolute',
        timestamp: snapshot.timestamp,
        namespace: snapshot.namespace,
        metric,
        used: value.used,
        scope: 'cumulative',
      });
      reportLimit(metric, value.limit ?? 0);
    }
  }

  const { rowCount, subtreeEnd, start } = index;
  const types = index.column(apexLog.columns.type);
  const namespaceIds = index.column(apexLog.columns.namespace.ids);
  const namespaces = apexLog.columns.namespace.values;
  const m = rowMetrics(index);
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
  for (row = 0; row < rowCount; row++) {
    if (row % CHECK_EVERY === 0) {
      await tick();
    }
    const type = types[row]!; // row < rowCount
    const timestamp = start[row]!;
    const namespace = namespaces[namespaceIds[row]!] ?? DEFAULT_NAMESPACE;
    if (type === SOQL) {
      pushDelta(timestamp, namespace, 'soqlQueries', m.soqlCount.self[row]!);
      pushDelta(timestamp, namespace, 'queryRows', m.soqlRowCount.self[row]!);
    } else if (type === SOSL) {
      pushDelta(timestamp, namespace, 'soslQueries', m.soslCount.self[row]!);
    } else if (type === DML) {
      pushDelta(timestamp, namespace, 'dmlStatements', m.dmlCount.self[row]!);
      pushDelta(timestamp, namespace, 'dmlRows', m.dmlRowCount.self[row]!);
    } else if (type === CALLOUT) {
      pushDelta(timestamp, namespace, 'callouts', 1);
    } else if (type === HEAP_ALLOCATE || type === BULK_HEAP_ALLOCATE) {
      // A deallocation is normally a negative HEAP_ALLOCATE (|Bytes:-N|), so add as-is;
      // HEAP_DEALLOCATE is a rarer distinct form. Each is one event type, so applying
      // both cases never double-subtracts a free.
      pushDelta(
        timestamp,
        namespace,
        'heapSize',
        (index.event(row) as HeapEvent).details.bytes ?? 0,
      );
    } else if (type === HEAP_DEALLOCATE) {
      const bytes = (index.event(row) as HeapEvent).details.bytes ?? 0;
      pushDelta(timestamp, namespace, 'heapSize', -Math.abs(bytes));
    } else if (type === LIMIT_USAGE || FLOW_LIMIT_USAGE.has(type)) {
      const usage = (index.event(row) as LimitUsageEvent).details;
      // Flow CPU time is flow-scoped with a different limit (15000 vs the 10000 apex limit),
      // so skip it here — CPU stays sourced from LIMIT_USAGE_FOR_NS to keep percentages consistent.
      // A label no metric tracks, such as AGGS, has no series to join.
      if (usage?.metric && !(type !== LIMIT_USAGE && usage.metric === 'cpuTime')) {
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
