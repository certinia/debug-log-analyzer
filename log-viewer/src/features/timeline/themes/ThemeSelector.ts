/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

import { DEFAULT_THEME, THEMES, type TimelineColors } from './Themes.js';

// Create a map for O(1) theme lookups
const THEME_MAP = new Map<string, TimelineColors>(
  THEMES.map((theme) => [theme.name, theme.colors]),
);

export function getTheme(themeName: string): TimelineColors {
  return THEME_MAP.get(themeName) ?? getDefault();
}

export function getDefault(): TimelineColors {
  return THEME_MAP.get(DEFAULT_THEME)!;
}
