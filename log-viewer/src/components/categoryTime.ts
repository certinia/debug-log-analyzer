/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ApexLog } from 'apex-log-parser';

import type { LanaSettings } from '../features/settings/Settings.js';
import { LEGACY_CATEGORY_MAP } from '../features/timeline/services/Timeline.js';
import { addCustomThemes, getTheme } from '../features/timeline/themes/ThemeSelector.js';
import { CATEGORY_THEME_KEY, DEFAULT_THEME_NAME } from '../features/timeline/themes/Themes.js';

/** The bucket for events the parser leaves uncategorised. */
export const OTHER_CATEGORY = 'Other';

/** Neutral literal for {@link OTHER_CATEGORY} — no theme names it, and the
 *  palette is data, so it does not follow the host theme. */
const OTHER_COLOR = '#808080';

/** Memo of {@link categorySelfTimes}: the chart re-renders on every hover, but
 *  the tree never changes after parse, so the walk runs once per log. */
const selfTimesCache = new WeakMap<ApexLog, CategoryTime[]>();

export interface CategoryTime {
  category: string;
  /** Summed self time (ns) — each nanosecond of the log lands in exactly one
   *  category, so the slices always total the log's own duration. */
  selfTime: number;
}

/**
 * Self time per category over the whole log, largest first. Empty buckets are
 * dropped, and events with no category land in {@link OTHER_CATEGORY}.
 * Iterative: the tree's size is unbounded.
 */
export function categorySelfTimes(root: ApexLog): CategoryTime[] {
  const cached = selfTimesCache.get(root);
  if (cached) {
    return cached;
  }
  const totals = new Map<string, number>();
  const stack = [...root.children];
  while (stack.length) {
    const event = stack.pop()!; // non-empty: the loop condition just checked

    const category = event.category || OTHER_CATEGORY;
    totals.set(category, (totals.get(category) ?? 0) + event.duration.self);
    for (const child of event.children) {
      stack.push(child);
    }
  }
  const slices = [...totals]
    .filter(([, selfTime]) => selfTime > 0)
    .map(([category, selfTime]) => ({ category, selfTime }))
    .sort((a, b) => b.selfTime - a.selfTime);
  selfTimesCache.set(root, slices);
  return slices;
}

/**
 * The flame chart's own colour for each category, resolved the way
 * `TimelineView` resolves it: the active theme (custom themes registered
 * first), or the legacy per-group colours when the legacy timeline is on. With
 * no settings yet (standalone host, or before the first push) the default
 * theme answers.
 */
export function categoryPalette(
  timeline: LanaSettings['timeline'] | null,
): (category: string) => string {
  if (timeline?.legacy) {
    return (category) => {
      const group = LEGACY_CATEGORY_MAP[category];
      return group ? timeline.colors[group] : OTHER_COLOR;
    };
  }
  if (timeline) {
    addCustomThemes(timeline.customThemes);
  }
  const colors = getTheme(timeline?.activeTheme ?? DEFAULT_THEME_NAME);
  return (category) => {
    const key = CATEGORY_THEME_KEY[category];
    return key ? colors[key] : OTHER_COLOR;
  };
}
