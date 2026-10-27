/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import { currentLogStore } from '../core/log/LogStore.js';

export interface CallStackRow {
  eventIndex: number;
  type: string;
  text: string;
  duration: { total: number; self: number };
}

/**
 * Flat, plain-object rows for the call-stack table — the lineage of parents
 * that led to `eventIndex`, outermost first (as `getStackByEventIndex`
 * returns them). `rootTotal` (the outermost frame's total, in ns) is the
 * denominator for the Total/Self percentage bars.
 */
export function buildCallStackData(eventIndex: number): {
  rows: CallStackRow[];
  rootTotal: number;
} {
  const stack = eventIndex >= 0 ? (currentLogStore()?.stackByEventIndex(eventIndex) ?? []) : [];
  const rows = stack.map((entry) => ({
    eventIndex: entry.eventIndex,
    type: entry.type ?? '',
    text: entry.text,
    duration: { total: entry.duration.total, self: entry.duration.self },
  }));
  return { rows, rootTotal: rows[0]?.duration.total ?? 0 };
}
