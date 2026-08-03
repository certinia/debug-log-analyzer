/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

/**
 * Unit tests for wheelZoomFactor — the shared wheel→zoom mapping used by the
 * main flame chart, minimap, and metric-strip wheel handlers. Covers the
 * cross-platform properties that motivated the shared helper (#853 follow-up):
 * direction, always-positive factor, in/out symmetry, per-event clamping, and
 * deltaMode normalization.
 */
import { describe, expect, it } from '@jest/globals';

import { wheelZoomFactor } from '../ViewportUtils.js';

describe('wheelZoomFactor', () => {
  it('zooms in (factor > 1) on scroll up and out (factor < 1) on scroll down', () => {
    expect(wheelZoomFactor(-10, 0)).toBeGreaterThan(1);
    expect(wheelZoomFactor(10, 0)).toBeLessThan(1);
  });

  it('returns 1 for a zero delta', () => {
    expect(wheelZoomFactor(0, 0)).toBe(1);
  });

  it('is always positive, even for an extreme delta', () => {
    // Old linear formula (1 + delta*0.001) went <= 0 at deltaY >= 1000.
    expect(wheelZoomFactor(100000, 0)).toBeGreaterThan(0);
    expect(wheelZoomFactor(-100000, 0)).toBeGreaterThan(0);
  });

  it('is symmetric: zooming in then out by the same delta returns to the start', () => {
    const zoomIn = wheelZoomFactor(-40, 0);
    const zoomOut = wheelZoomFactor(40, 0);
    expect(zoomIn * zoomOut).toBeCloseTo(1, 10);
  });

  it('clamps the per-event delta so large deltas saturate to the same factor', () => {
    // Beyond the clamp (±120), factor no longer grows with delta.
    const atCap = wheelZoomFactor(-120, 0);
    const wayOverCap = wheelZoomFactor(-5000, 0);
    expect(wayOverCap).toBeCloseTo(atCap, 10);
    // And a Windows-sized notch (~100) is close to, but under, the cap.
    expect(wheelZoomFactor(-100, 0)).toBeLessThan(atCap);
  });

  it('normalizes line mode (deltaMode 1) larger than pixel mode', () => {
    // Small line deltas map to a bigger step than the same pixel value.
    expect(wheelZoomFactor(-3, 1)).toBeGreaterThan(wheelZoomFactor(-3, 0));
    // A line delta of 8 (×15 = 120) reaches the clamp.
    expect(wheelZoomFactor(-8, 1)).toBeCloseTo(wheelZoomFactor(-120, 0), 10);
  });

  it('normalizes page mode (deltaMode 2) to the clamp for any real page delta', () => {
    // A single page delta (×800) always saturates the clamp.
    expect(wheelZoomFactor(-1, 2)).toBeCloseTo(wheelZoomFactor(-120, 0), 10);
  });

  it('scales the step by sensitivity', () => {
    const base = wheelZoomFactor(-50, 0, 1);
    const sensitive = wheelZoomFactor(-50, 0, 2);
    // Doubling sensitivity squares the multiplier (exponential mapping).
    expect(sensitive).toBeCloseTo(base * base, 10);
  });
});
