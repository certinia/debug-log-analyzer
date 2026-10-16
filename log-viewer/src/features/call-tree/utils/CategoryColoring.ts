/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import { VSCodeExtensionMessenger } from '../../../core/messaging/VSCodeExtensionMessenger.js';
import { subscribeSettings, type LanaSettings } from '../../settings/Settings.js';
import { DEFAULT_THEME_NAME } from '../../timeline/themes/Themes.js';
import { addCustomThemes, getTheme } from '../../timeline/themes/ThemeSelector.js';

/**
 * Single source of truth for the category colour strip. The Call Tree and Analysis views
 * share `wireCategoryColoring`.
 *
 * Each row points at one host theme var via the inherited `--row-cat-color` custom
 * property, so a theme switch only updates the host vars and rows re-resolve in place —
 * no row rebuild, no scroll shift.
 */

function applyCategoryTheme(host: HTMLElement, themeName: string): void {
  const theme = getTheme(themeName);
  for (const [key, value] of Object.entries(theme)) {
    host.style.setProperty(`--ct-color-${key}`, value);
  }
}

/**
 * Wire category colouring onto a host element: seed the theme vars, follow live theme
 * switches, and report the colorize tint from settings to `onColorize`. Call from
 * `connectedCallback` and call the returned function from `disconnectedCallback`.
 */
export function wireCategoryColoring(
  host: HTMLElement,
  onColorize: (on: boolean) => void,
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
    onColorize(callTree?.categoryColorize ?? false);
  };

  const stopSettings = subscribeSettings(apply);

  return () => {
    stopThemePreview();
    stopSettings();
  };
}
