/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import { EXCLUDED_DETAIL_TYPES } from '../features/call-tree/utils/DetailsFilter.js';
import { DatabaseAccess } from '../features/database/services/Database.js';

export interface CallStackRow {
  eventIndex: number;
  type: string;
  text: string;
  duration: { total: number; self: number };
}

/**
 * Flat, plain-object rows for the call-stack table — the lineage of parent
 * frames that led to `eventIndex`, outermost first (as `getStackByEventIndex`
 * returns them). `rootTotal` (the outermost frame's total, in ns) is the
 * denominator for the Total/Self percentage bars.
 *
 * Detail frames are dropped: the inspector's stack holds call frames only. A
 * `CUMULATIVE_LIMIT_USAGE` or `CUMULATIVE_PROFILING_BEGIN` block is a parent, so
 * it can be an ancestor of a selected row. `EXCLUDED_DETAIL_TYPES` names them
 * for the Call Tree tab, which keeps them visible; here they are the exclusion.
 */
export function buildCallStackData(eventIndex: number): {
  rows: CallStackRow[];
  rootTotal: number;
} {
  const stack =
    eventIndex >= 0 ? (DatabaseAccess.instance()?.getStackByEventIndex(eventIndex) ?? []) : [];
  const rows = stack
    .filter((entry) => !EXCLUDED_DETAIL_TYPES.has(entry.type ?? ''))
    .map((entry) => ({
      eventIndex: entry.eventIndex,
      type: entry.type ?? '',
      text: entry.text,
      duration: { total: entry.duration.total, self: entry.duration.self },
    }));
  // Taken after the filter, so the bars are a share of the outermost frame shown.
  return { rows, rootTotal: rows[0]?.duration.total ?? 0 };
}
