/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { LOG_CATEGORY, type ApexLog, type LogCategory, type LogEvent } from 'apex-log-parser';

import type { TimelineKeyEntry } from '../components/TimelineKey.js';

/**
 * Sums self time (ns) per category across the whole event tree. Self time partitions
 * the wall clock, so the sums add up to the log duration with no double counting.
 * Iterative walk — deep logs would overflow a recursive one.
 */
export function categorySelfTimes(root: ApexLog): Map<LogCategory, number> {
  const totals = new Map<LogCategory, number>();
  const stack: LogEvent[] = [root];
  for (let node = stack.pop(); node; node = stack.pop()) {
    if (node.category) {
      totals.set(node.category, (totals.get(node.category) ?? 0) + node.duration.self);
    }
    for (const child of node.children) {
      stack.push(child);
    }
  }
  return totals;
}

/** Legend order; the labels double as the `LogCategory` keys `categorySelfTimes` sums by. */
const KEY_CATEGORIES: readonly LogCategory[] = [
  LOG_CATEGORY.Apex,
  LOG_CATEGORY.CodeUnit,
  LOG_CATEGORY.System,
  LOG_CATEGORY.Automation,
  LOG_CATEGORY.DML,
  LOG_CATEGORY.SOQL,
  LOG_CATEGORY.Callout,
  //NOTE: add Validation back once the parser is updated to include validation events
];

/**
 * Builds the legend entries, attaching per-category self time when known. The colour
 * comes from the caller so the legend reads the same palette the chart drew with —
 * `categoryPalette` answers for both the themes and the legacy colours.
 */
export function toTimelineKeys(
  color: (category: string) => string,
  selfTimes?: Map<LogCategory, number>,
): TimelineKeyEntry[] {
  return KEY_CATEGORIES.map((category) => ({
    label: category,
    fillColor: color(category),
    // A category the log never used still reads 0 — an absent time means "unknown", not "none".
    selfTimeNs: selfTimes ? (selfTimes.get(category) ?? 0) : undefined,
  }));
}
