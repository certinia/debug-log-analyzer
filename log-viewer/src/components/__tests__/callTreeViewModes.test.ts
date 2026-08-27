/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';

import { defaultViewMode, directionOf, isViewMode } from '../callTreeViewModes.js';

describe('directionOf', () => {
  it('reads Bottom-Up as the callers direction and the rest as callees', () => {
    expect(directionOf('bottom-up')).toBe('callers');
    expect(directionOf('time-order')).toBe('callees');
    expect(directionOf('aggregated')).toBe('callees');
  });
});

describe('defaultViewMode', () => {
  it('answers a tab showing callees with where the time went', () => {
    expect(defaultViewMode('callees', false)).toBe('bottom-up');
    expect(defaultViewMode('callees', true)).toBe('bottom-up');
  });

  it('reads a merged selection as Aggregated, which is the rows it gets', () => {
    expect(defaultViewMode('callers', true)).toBe('aggregated');
    expect(defaultViewMode(undefined, true)).toBe('aggregated');
  });

  it('reads a single frame as Time Order', () => {
    expect(defaultViewMode('callers', false)).toBe('time-order');
    expect(defaultViewMode(undefined, false)).toBe('time-order');
  });
});

describe('isViewMode', () => {
  it('accepts the values the switch offers and nothing else', () => {
    expect(isViewMode('bottom-up')).toBe(true);
    expect(isViewMode('callers')).toBe(false);
  });
});
