/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { LOG_CATEGORY, type LogCategory } from '@apexdevtools/apex-log-parser';

import { type LogIndex, sumSelfBy } from '../../../core/log/LogIndex.js';

import type { TimelineKeyEntry } from '../components/TimelineKey.js';

/**
 * Self time (ns) per category name, `''` for uncategorised, from one pass over the
 * index's columns. Self time partitions the wall clock, so the sums add up to the
 * log duration with no double counting.
 */
export function selfTimeByCategory(index: LogIndex): ReadonlyMap<string, number> {
  const sums = sumSelfBy(index, index.categoryId, index.categoryNames.length, null);
  return new Map(index.categoryNames.map((name, id) => [name, sums[id]!]));
}

/** Legend order; the labels double as the `LogCategory` keys `selfTimeByCategory` sums by. */
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
 * Builds the legend entries, attaching per-category self time when known. The colour comes
 * from the caller so the legend reads the same palette the chart drew with.
 */
export function toTimelineKeys(
  color: (category: string) => string,
  selfTimes?: ReadonlyMap<string, number>,
): TimelineKeyEntry[] {
  return KEY_CATEGORIES.map((category) => ({
    category,
    fillColor: color(category),
    // A category the log never used still reads 0 — an absent time means "unknown", not "none".
    selfTimeNs: selfTimes ? (selfTimes.get(category) ?? 0) : undefined,
  }));
}
