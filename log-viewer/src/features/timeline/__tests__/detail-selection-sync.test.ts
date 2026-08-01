/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';

import { TimelineViewport } from '../optimised/TimelineViewport.js';
import { isFrameOffscreen, toDetailSelection } from '../utils/detail-selection-sync.js';

describe('toDetailSelection', () => {
  it('builds an event selection from an eventIndex', () => {
    expect(toDetailSelection(7)).toEqual({ kind: 'event', eventIndex: 7 });
  });

  it('keeps index 0, which is a real event and not "missing"', () => {
    expect(toDetailSelection(0)).toEqual({ kind: 'event', eventIndex: 0 });
  });

  it('returns null when there is no eventIndex to select', () => {
    expect(toDetailSelection(undefined)).toBeNull();
  });
});

describe('isFrameOffscreen', () => {
  const viewport = new TimelineViewport(1000, 600, 1_000_000, 10);
  const bounds = viewport.getBounds();

  it('reports a frame inside both ranges as on screen', () => {
    expect(isFrameOffscreen(bounds, bounds.timeStart, 1_000, bounds.depthStart)).toBe(false);
  });

  it('reports a frame after the visible time range as off screen', () => {
    expect(isFrameOffscreen(bounds, bounds.timeEnd + 1_000, 1_000, bounds.depthStart)).toBe(true);
  });

  it('reports a frame before the visible time range as off screen', () => {
    expect(isFrameOffscreen(bounds, bounds.timeStart - 5_000, 1_000, bounds.depthStart)).toBe(true);
  });

  it('reports a frame below the visible depth range as off screen', () => {
    expect(isFrameOffscreen(bounds, bounds.timeStart, 1_000, bounds.depthEnd + 1)).toBe(true);
  });
});
