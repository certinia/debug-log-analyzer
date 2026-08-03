/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import { addCustomThemes, getTheme } from '../ThemeSelector.js';
import { DEFAULT_THEME_NAME, type TimelineColors } from '../Themes.js';

const colors = (apex: string): TimelineColors => ({
  apex,
  codeUnit: '#88AE58',
  system: '#8D6E63',
  automation: '#4B9D6E',
  dml: '#DC6363',
  soql: '#A554B2',
  callout: '#DD8A3C',
  validation: '#4A90B7',
});

describe('ThemeSelector', () => {
  it('registers a custom theme', () => {
    addCustomThemes({ 'my theme': colors('#111111') });

    expect(getTheme('my theme').apex).toBe('#111111');
  });

  it('replaces a custom theme when it is pushed again', () => {
    addCustomThemes({ 'edited theme': colors('#222222') });
    addCustomThemes({ 'edited theme': colors('#333333') });

    expect(getTheme('edited theme').apex).toBe('#333333');
  });

  it('does not overwrite a built-in theme', () => {
    const original = getTheme(DEFAULT_THEME_NAME).apex;
    addCustomThemes({ [DEFAULT_THEME_NAME]: colors('#444444') });

    expect(getTheme(DEFAULT_THEME_NAME).apex).toBe(original);
  });
});
