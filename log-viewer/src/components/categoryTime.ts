/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ApexLog } from '@apexdevtools/apex-log-parser';
import { html, type ReactiveControllerHost, type TemplateResult } from 'lit';

import { SubscriptionController } from '../core/events/SubscriptionController.js';
import { walkEvents } from '../core/utility/EventTree.js';
import { subscribeSettings, type LanaSettings } from '../features/settings/Settings.js';
import { addCustomThemes, getTheme } from '../features/timeline/themes/ThemeSelector.js';
import { CATEGORY_THEME_KEY, DEFAULT_THEME_NAME } from '../features/timeline/themes/Themes.js';

/** The bucket for events the parser leaves uncategorised. */
export const OTHER_CATEGORY = 'Other';

/** The category's name to show, naming the bucket an empty one falls in. */
export function categoryName(category: string): string {
  return category || OTHER_CATEGORY;
}

/**
 * The row's category in text a screen reader can hear: the row shows it as the
 * meter's hue, which carries no meaning on its own. For a host that adopts
 * `revealRowStyles`.
 */
export function categoryLabel(category: string): TemplateResult {
  return html`<span class="reveal-row__sr">${categoryName(category)}</span>`;
}

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
  for (const event of walkEvents(root.children)) {
    const category = categoryName(event.category);
    totals.set(category, (totals.get(category) ?? 0) + event.duration.self);
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
 * `TimelineView` resolves it: the active theme, custom themes registered
 * first. With no settings yet (standalone host, or before the first push) the
 * default theme answers.
 * @param activeTheme - A previewed theme, which wins over the pushed one. Never
 * persisted, so it can arrive before any settings do.
 */
export function categoryPalette(
  timeline: LanaSettings['timeline'] | null,
  activeTheme?: string | null,
): (category: string) => string {
  if (timeline) {
    addCustomThemes(timeline.customThemes);
  }
  const colors = getTheme(activeTheme ?? timeline?.activeTheme ?? DEFAULT_THEME_NAME);
  return (category) => {
    const key = CATEGORY_THEME_KEY[category];
    return key ? colors[key] : OTHER_COLOR;
  };
}

/**
 * {@link categoryPalette} for a component, kept live: the host re-renders
 * whenever the timeline theme changes, so its swatches and meters follow the
 * flame chart without a reload.
 */
export class CategoryPaletteController {
  private _color = categoryPalette(null);

  constructor(host: ReactiveControllerHost) {
    new SubscriptionController(host, () => [
      subscribeSettings((settings) => {
        this._color = categoryPalette(settings.timeline);
        host.requestUpdate();
      }),
    ]);
  }

  /** The category's colour; uncategorised events read as {@link OTHER_CATEGORY}. */
  colorFor(category: string): string {
    return this._color(category);
  }
}
