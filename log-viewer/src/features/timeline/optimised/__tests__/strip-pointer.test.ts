/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * Unit tests for the metric strip's collapse chevron hit area.
 */

import { describe, expect, it } from '@jest/globals';
import { chevronBox, isOverChevron } from '../metric-strip/strip-pointer.js';

describe('isOverChevron', () => {
  // The glyph is 5x10 collapsed and 10x5 expanded, drawn from x=6, y=2.5.
  it('covers the arrow that is drawn', () => {
    expect(isOverChevron(8, 7, true)).toBe(true);
    expect(isOverChevron(8, 5, false)).toBe(true);
  });

  it('does not claim the whole 20px toggle column', () => {
    // Past the collapsed arrow's right edge, still inside the column.
    expect(isOverChevron(17, 7, true)).toBe(false);
    // Below the expanded arrow, still inside the strip.
    expect(isOverChevron(8, 30, false)).toBe(false);
  });

  it('follows the arrow that the collapsed state draws', () => {
    // x=17 is inside the expanded arrow's reach but past the collapsed one's.
    expect(isOverChevron(17, 5, false)).toBe(true);
    expect(isOverChevron(17, 5, true)).toBe(false);
    // y=13 is inside the tall collapsed arrow but below the short expanded one.
    expect(isOverChevron(8, 13, true)).toBe(true);
    expect(isOverChevron(8, 13, false)).toBe(false);
  });
});

// The renderer draws inside this box, so the hit test cannot drift from the drawn arrow.
describe('chevronBox', () => {
  it('turns the arrow on its side when the strip expands', () => {
    const shut = chevronBox(true);
    const open = chevronBox(false);

    expect(shut.height).toBe(open.width);
    expect(shut.width).toBe(open.height);
    expect(shut.x).toBe(open.x);
    expect(shut.y).toBe(open.y);
  });

  it('stays inside the toggle column it shares with the click target', () => {
    for (const box of [chevronBox(true), chevronBox(false)]) {
      expect(box.x).toBeGreaterThan(0);
      expect(box.x + box.width).toBeLessThan(20);
    }
  });
});
