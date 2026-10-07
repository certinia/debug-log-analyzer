/**
 * @jest-environment jsdom
 */

/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

import { describe, expect, it, jest } from '@jest/globals';
import { MinimapRenderer } from '../minimap/MinimapRenderer.js';
import { colorToGreyscale } from '../rendering/ColorUtils.js';

const APEX = 0x2d7ff9;
const SOQL = 0x4caf50;
const batchColors = new Map([
  ['Apex', { color: APEX }],
  ['SOQL', { color: SOQL }],
]);

/** The colour of each skyline bar, after drawing one Apex column and one SOQL column. */
function drawSkyline(lit?: ReadonlySet<string>): number[] {
  const minimap = Object.create(MinimapRenderer.prototype) as MinimapRenderer;
  const internals = minimap as unknown as Record<string, unknown>;
  const writeBar = jest.fn();
  internals['litCategories'] = new Set();
  internals['axisRenderer'] = { getHeight: () => 10 };
  internals['skylineBarGeometry'] = {
    setDisplayDimensions: jest.fn(),
    ensureCapacity: jest.fn(),
    setDrawCount: jest.fn(),
    writeBar,
  };
  if (lit) {
    minimap.setLitCategories(lit);
  }

  const manager = { getState: () => ({ displayWidth: 2 }), getHeight: () => 60 };
  const column = (dominantCategory: string) => ({ eventCount: 5, maxDepth: 1, dominantCategory });
  (
    internals['renderSkyline'] as (
      manager: unknown,
      densityData: unknown,
      batchColors: unknown,
      height: number,
    ) => void
  ).call(
    minimap,
    manager,
    { buckets: [column('Apex'), column('SOQL')], globalMaxDepth: 1 },
    batchColors,
    60,
  );

  return writeBar.mock.calls.map((call) => call[5] as number);
}

describe('MinimapRenderer lit categories', () => {
  it('draws every column in its colour with nothing lit', () => {
    expect(drawSkyline()).toEqual([APEX, SOQL]);
  });

  it('greys the columns another category tops', () => {
    expect(drawSkyline(new Set(['SOQL']))).toEqual([colorToGreyscale(APEX), SOQL]);
  });

  it('asks for the cached texture to be redrawn', () => {
    const minimap = Object.create(MinimapRenderer.prototype) as MinimapRenderer;
    const internals = minimap as unknown as Record<string, unknown>;
    internals['litCategories'] = new Set();
    internals['staticDirty'] = false;

    minimap.setLitCategories(new Set(['SOQL']));

    expect(internals['staticDirty']).toBe(true);
  });

  it('keeps the cached texture for the same categories, as every frame passes them', () => {
    const minimap = Object.create(MinimapRenderer.prototype) as MinimapRenderer;
    const internals = minimap as unknown as Record<string, unknown>;
    internals['litCategories'] = new Set(['SOQL']);
    internals['staticDirty'] = false;

    minimap.setLitCategories(new Set(['SOQL']));

    expect(internals['staticDirty']).toBe(false);
  });
});
