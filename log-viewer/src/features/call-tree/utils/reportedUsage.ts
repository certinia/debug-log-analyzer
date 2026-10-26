/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ApexLog, Limits, LogEvent } from '@apexdevtools/apex-log-parser';

import { logStoreFor, type Derivation } from '../../../core/log/LogStore.js';
import { firstIndexWhere } from '../../../core/utility/Util.js';
import type { HeatStripTimeSeries } from '../../timeline/types/flamechart.types.js';
import { apexLimitSeries } from '../../timeline/optimised/apex-limit-series.js';

/** The counters a span has a reported change for. Heap is a level, so a change in it means nothing. */
export const REPORTED_METRICS = [
  'soqlQueries',
  'queryRows',
  'dmlStatements',
  'dmlRows',
  'soslQueries',
] as const satisfies readonly (keyof Limits)[];

export type ReportedMetric = (typeof REPORTED_METRICS)[number];

/** A reported change for each of {@link REPORTED_METRICS}. */
export type ReportedCounts = Record<ReportedMetric, number>;

export const emptyReported = (): ReportedCounts => ({
  soqlQueries: 0,
  queryRows: 0,
  dmlStatements: 0,
  dmlRows: 0,
  soslQueries: 0,
});

/** Adds `from`, times `sign`, into `into`. */
export function addReported(into: ReportedCounts, from: ReportedCounts, sign = 1): void {
  for (const metric of REPORTED_METRICS) {
    into[metric] += sign * from[metric];
  }
}

/** A row's time: from `timestamp` up to, not including, `exitStamp`. */
export type TimeSpan = Pick<LogEvent, 'timestamp' | 'exitStamp'>;

/** Every point of the log. */
export const WHOLE_LOG: TimeSpan = { timestamp: -Infinity, exitStamp: Infinity };

/**
 * What a row used: our count, corrected to the limit usage Salesforce reported. Read from the limit
 * series the metric strip draws, before the ceiling the strip puts on it.
 *
 * A point belongs to the row that starts at it, not to one that ends there. A row with no duration
 * holds nothing: those rows only report limits, and the change they report happened in their
 * ancestors.
 */
export class ReportedUsage {
  private readonly _times: Float64Array;
  /** Each metric's level after each point; null for a metric the log never reported. */
  private readonly _levels: Record<ReportedMetric, Float64Array | null>;

  constructor(series: HeatStripTimeSeries) {
    const { events } = series;
    this._times = Float64Array.from(events, (event) => event.timestamp);
    const levelsOf = (metric: ReportedMetric): Float64Array | null =>
      events.some((event) => event.values.has(metric))
        ? Float64Array.from(events, (event) => {
            const value = event.values.get(metric);
            return value?.uncapped ?? value?.used ?? 0;
          })
        : null;
    this._levels = {
      soqlQueries: levelsOf('soqlQueries'),
      queryRows: levelsOf('queryRows'),
      dmlStatements: levelsOf('dmlStatements'),
      dmlRows: levelsOf('dmlRows'),
      soslQueries: levelsOf('soslQueries'),
    };
  }

  /** The change of `metric` over `of`, or null where the log never reported it. */
  delta(metric: ReportedMetric, of: TimeSpan): number | null {
    return this._levels[metric] ? (this.span(of)?.[metric] ?? 0) : null;
  }

  /**
   * The change of every metric over `of`, or null where it holds no point: most rows, so no
   * object. A row inside a null one is null too.
   */
  span(of: TimeSpan): ReportedCounts | null {
    const end = of.exitStamp ?? of.timestamp;
    const before = this._pointsBefore(of.timestamp);
    if ((this._times[before] ?? Infinity) >= end) {
      return null;
    }
    const after = this._pointsBefore(end);
    const change = (levels: Float64Array | null): number =>
      levels ? levelAt(levels, after) - levelAt(levels, before) : 0;
    const levels = this._levels;
    return {
      soqlQueries: change(levels.soqlQueries),
      queryRows: change(levels.queryRows),
      dmlStatements: change(levels.dmlStatements),
      dmlRows: change(levels.dmlRows),
      soslQueries: change(levels.soslQueries),
    };
  }

  private _pointsBefore(time: number): number {
    const times = this._times;
    return firstIndexWhere(times.length, (i) => times[i]! >= time); // i < length
  }
}

/** The level after the first `count` points; 0 before the first. */
const levelAt = (levels: Float64Array, count: number): number =>
  count > 0 ? levels[count - 1]! : 0; // count - 1 is in range: count <= length

/** {@link ReportedUsage} for a log, built once and shared like the series it reads. */
export const reportedUsage: Derivation<ReportedUsage> = async (_index, store) =>
  new ReportedUsage(await store.derive(apexLimitSeries));

/** The log's {@link ReportedUsage}, or null if its series failed: the grids then show `—`. */
export const reportedUsageOf = (log: ApexLog): Promise<ReportedUsage | null> =>
  logStoreFor(log)
    .derive(reportedUsage)
    .catch(() => null);
