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
