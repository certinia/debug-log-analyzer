/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * Shared parsing for governor-limit log lines. One label map + one number parser serve every
 * limit-reporting format so the mappings live in a single place:
 * - `LIMIT_USAGE_FOR_NS` cumulative block   — "Number of SOQL queries: 8 out of 100"
 * - flow colon reports                       — "SOQL queries: 0 out of 100"
 * - flow running-total reports               — "1 SOQL queries, total 1 out of 100"
 * - single `LIMIT_USAGE`                      — code "SOQL", used "1", limit "100"
 */

import type { Limits } from './types.js';

/** Metric key of a governor limit that can be tracked granularly. */
export type LimitMetricKey = keyof Limits;

/**
 * A single governor-limit observation parsed from a limit-usage log line. `used`/`limit` are the
 * cumulative values reported for that metric at the point in the log where the line was emitted.
 */
export interface LimitObservation {
  metric: LimitMetricKey;
  used: number;
  limit: number;
}

/**
 * Every known governor-limit label → metric key. Covers the cumulative block ("Number of …" /
 * "Maximum …"), the flow colon reports, and the flow running-total reports ("ms CPU time").
 * Labels not present here are not tracked governor limits (e.g. FIELDS_DESCRIBES).
 */
const LIMIT_LABELS = new Map<string, LimitMetricKey>([
  // LIMIT_USAGE_FOR_NS cumulative block
  ['Number of SOQL queries', 'soqlQueries'],
  ['Number of query rows', 'queryRows'],
  ['Number of SOSL queries', 'soslQueries'],
  ['Number of DML statements', 'dmlStatements'],
  ['Number of Publish Immediate DML', 'publishImmediateDml'],
  ['Number of DML rows', 'dmlRows'],
  ['Maximum CPU time', 'cpuTime'],
  ['Maximum heap size', 'heapSize'],
  ['Number of callouts', 'callouts'],
  ['Number of Email Invocations', 'emailInvocations'],
  ['Number of future calls', 'futureCalls'],
  ['Number of queueable jobs added to the queue', 'queueableJobsAddedToQueue'],
  ['Number of Mobile Apex push calls', 'mobileApexPushCalls'],
  // Flow colon reports + running-total labels
  ['SOQL queries', 'soqlQueries'],
  ['SOQL query rows', 'queryRows'],
  ['SOSL queries', 'soslQueries'],
  ['DML statements', 'dmlStatements'],
  ['DML rows', 'dmlRows'],
  ['CPU time in ms', 'cpuTime'],
  ['ms CPU time', 'cpuTime'],
  ['Heap size in bytes', 'heapSize'],
  ['Callouts', 'callouts'],
  ['Email invocations', 'emailInvocations'],
  ['Future calls', 'futureCalls'],
  ['Jobs in queue', 'queueableJobsAddedToQueue'],
]);

/**
 * Governor-limit codes for the single-line LIMIT_USAGE format. Non-governor codes
 * (FIELDS_DESCRIBES, FIELDSETS_DESCRIBES, AGGS, SCRIPT_STATEMENTS) are intentionally omitted.
 */
const LIMIT_USAGE_CODES = new Map<string, LimitMetricKey>([
  ['SOQL', 'soqlQueries'],
  ['SOQL_ROWS', 'queryRows'],
  ['SOSL', 'soslQueries'],
  ['DML', 'dmlStatements'],
  ['DML_ROWS', 'dmlRows'],
]);

/** Matches "<used> out of <limit>" or "<used>/<limit>". */
const USED_OF_RE = /(\d+)\s*(?:out of|\/)\s*(\d+)/;

function toInt(value: string): number {
  return parseInt(value, 10);
}

function used(metric: LimitMetricKey | undefined, text: string): LimitObservation | null {
  if (!metric) {
    return null;
  }
  const match = USED_OF_RE.exec(text);
  return match ? { metric, used: toInt(match[1]!), limit: toInt(match[2]!) } : null;
}

/**
 * Parse a labelled limit line, e.g. "Number of SOQL queries: 8 out of 100" (cumulative block) or
 * "SOQL queries: 0 out of 100" (flow). Returns null for untracked labels.
 */
export function parseLabelledLimit(body: string): LimitObservation | null {
  const colon = body.indexOf(':');
  if (colon === -1) {
    return null;
  }
  return used(LIMIT_LABELS.get(body.slice(0, colon).trim()), body.slice(colon + 1));
}

/**
 * Parse a running-total limit line, e.g. "1 SOQL queries, total 1 out of 100". Uses the reported
 * running total as `used`. Returns null for untracked labels.
 */
export function parseTotalLimit(body: string): LimitObservation | null {
  const comma = body.indexOf(',');
  if (comma === -1) {
    return null;
  }
  const label = body
    .slice(0, comma)
    .replace(/^\d+\s+/, '')
    .trim();
  return used(LIMIT_LABELS.get(label), body.slice(comma + 1));
}

/**
 * Parse a single-line LIMIT_USAGE record, e.g. code "SOQL", used "1", limit "100".
 * Returns null for non-governor codes.
 */
export function parseCodedLimit(
  code: string | undefined,
  usedValue: string | undefined,
  limit: string | undefined,
): LimitObservation | null {
  const metric = code ? LIMIT_USAGE_CODES.get(code) : undefined;
  return metric ? { metric, used: toInt(usedValue ?? '0'), limit: toInt(limit ?? '0') } : null;
}
