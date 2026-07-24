/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * Canonical reference for the numbers used across the Database tab. Check here
 * when a limit looks wrong or Salesforce changes one.
 *
 * Per-transaction limits (tracked in CUMULATIVE_LIMIT_USAGE): SOQL queries 100,
 * SOSL queries 20, SOQL query rows 50,000, DML statements 150, DML rows 10,000.
 * Per-query limit (NOT a transaction total): a single SOSL query returns at most
 * 2,000 rows — see {@link SOSL_ROWS_PER_QUERY_LIMIT}.
 */
export const APEX_GOVERNOR_LIMITS_DOC =
  'https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_gov_limits.htm';

/**
 * Maximum records returned by a *single* SOSL query. This is a per-query cap,
 * not a cumulative per-transaction total — so it's metered per row in the SOSL
 * table, not summed against a transaction limit.
 */
export const SOSL_ROWS_PER_QUERY_LIMIT = 2000;

/** Derived SOSL-rows metric fields (label/found are supplied by the caller). */
export interface SoslRowsMetric {
  used: number | null;
  limit: number;
  note?: string;
}

/**
 * SOSL rows aren't reported as a transaction total, so the ceiling is derived:
 * {@link SOSL_ROWS_PER_QUERY_LIMIT} × the SOSL-query limit. Only meaningful when the
 * log captured that limit (`hasLimits`); otherwise this degrades to "limit n/a"
 * (`used` null, no ceiling, no note) like every other metric.
 */
export function soslRowsMetric(
  seenRows: number,
  soslQueriesLimit: number,
  hasLimits: boolean,
): SoslRowsMetric {
  const limit = soslQueriesLimit * SOSL_ROWS_PER_QUERY_LIMIT;
  return {
    used: hasLimits ? seenRows : null,
    limit,
    note:
      limit > 0
        ? `Up to ${SOSL_ROWS_PER_QUERY_LIMIT.toLocaleString()} rows per SOSL query × ${soslQueriesLimit} queries = ${limit.toLocaleString()} max per transaction.`
        : undefined,
  };
}
