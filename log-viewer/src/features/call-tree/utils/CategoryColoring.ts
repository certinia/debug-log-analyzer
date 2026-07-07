/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import { css } from 'lit';
import type { RowComponent } from 'tabulator-tables';

import { VSCodeExtensionMessenger } from '../../../core/messaging/VSCodeExtensionMessenger.js';
import { getSettings } from '../../settings/Settings.js';
import { DEFAULT_THEME_NAME, type TimelineColors } from '../../timeline/themes/Themes.js';
import { addCustomThemes, getTheme } from '../../timeline/themes/ThemeSelector.js';

/**
 * Single source of truth for the call-tree category colour strip, shared by every
 * view that renders the bottom-up/aggregated tables (Call Tree tabs + Analysis view).
 *
 * Each row points at one host theme var via the inherited `--row-cat-color` custom
 * property, so a theme switch only updates the host vars and rows re-resolve in place —
 * no Tabulator reformat, no scroll shift.
 */

// Maps a LogEvent.category string to its TimelineColors key, so a row can point at the
// matching `--ct-color-<key>` host variable. Single source of truth for the set.
const CATEGORY_THEME_VAR: Readonly<Record<string, keyof TimelineColors>> = {
  Apex: 'apex',
  System: 'system',
  'Code Unit': 'codeUnit',
  Automation: 'automation',
  DML: 'dml',
  SOQL: 'soql',
  Validation: 'validation',
  Callout: 'callout',
};

export const categoryColoringStyles = css`
  .tabulator-row .datagrid-code-text {
    border-left: 6px solid var(--row-cat-color, transparent);
  }
  :host(.category-colorize) .tabulator-row .datagrid-code-text {
    background-color: color-mix(in srgb, var(--row-cat-color, transparent) 10%, transparent);
    color: var(--row-cat-color, inherit);
  }
`;

/**
 * Tabulator `rowFormatter`: points a row at its category's host theme var. A row element
 * is bound to one data row for its lifetime, so the category never changes once set.
 */
export const categoryRowFormatter = (row: RowComponent): void => {
  const data = row.getData() as { originalData?: { category?: string } };
  const category = data.originalData?.category;
  const themeKey = category ? CATEGORY_THEME_VAR[category] : undefined;
  if (themeKey) {
    row.getElement().style.setProperty('--row-cat-color', `var(--ct-color-${themeKey})`);
  }
};

function applyCategoryTheme(host: HTMLElement, themeName: string): void {
  const theme = getTheme(themeName);
  for (const [key, value] of Object.entries(theme)) {
    host.style.setProperty(`--ct-color-${key}`, value);
  }
}

/**
 * Wire category colouring onto a host element: seed the theme vars, follow live theme
 * switches, and toggle the colorize tint from settings. Call from `connectedCallback`.
 */
export function wireCategoryColoring(host: HTMLElement): void {
  applyCategoryTheme(host, DEFAULT_THEME_NAME);

  VSCodeExtensionMessenger.listen<{ activeTheme: string }>((event) => {
    const { cmd, payload } = event.data;
    if (cmd === 'switchTimelineTheme') {
      applyCategoryTheme(host, payload.activeTheme ?? DEFAULT_THEME_NAME);
    }
  });

  getSettings().then((settings) => {
    const { timeline, callTree } = settings;
    addCustomThemes(timeline.customThemes);
    applyCategoryTheme(host, timeline.activeTheme ?? DEFAULT_THEME_NAME);
    host.classList.toggle('category-colorize', callTree?.categoryColorize ?? false);
  });
}
