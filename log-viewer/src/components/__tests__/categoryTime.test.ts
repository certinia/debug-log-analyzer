/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { describe, expect, it } from '@jest/globals';
import type { ApexLog } from 'apex-log-parser';

import type { LanaSettings } from '../../features/settings/Settings.js';
import { DEFAULT_THEME_NAME } from '../../features/timeline/themes/Themes.js';
import { getTheme } from '../../features/timeline/themes/ThemeSelector.js';
import { categoryPalette, categorySelfTimes, OTHER_CATEGORY } from '../categoryTime.js';

interface FakeEvent {
  category: string;
  duration: { total: number; self: number };
  children: FakeEvent[];
}

const ev = (category: string, self: number, children: FakeEvent[] = []): FakeEvent => ({
  category,
  duration: { total: self + children.reduce((sum, c) => sum + c.duration.total, 0), self },
  children,
});

const log = (children: FakeEvent[]) => ({ children }) as unknown as ApexLog;

const timelineSettings = (
  overrides: Partial<LanaSettings['timeline']> = {},
): LanaSettings['timeline'] => ({
  activeTheme: DEFAULT_THEME_NAME,
  colors: {
    Method: '#111111',
    'Code Unit': '#222222',
    'System Method': '#333333',
    Workflow: '#444444',
    DML: '#555555',
    SOQL: '#666666',
  },
  customThemes: {},
  legacy: false,
  showTooltip: true,
  ...overrides,
});

describe('categorySelfTimes', () => {
  it('sums self time per category over the whole tree, largest first', () => {
    const root = log([
      ev('Apex', 100, [ev('SOQL', 500), ev('Apex', 50)]),
      ev('DML', 200, [ev('Apex', 25)]),
    ]);

    expect(categorySelfTimes(root)).toEqual([
      { category: 'SOQL', selfTime: 500 },
      { category: 'DML', selfTime: 200 },
      { category: 'Apex', selfTime: 175 },
    ]);
  });

  it('buckets uncategorised events under Other and drops empty categories', () => {
    const root = log([ev('', 40), ev('Apex', 0), ev('System', 10)]);

    expect(categorySelfTimes(root)).toEqual([
      { category: OTHER_CATEGORY, selfTime: 40 },
      { category: 'System', selfTime: 10 },
    ]);
  });

  it('memoises per log, returning the same array for the same tree', () => {
    const root = log([ev('Apex', 100)]);

    expect(categorySelfTimes(root)).toBe(categorySelfTimes(root));
  });
});

describe('categoryPalette', () => {
  it('resolves the active theme colours when the legacy timeline is off', () => {
    const color = categoryPalette(
      timelineSettings({
        activeTheme: 'Mine',
        customThemes: {
          Mine: {
            apex: '#a1a1a1',
            codeUnit: '#b2b2b2',
            system: '#c3c3c3',
            automation: '#d4d4d4',
            dml: '#e5e5e5',
            soql: '#f6f6f6',
            callout: '#171717',
            validation: '#282828',
          },
        },
      }),
    );

    expect(color('Apex')).toBe('#a1a1a1');
    expect(color('Code Unit')).toBe('#b2b2b2');
    expect(color('SOQL')).toBe('#f6f6f6');
  });

  it('resolves the legacy group colours when the legacy timeline is on', () => {
    const color = categoryPalette(timelineSettings({ legacy: true }));

    expect(color('Apex')).toBe('#111111'); // Method
    expect(color('Callout')).toBe('#111111'); // folded into Method
    expect(color('Validation')).toBe('#333333'); // folded into System Method
    expect(color('Automation')).toBe('#444444'); // Workflow
  });

  // The quick pick is never persisted, so its theme can arrive before any settings do.
  it('follows a previewed theme with no settings pushed yet', () => {
    const previewed = '50 Shades of Green Bright';
    const color = categoryPalette(null, previewed);

    expect(color('SOQL')).toBe(getTheme(previewed).soql);
    expect(color('SOQL')).not.toBe(getTheme(DEFAULT_THEME_NAME).soql);
  });

  it('falls back to the default theme with no settings, and grey for Other', () => {
    const color = categoryPalette(null);

    expect(color('SOQL')).toBe(getTheme(DEFAULT_THEME_NAME).soql);
    expect(color(OTHER_CATEGORY)).toBe('#808080');
  });
});
