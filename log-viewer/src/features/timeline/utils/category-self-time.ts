/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { LOG_CATEGORY, type ApexLog, type LogCategory, type LogEvent } from 'apex-log-parser';

import type { TimelineKeyEntry } from '../components/TimelineKey.js';
import type { LegacyTimelineGroup } from '../services/Timeline.js';

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

/** One legend chip: what it is called, and the categories whose self time it sums. */
interface KeyGroup {
  label: string;
  /** Never empty — the first member is what resolves the chip's colour. */
  members: readonly [LogCategory, ...LogCategory[]];
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
 * The legacy chart's own key: the six groups it draws, in that order, each naming the
 * categories it folds. Several categories share a group there — Apex and Callout are
 * both `Method` — so the legend must fold them, or it names one colour twice and names
 * it something the chart's key never says.
 *
 * Must agree with `LEGACY_CATEGORY_MAP`, which maps the same pairs the other way.
 * Stated rather than inverted from it: the draw order and the non-empty membership are
 * both facts a derivation loses, and inverting it would pull the canvas service — and
 * the `window` it reads as it loads — into this module.
 */
const LEGACY_GROUPS: readonly (KeyGroup & { label: LegacyTimelineGroup })[] = [
  { label: 'Method', members: ['Apex', 'Callout'] },
  { label: 'Code Unit', members: ['Code Unit'] },
  { label: 'System Method', members: ['System', 'Validation'] },
  { label: 'Workflow', members: ['Automation'] },
  { label: 'DML', members: ['DML'] },
  { label: 'SOQL', members: ['SOQL'] },
];

/**
 * Builds the legend entries, attaching per-group self time when known. The colour comes
 * from the caller so the legend reads the same palette the chart drew with —
 * `categoryPalette` answers for both the themes and the legacy colours.
 * @param legacy - True to key the legacy chart, whose groups differ from the categories.
 */
export function toTimelineKeys(
  color: (category: string) => string,
  selfTimes?: Map<LogCategory, number>,
  legacy = false,
): TimelineKeyEntry[] {
  const groups: readonly KeyGroup[] = legacy
    ? LEGACY_GROUPS
    : KEY_CATEGORIES.map((category) => ({ label: category, members: [category] as const }));

  return groups.map(({ label, members }) => ({
    label,
    categories: members,
    // Any member resolves to the group's colour, which is what makes the fold safe.
    fillColor: color(members[0]),
    // A category the log never used still reads 0 — an absent time means "unknown", not "none".
    selfTimeNs: selfTimes
      ? members.reduce((sum, category) => sum + (selfTimes.get(category) ?? 0), 0)
      : undefined,
  }));
}
