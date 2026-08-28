/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { LogEvent } from 'apex-log-parser';

/**
 * Generates a unique key for grouping events by signature.
 * Includes event type so different entry types (e.g. CODE_UNIT_STARTED vs METHOD_ENTRY)
 * are displayed as separate rows. Field order (type|namespace|text) is the shared
 * canonical bucket-key shape used by aggregated, bottom-up, and analysis views.
 */
export function getEventKey(event: LogEvent): string {
  return `${event.type ?? ''}|${event.namespace}|${event.text}`;
}

/**
 * Generates a key for call-stack tracking to detect recursive calls.
 * Excludes event type so the same method is recognised regardless of entry type
 * (e.g. CODE_UNIT_STARTED at the top level, METHOD_ENTRY for recursive calls).
 * Matches the approach used by the analysis view's RowGrouper.
 */
export function getStackKey(event: LogEvent): string {
  return `${event.namespace}|${event.text}`;
}
