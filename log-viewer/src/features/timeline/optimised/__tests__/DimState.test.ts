/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';

import type { MatchSpan } from '../../types/search.types.js';
import { DimState } from '../DimState.js';

const SPANS: MatchSpan[] = [{ timeStart: 0, depth: 0, category: 'Apex' }];

function dimState(search = false): DimState {
  return new DimState(() => search);
}

describe('DimState', () => {
  it('draws the chart normally with nothing asked for', () => {
    const dim = dimState();

    expect(dim.chart()).toBeNull();
    expect(dim.legendShowing()).toBe(false);
    expect(dim.minimapCategories()).toEqual(new Set());
  });

  it("shows the legend's categories", () => {
    const dim = dimState();
    const lit = new Set(['SOQL']);

    dim.setCategories(lit);

    expect(dim.chart()).toEqual({ rows: new Set(), spans: [], categories: lit });
    expect(dim.legendShowing()).toBe(true);
    expect(dim.minimapCategories()).toBe(lit);
  });

  it("lets the inspector's emphasis outrank the legend, on the minimap too", () => {
    const dim = dimState();
    const rows = new Set([1]);
    dim.setCategories(new Set(['SOQL']));

    dim.setEmphasis(rows, SPANS);

    expect(dim.chart()).toEqual({ rows, spans: SPANS, categories: new Set() });
    expect(dim.legendShowing()).toBe(false);
    expect(dim.minimapCategories()).toEqual(new Set());
  });

  it('lets a search outrank both, even one with no matches', () => {
    const dim = dimState(true);
    dim.setCategories(new Set(['SOQL']));
    dim.setEmphasis(new Set([1]), SPANS);

    expect(dim.chart()).toBe('search');
    expect(dim.legendShowing()).toBe(false);
    expect(dim.minimapCategories()).toEqual(new Set());
  });

  it('brings the legend back once the emphasis drops', () => {
    const dim = dimState();
    dim.setCategories(new Set(['SOQL']));
    dim.setEmphasis(new Set([1]), SPANS);

    dim.setEmphasis(new Set(), []);

    expect(dim.legendShowing()).toBe(true);
  });

  it('reports a change only when the members change', () => {
    const dim = dimState();

    expect(dim.setCategories(new Set(['SOQL']))).toBe(true);
    expect(dim.setCategories(new Set(['SOQL']))).toBe(false);
    expect(dim.setEmphasis(new Set([1]), SPANS)).toBe(true);
    expect(dim.setEmphasis(new Set([1]), SPANS)).toBe(false);
  });

  it('answers the same dim each frame, so the render loop allocates nothing', () => {
    const dim = dimState();
    dim.setCategories(new Set(['SOQL']));

    expect(dim.chart()).toBe(dim.chart());
  });
});
