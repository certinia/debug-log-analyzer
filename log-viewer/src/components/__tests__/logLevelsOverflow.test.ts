/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { computeVisibleCount } from '../logLevelsOverflow.js';

describe('computeVisibleCount', () => {
  const widths = [50, 50, 50]; // gap 10 → cumulative right edges: 50, 110, 170

  it('shows all chips (no reserve) when they all fit', () => {
    expect(computeVisibleCount(widths, 200, 10, 20)).toBe(3);
  });

  it('reserves space for the overflow control once something overflows', () => {
    // fits(150) = 2, but not all → recompute against 150 - reserve(20) = 130 → still 2
    expect(computeVisibleCount(widths, 150, 10, 20)).toBe(2);
    // a tighter reserve can drop another chip: fits(150)=2, fits(150-45=105)=2? 50,110>105 → 1
    expect(computeVisibleCount(widths, 150, 10, 45)).toBe(1);
  });

  it('can hide every chip when nothing fits', () => {
    expect(computeVisibleCount(widths, 40, 10, 20)).toBe(0);
  });

  it('handles a single chip and an empty list', () => {
    expect(computeVisibleCount([50], 100, 10, 20)).toBe(1);
    expect(computeVisibleCount([], 100, 10, 20)).toBe(0);
  });

  it('treats an exact fit as fitting (inclusive boundary)', () => {
    // cumulative for all three is exactly 170
    expect(computeVisibleCount(widths, 170, 10, 20)).toBe(3);
    // one px short → last chip overflows, reserve applies
    expect(computeVisibleCount(widths, 169, 10, 0)).toBe(2);
  });
});
