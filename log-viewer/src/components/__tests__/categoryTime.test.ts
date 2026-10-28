/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { describe, expect, it } from '@jest/globals';

import { rawStoreOf } from '#test-helpers/apexLog.js';
import type { LanaSettings } from '../../features/settings/Settings.js';
import { DEFAULT_THEME_NAME } from '../../features/timeline/themes/Themes.js';
import { getTheme } from '../../features/timeline/themes/ThemeSelector.js';
import { selfTimeByCategory } from '../../features/timeline/utils/category-self-time.js';
import { categoryPalette, categorySelfTimes, OTHER_CATEGORY } from '../categoryTime.js';

const timelineSettings = (
  overrides: Partial<LanaSettings['timeline']> = {},
): LanaSettings['timeline'] => ({
  activeTheme: DEFAULT_THEME_NAME,
  customThemes: {},
  showTooltip: true,
  ...overrides,
});

describe('categorySelfTimes', () => {
  it('sums self time per category over the whole tree, largest first', async () => {
    // Apex 100 holding SOQL 500 and Apex 50, then DML 200 holding Apex 25.
    const { store } = await rawStoreOf(
      [
        '(0)|METHOD_ENTRY|[1]|01p|A.a()',
        '(100)|SOQL_EXECUTE_BEGIN|[1]|Aggregations:0|SELECT Id FROM Account',
        '(600)|SOQL_EXECUTE_END|[1]|Rows:0',
        '(600)|METHOD_ENTRY|[1]|01p|A.b()',
        '(650)|METHOD_EXIT|[1]|A.b()',
        '(650)|METHOD_EXIT|[1]|A.a()',
        '(650)|DML_BEGIN|[1]|Op:Insert|Type:Account|Rows:1',
        '(850)|METHOD_ENTRY|[1]|01p|A.c()',
        '(875)|METHOD_EXIT|[1]|A.c()',
        '(875)|DML_END|[1]',
      ]
        .map((line) => `09:18:22.6 ${line}\n`)
        .join(''),
    );

    expect(categorySelfTimes(selfTimeByCategory(await store.logIndex()))).toEqual([
      { category: 'SOQL', selfTime: 500 },
      { category: 'DML', selfTime: 200 },
      { category: 'Apex', selfTime: 175 },
    ]);
  });

  it('buckets uncategorised time under Other and drops empty categories', () => {
    const selfTimes = new Map([
      ['', 40],
      ['Apex', 0],
      ['System', 10],
    ]);

    expect(categorySelfTimes(selfTimes)).toEqual([
      { category: OTHER_CATEGORY, selfTime: 40 },
      { category: 'System', selfTime: 10 },
    ]);
  });
});

describe('categoryPalette', () => {
  it('resolves the active theme colours', () => {
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
