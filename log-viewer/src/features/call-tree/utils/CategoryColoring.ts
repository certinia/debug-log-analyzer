/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import type { RowComponent } from 'tabulator-tables';

import { stampRowPath } from '../../../components/locatedRow.js';
import { VSCodeExtensionMessenger } from '../../../core/messaging/VSCodeExtensionMessenger.js';
import { subscribeSettings, type LanaSettings } from '../../settings/Settings.js';
import { CATEGORY_THEME_KEY, DEFAULT_THEME_NAME } from '../../timeline/themes/Themes.js';
import { addCustomThemes, getTheme } from '../../timeline/themes/ThemeSelector.js';

/**
 * Single source of truth for the call-tree category colour strip, shared by every
 * view that renders the bottom-up/aggregated tables (Call Tree tabs + Analysis view).
 *
 * Each row points at one host theme var via the inherited `--row-cat-color` custom
 * property, so a theme switch only updates the host vars and rows re-resolve in place —
 * no Tabulator reformat, no scroll shift.
 */

/**
 * Tabulator `rowFormatter`: points a row at its category's host theme var. A row element
 * is bound to one data row for its lifetime, so the category never changes once set.
 */
export const categoryRowFormatter = (row: RowComponent): void => {
  const data = row.getData() as { originalData?: { category?: string } };
  const category = data.originalData?.category;
  const themeKey = category ? CATEGORY_THEME_KEY[category] : undefined;
  if (themeKey) {
    row.getElement().style.setProperty('--row-cat-color', `var(--ct-color-${themeKey})`);
  }
};

/** The `rowFormatter` for a view whose rows merge occurrences: the colour strip,
 *  plus the path id the inspector's mark finds the row by. */
export const groupedRowFormatter = (row: RowComponent): void => {
  categoryRowFormatter(row);
  stampRowPath(row);
};

function applyCategoryTheme(host: HTMLElement, themeName: string): void {
  const theme = getTheme(themeName);
  for (const [key, value] of Object.entries(theme)) {
    host.style.setProperty(`--ct-color-${key}`, value);
  }
}

/**
 * Wire category colouring onto a host element: seed the theme vars, follow live theme
 * switches, and toggle the colorize tint from settings. Call from `connectedCallback`
 * and call the returned function from `disconnectedCallback`. `onColorize` hears each
 * tint change, for content the host's class does not reach.
 */
export function wireCategoryColoring(
  host: HTMLElement,
  onColorize?: (on: boolean) => void,
): () => void {
  applyCategoryTheme(host, DEFAULT_THEME_NAME);

  const stopThemePreview = VSCodeExtensionMessenger.listen<{ activeTheme: string }>((event) => {
    const { cmd, payload } = event.data;
    if (cmd === 'switchTimelineTheme') {
      applyCategoryTheme(host, payload.activeTheme ?? DEFAULT_THEME_NAME);
    }
  });

  const apply = (settings: LanaSettings) => {
    const { timeline, callTree } = settings;
    addCustomThemes(timeline.customThemes);
    applyCategoryTheme(host, timeline.activeTheme ?? DEFAULT_THEME_NAME);
    const on = callTree?.categoryColorize ?? false;
    host.classList.toggle('category-colorize', on);
    onColorize?.(on);
  };

  const stopSettings = subscribeSettings(apply);

  return () => {
    stopThemePreview();
    stopSettings();
  };
}
