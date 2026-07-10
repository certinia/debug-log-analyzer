/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * apex-limit-series - Apex adapter: builds the metric-strip governor-limit time series.
 *
 * This is adapter-layer code (like ApexLogTimeline) and may import apex-log-parser types.
 * The metric-strip/ classifier and renderers stay Apex-agnostic — they consume the generic
 * HeatStripTimeSeries this module produces.
 */

import type { ApexLog, HeapAllocateLine, Limits, LimitUsageLine, LogEvent } from 'apex-log-parser';
import type { HeatStripMetric, HeatStripTimeSeries } from '../types/flamechart.types.js';
import {
  buildGovernorTimeSeries,
  type LimitObservation as GranularObservation,
} from './metric-strip/governor-timeline.js';

/**
 * Apex-specific metric definitions for heat strip visualization.
 * "Big 4" limits (CPU, SOQL, DML, Heap) have priority < 4 and are always shown.
 * Other limits have priority >= 4 and are only shown when > 0%.
 */
const APEX_METRICS: Map<keyof Limits, HeatStripMetric> = new Map([
  ['cpuTime', { id: 'cpuTime', displayName: 'CPU Time', unit: 'ms', priority: 0 }],
  ['soqlQueries', { id: 'soqlQueries', displayName: 'SOQL Queries', unit: '', priority: 1 }],
  ['dmlStatements', { id: 'dmlStatements', displayName: 'DML Statements', unit: '', priority: 2 }],
  ['heapSize', { id: 'heapSize', displayName: 'Heap Size', unit: 'bytes', priority: 3 }],
  ['queryRows', { id: 'queryRows', displayName: 'Query Rows', unit: '', priority: 4 }],
  ['soslQueries', { id: 'soslQueries', displayName: 'SOSL Queries', unit: '', priority: 5 }],
  ['dmlRows', { id: 'dmlRows', displayName: 'DML Rows', unit: '', priority: 6 }],
  [
    'publishImmediateDml',
    { id: 'publishImmediateDml', displayName: 'Publish Immediate DML', unit: '', priority: 7 },
  ],
  ['callouts', { id: 'callouts', displayName: 'Callouts', unit: '', priority: 8 }],
  [
    'emailInvocations',
    { id: 'emailInvocations', displayName: 'Email Invocations', unit: '', priority: 9 },
  ],
  ['futureCalls', { id: 'futureCalls', displayName: 'Future Calls', unit: '', priority: 10 }],
  [
    'queueableJobsAddedToQueue',
    { id: 'queueableJobsAddedToQueue', displayName: 'Queueable Jobs', unit: '', priority: 11 },
  ],
  [
    'mobileApexPushCalls',
    { id: 'mobileApexPushCalls', displayName: 'Mobile Push Calls', unit: '', priority: 12 },
  ],
]);

/**
 * Standard synchronous Apex governor limits, used as a fallback so a metric can render from
 * granular usage alone when the log has no cumulative limit event. Any limit reported by the log
 * (LIMIT_USAGE_FOR_NS / LIMIT_USAGE / flow) overrides these.
 */
const DEFAULT_LIMITS = new Map<string, number>([
  ['soqlQueries', 100],
  ['queryRows', 50000],
  ['soslQueries', 20],
  ['dmlStatements', 150],
  ['publishImmediateDml', 150],
  ['dmlRows', 10000],
  ['cpuTime', 10000],
  ['heapSize', 6000000],
  ['callouts', 100],
  ['emailInvocations', 10],
  ['futureCalls', 50],
  ['queueableJobsAddedToQueue', 50],
  ['mobileApexPushCalls', 10],
]);

/**
 * Build the dense governor-limit time series for the metric strip.
 *
 * Combines two sources into one stream of observations and folds them (see
 * governor-timeline.ts): cumulative `LIMIT_USAGE_FOR_NS` snapshots act as multi-metric
 * correctives, while detailed log events (SOQL/DML/SOSL/callout/heap and the single-line
 * `LIMIT_USAGE` / flow `*_LIMIT_USAGE` reports) add intermediate data points so the line
 * rises as usage happens rather than only at code-unit boundaries.
 *
 * @param apexLog - Parsed log providing cumulative snapshots and authoritative limits.
 * @param events - Top-level log events; the full tree is walked for granular deltas.
 */
export function buildApexLimitTimeSeries(
  apexLog: ApexLog,
  events: LogEvent[],
): HeatStripTimeSeries {
  const metrics = new Map<string, HeatStripMetric>();
  for (const [key, metric] of APEX_METRICS) {
    metrics.set(key, metric);
  }

  const observations: GranularObservation[] = [];

  // Authoritative limit per metric = max limit reported by any cumulative snapshot, else the
  // default. Fixed for the whole series so the "out of" total never flips (e.g. heap 6MB→12MB).
  const metricLimits = new Map<string, number>(DEFAULT_LIMITS);

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
      });
      if (value.limit > 0) {
        metricLimits.set(metric, Math.max(metricLimits.get(metric) ?? 0, value.limit));
      }
    }
  }

  const pushDelta = (
    timestamp: number,
    namespace: string,
    metric: keyof Limits,
    delta: number,
  ): void => {
    if (delta) {
      observations.push({ kind: 'delta', timestamp, namespace, metric, delta });
    }
  };

  // Detailed events — granular deltas and finer-grained absolute reports. Walk the FULL tree:
  // events holds only top-level nodes, but SOQL/DML/heap events live deep in the call tree.
  // Iterative DFS avoids stack overflow on large logs. Counts are read from the parser's per-event
  // counters, each from its canonical owner event to avoid double-counting.
  const stack: LogEvent[] = [...events];
  while (stack.length > 0) {
    const event = stack.pop()!;
    const children = event.children;
    if (children) {
      for (let i = 0; i < children.length; i++) {
        stack.push(children[i]!);
      }
    }

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
      case 'HEAP_ALLOCATE':
      case 'BULK_HEAP_ALLOCATE':
        // Allocation bytes can be negative in the log, so add as-is (a negative lowers heap).
        pushDelta(timestamp, namespace, 'heapSize', (event as HeapAllocateLine).bytes);
        break;
      case 'HEAP_DEALLOCATE':
        // Deallocation always takes away.
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
          observations.push({
            kind: 'absolute',
            timestamp,
            namespace,
            metric: usage.metric,
            used: usage.used,
          });
        }
        break;
      }
      default:
        break;
    }
  }

  return buildGovernorTimeSeries(observations, metrics, metricLimits);
}
