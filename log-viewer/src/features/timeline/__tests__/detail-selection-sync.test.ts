/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';

import { TimelineViewport } from '../optimised/TimelineViewport.js';
import { revealPanAxes, toDetailSelection } from '../utils/detail-selection-sync.js';

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

describe('revealPanAxes', () => {
  // 1000px over a 1,000,000ns log, zoomed to 100,000ns starting at 200,000.
  const viewport = new TimelineViewport(1000, 600, 1_000_000, 10);
  viewport.setZoom(0.01);
  viewport.setPan(2000, 0);
  const bounds = viewport.getBounds();

  it('leaves a frame that is wholly in view where it is', () => {
    expect(revealPanAxes(bounds, 250_000, 1_000, bounds.depthStart)).toEqual({
      time: false,
      depth: false,
    });
  });

  it('centres a frame clipped by the edge of the view', () => {
    expect(revealPanAxes(bounds, 299_000, 5_000, bounds.depthStart).time).toBe(true);
  });

  it('centres a frame that is off screen', () => {
    expect(revealPanAxes(bounds, 400_000, 1_000, bounds.depthStart).time).toBe(true);
  });

  // It covers the screen either way, so a move would only lose the reader's bearings.
  it('leaves a frame wider than the view where it is', () => {
    expect(revealPanAxes(bounds, 100_000, 500_000, bounds.depthStart).time).toBe(false);
  });

  it('centres a frame wider than the view that it does not reach', () => {
    expect(revealPanAxes(bounds, 400_000, 500_000, bounds.depthStart).time).toBe(true);
  });

  it('centres the depth on its own when only the depth is off screen', () => {
    expect(revealPanAxes(bounds, 250_000, 1_000, bounds.depthEnd + 1)).toEqual({
      time: false,
      depth: true,
    });
  });
});
