/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import { currentLogStore } from '#core/log/LogStore.js';

export interface CallStackRow {
  eventId: number;
  type: string;
  text: string;
  duration: { total: number; self: number };
}

/**
 * Flat, plain-object rows for the call-stack table — the lineage of parents
 * that led to `eventId`, outermost first (as `LogStore.stackById`
 * returns them). `rootTotal` (the outermost frame's total, in ns) is the
 * denominator for the Total/Self percentage bars.
 */
export function buildCallStackData(eventId: number): {
  rows: CallStackRow[];
  rootTotal: number;
} {
  const stack = eventId >= 0 ? (currentLogStore()?.stackById(eventId) ?? []) : [];
  const rows = stack.map((entry) => ({
    eventId: entry.id,
    type: entry.type,
    text: entry.text ?? entry.type,
    duration: { total: entry.duration.total, self: entry.duration.self },
  }));
  return { rows, rootTotal: rows[0]?.duration.total ?? 0 };
}
