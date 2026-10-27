/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { GovernorLimits, Limits, Rollups, SelfTotal } from '@apexdevtools/apex-log-parser';

import { formatInteger, sharePercent } from '../utility/Util.js';
import { GOVERNOR_METRIC } from './governorMetrics.js';

/**
 * The statement a database metric belongs to — which grid a selection came from, and
 * which metric a per-statement denominator applies to.
 */
export type StatementType = 'dml' | 'soql' | 'sosl';

/**
 * Maximum records returned by a *single* SOSL query. A per-query cap, not a cumulative
 * per-transaction total, so it is metered per row rather than summed against a total.
 */
export const SOSL_ROWS_PER_QUERY_LIMIT = 2000;

/** A rollup that is also a column of the log, under the same name. */
export type MetricKey =
  | 'soqlCount'
  | 'soqlRowCount'
  | 'dmlCount'
  | 'dmlRowCount'
  | 'soslCount'
  | 'soslRowCount'
  | 'thrownCount'
  | 'heapAllocated'
  | 'heapGross';

export interface EventMetric {
  label: string;
  /** The rollup it reads, and the column of `ApexLog.columns` that holds it by id. */
  key: MetricKey;
  /** The reading of one event, or of the whole log. */
  pick: (of: Rollups) => SelfTotal;
  /** The transaction limit this metric accumulates against; 0 when it has none. */
  limit: (limits: GovernorLimits, type?: StatementType) => number;
  bytes?: boolean;
  /** Throws only ever records on the leaf, so its self reading is meaningless. */
  noSelf?: boolean;
}

/** A count the log did not record reads as none, as it did before the parser said so. */
const NONE: SelfTotal = { self: 0, total: 0 };

const pickOf =
  (key: MetricKey): EventMetric['pick'] =>
  (of) =>
    of[key] ?? NONE;

function governed(limit: keyof Limits, key: MetricKey): EventMetric {
  return {
    label: GOVERNOR_METRIC[limit].label,
    key,
    pick: pickOf(key),
    limit: (l) => l.final[limit].limit ?? 0,
  };
}

/**
 * Every governor-tracked metric a frame reports, most important first. The `limit`
 * is the row's denominator, so a metric is shown once — never as both a count and a
 * separate "limit" row.
 *
 * The order is the reading order everywhere these appear. A view may drop metrics,
 * and may rank them to decide which to drop, but renders what it keeps in this
 * order — so a row never overtakes another as a selection or a hover moves.
 */
export const EVENT_METRICS: readonly EventMetric[] = [
  governed('soqlQueries', 'soqlCount'),
  governed('queryRows', 'soqlRowCount'),
  governed('dmlStatements', 'dmlCount'),
  governed('dmlRows', 'dmlRowCount'),
  governed('soslQueries', 'soslCount'),
  {
    label: 'SOSL Rows',
    key: 'soslRowCount',
    pick: pickOf('soslRowCount'),
    // SOSL rows have no transaction total — the 2,000 cap is per query, so it
    // only reads as a limit when a single SOSL statement is selected.
    limit: (_limits, type) => (type === 'sosl' ? SOSL_ROWS_PER_QUERY_LIMIT : 0),
  },
  {
    label: 'Throws',
    key: 'thrownCount',
    pick: pickOf('thrownCount'),
    limit: () => 0,
    noSelf: true,
  },
  {
    label: 'Heap Net',
    key: 'heapAllocated',
    pick: pickOf('heapAllocated'),
    limit: () => 0,
    bytes: true,
  },
  {
    label: 'Heap Alloc',
    key: 'heapGross',
    pick: pickOf('heapGross'),
    limit: () => 0,
    bytes: true,
  },
];

/**
 * Heap peak: the limit-comparable heap figure. It carries no self component, so it
 * is not a {@link SelfTotal} and sits outside {@link EVENT_METRICS}, read last.
 */
export const HEAP_PEAK = {
  label: 'Heap Peak',
  pick: (of: Rollups): number => of.heapPeak ?? 0,
  limit: (limits: GovernorLimits): number => limits.peak.heapSize.limit ?? 0,
  bytes: true,
} as const;

/** Heap values are byte counts; a signed net value keeps its sign. */
export function formatBytes(bytes: number): string {
  return `${formatInteger(bytes)} bytes`;
}

/** A frame's own share of a reading, named the one way every view names it. */
export function selfLabel(self: string): string {
  return `self ${self}`;
}

/** A metric reading, split so a caller can lay the parts out however it likes. */
export interface UsageParts {
  /** `used of the log's total`, or the count alone where the reading is the whole log. */
  primary: string;
  /** The shares, the limit reading and any self reading — secondary, in reading order. */
  qualifiers: string[];
}

/**
 * A reading against what the transaction consumed, with any limit as a qualifier.
 *
 * The primary number answers the question a per-selection reading is asked — how much of the
 * transaction's own consumption this is — so it is spelled "of", never "/", and reads on every log
 * whether or not one reported limits. A whole-log reading carries no denominator — its share of
 * itself is 100% — and neither does a log total of zero or less, which a signed metric like net
 * heap can reach. A selection reading *past* the log's own total does keep one, rather than hiding
 * the anomaly behind a bare number. A limit the log reported follows as a qualifier.
 *
 * @param total - This selection's consumption.
 * @param logTotal - The transaction's consumption of the same metric.
 * @param limit - The limit the log reported, or 0 where it reported none.
 * @param format - How to write each number.
 * @param self - The selection's own share, already formatted, or null where it adds nothing.
 */
export function usageParts(
  total: number,
  logTotal: number,
  limit: number,
  format: (value: number) => string,
  self: string | null,
): UsageParts {
  const noDenominator = logTotal <= 0 || logTotal === total;
  return {
    primary: noDenominator ? format(total) : `${format(total)} of ${format(logTotal)}`,
    qualifiers: [
      noDenominator ? null : `${sharePercent(total, logTotal).toFixed(2)}% of log`,
      limit > 0 ? `${sharePercent(total, limit).toFixed(2)}% of the ${format(limit)} limit` : null,
      self && selfLabel(self),
    ].filter((part): part is string => !!part),
  };
}
