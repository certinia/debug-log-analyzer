/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

import { DEFAULT_THEME_NAME, THEMES, type TimelineColors } from './themes.js';
const THEME_MAP = new Map<string, TimelineColors>(
  THEMES.map((theme) => [theme.name, theme.colors]),
);

const DEFAULT_THEME = THEME_MAP.get(DEFAULT_THEME_NAME)!;

export function getTheme(themeName: string): TimelineColors {
  // Merge with default to ensure all colors are present
  const theme = THEME_MAP.get(themeName) ?? {};
  return {
    ...getDefault(),
    ...Object.fromEntries(Object.entries(theme).filter(([_, v]) => v !== null && v !== undefined)),
  };
}

export function getDefault(): TimelineColors {
  return DEFAULT_THEME;
}

export function addCustomThemes(customThemes: { [key: string]: TimelineColors }): void {
  for (const [name, colors] of Object.entries(customThemes)) {
    // Skip if theme with this name already exists, avoid overriding built-in themes
    if (THEME_MAP.has(name)) {
      continue;
    }
    THEME_MAP.set(name, colors);
  }
}
