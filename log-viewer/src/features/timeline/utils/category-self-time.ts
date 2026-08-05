/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { LOG_CATEGORY, type ApexLog, type LogCategory, type LogEvent } from 'apex-log-parser';

import type { TimelineKeyEntry } from '../components/TimelineKey.js';
import type { TimelineColors } from '../themes/Themes.js';

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

/** Legend order; labels double as the `LogCategory` keys used by `categorySelfTimes`. */
const KEY_CATEGORIES: readonly { category: LogCategory; colorKey: keyof TimelineColors }[] = [
  { category: LOG_CATEGORY.Apex, colorKey: 'apex' },
  { category: LOG_CATEGORY.CodeUnit, colorKey: 'codeUnit' },
  { category: LOG_CATEGORY.System, colorKey: 'system' },
  { category: LOG_CATEGORY.Automation, colorKey: 'automation' },
  { category: LOG_CATEGORY.DML, colorKey: 'dml' },
  { category: LOG_CATEGORY.SOQL, colorKey: 'soql' },
  { category: LOG_CATEGORY.Callout, colorKey: 'callout' },
  //NOTE: add Validation back once the parser is updated to include validation events
];

/** Builds the legend entries for a palette, attaching per-category self time when known. */
export function toTimelineKeys(
  colors: TimelineColors,
  selfTimes?: Map<LogCategory, number>,
): TimelineKeyEntry[] {
  return KEY_CATEGORIES.map(({ category, colorKey }) => ({
    label: category,
    fillColor: colors[colorKey],
    // A category the log never used still reads 0 — an absent time means "unknown", not "none".
    selfTimeNs: selfTimes ? (selfTimes.get(category) ?? 0) : undefined,
  }));
}
