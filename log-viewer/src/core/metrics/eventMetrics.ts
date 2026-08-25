/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { GovernorLimits, LogEvent, SelfTotal } from 'apex-log-parser';

import { formatInteger } from '../utility/Util.js';

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

export interface EventMetric {
  label: string;
  pick: (event: LogEvent) => SelfTotal;
  /** The transaction limit this metric accumulates against; 0 when it has none. */
  limit: (limits: GovernorLimits, type?: StatementType) => number;
  bytes?: boolean;
  /** Throws only ever records on the leaf, so its self reading is meaningless. */
  noSelf?: boolean;
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
  { label: 'SOQL', pick: (e) => e.soqlCount, limit: (l) => l.soqlQueries.limit },
  { label: 'SOQL Rows', pick: (e) => e.soqlRowCount, limit: (l) => l.queryRows.limit },
  { label: 'DML', pick: (e) => e.dmlCount, limit: (l) => l.dmlStatements.limit },
  { label: 'DML Rows', pick: (e) => e.dmlRowCount, limit: (l) => l.dmlRows.limit },
  { label: 'SOSL', pick: (e) => e.soslCount, limit: (l) => l.soslQueries.limit },
  {
    label: 'SOSL Rows',
    pick: (e) => e.soslRowCount,
    // SOSL rows have no transaction total — the 2,000 cap is per query, so it
    // only reads as a limit when a single SOSL statement is selected.
    limit: (_limits, type) => (type === 'sosl' ? SOSL_ROWS_PER_QUERY_LIMIT : 0),
  },
  { label: 'Throws', pick: (e) => e.thrownCount, limit: () => 0, noSelf: true },
  { label: 'Heap net', pick: (e) => e.heapAllocated, limit: () => 0, bytes: true },
  { label: 'Heap alloc', pick: (e) => e.heapGross, limit: () => 0, bytes: true },
];

/**
 * Heap peak: the limit-comparable heap figure. It carries no self component, so it
 * is not a {@link SelfTotal} and sits outside {@link EVENT_METRICS}, read last.
 */
export const HEAP_PEAK = {
  label: 'Heap peak',
  pick: (event: LogEvent): number => event.heapPeak,
  limit: (limits: GovernorLimits): number => limits.heapSize.limit,
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
  /** `used / limit`, or the count alone where there is no limit. */
  primary: string;
  /** The percentage and any self reading — secondary, in reading order. */
  qualifiers: string[];
}

/**
 * `used / limit` with its derived percentage and any self reading, so the primary
 * number reads first. Without a known limit there is no denominator and no percentage.
 */
export function usageParts(
  total: number,
  limit: number,
  format: (value: number) => string,
  self: string | null,
): UsageParts {
  const fraction = limit > 0 ? total / limit : null;
  return {
    primary: limit > 0 ? `${format(total)} / ${format(limit)}` : format(total),
    // Percentage first: it qualifies the ratio immediately before it.
    qualifiers: [
      fraction !== null ? `${(fraction * 100).toFixed(2)}%` : null,
      self && selfLabel(self),
    ].filter((part): part is string => !!part),
  };
}
