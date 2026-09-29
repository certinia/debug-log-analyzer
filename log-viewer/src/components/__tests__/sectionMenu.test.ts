/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';
import { html } from 'lit';

import type { PaneSection } from '../PaneView.js';
import { RESET_SECTIONS_ID, buildSectionMenuItems, sectionIdFor } from '../sectionMenu.js';

function sections(...ids: string[]): PaneSection[] {
  return ids.map((id) => ({ id, title: id.toUpperCase(), content: html`<div>${id}</div>` }));
}

describe('sectionIdFor', () => {
  it('reads the section off a section row', () => {
    expect(sectionIdFor('section:callstack')).toBe('callstack');
  });

  it('names no section for any other row', () => {
    expect(sectionIdFor(RESET_SECTIONS_ID)).toBeNull();
    expect(sectionIdFor('section-sep')).toBeNull();
  });
});

describe('buildSectionMenuItems', () => {
  it('heads the menu with the reset, then a row per section', () => {
    const items = buildSectionMenuItems(sections('vitals', 'calltree'), new Set(['calltree']));

    expect(items[0]).toEqual({ id: RESET_SECTIONS_ID, label: 'Reset Sections' });
    expect(items[1]?.separator).toBe(true);
    expect(items.slice(2).map((item) => [item.id, item.label, item.checked])).toEqual([
      ['section:vitals', 'VITALS', true],
      ['section:calltree', 'CALLTREE', false],
    ]);
  });

  it('keeps the menu open through a toggle, so several can be picked', () => {
    const items = buildSectionMenuItems(sections('vitals', 'calltree'), new Set());

    expect(items.slice(2).every((item) => item.keepOpen)).toBe(true);
  });

  it('will not untick the last section showing', () => {
    const items = buildSectionMenuItems(sections('vitals', 'calltree'), new Set(['calltree']));

    // Hiding it would leave no header to right-click, and no way back.
    expect(items[2]?.disabled).toBe(true);
    // A hidden row is always pickable: that is how it comes back.
    expect(items[3]?.disabled).toBe(false);
  });

  it('leaves every row pickable while more than one shows', () => {
    const items = buildSectionMenuItems(sections('vitals', 'calltree'), new Set());

    expect(items.slice(2).some((item) => item.disabled)).toBe(false);
  });
});
