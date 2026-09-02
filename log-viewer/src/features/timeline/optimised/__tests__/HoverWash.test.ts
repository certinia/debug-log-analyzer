/**
 * @jest-environment jsdom
 */

/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * The hover wash: a fill under the pointer, and no outline — the outline belongs to the
 * selection, so the two read apart when both are on screen.
 */

import { describe, expect, it } from '@jest/globals';
import { Graphics } from 'pixi.js';
import { TIMELINE_CONSTANTS, type ViewportState } from '../../types/flamechart.types.js';
import { renderHighlight, renderWash } from '../rendering/HighlightRenderer.js';

const viewport: ViewportState = {
  zoom: 1,
  offsetX: 0,
  offsetY: 0,
  displayWidth: 800,
  displayHeight: 300,
} as ViewportState;

/** The actions the graphics recorded, in order. */
function actions(graphics: Graphics): string[] {
  return graphics.context.instructions.map((instruction) => instruction.action);
}

describe('renderWash', () => {
  it('fills without stroking, unlike the selection highlight', () => {
    const wash = new Graphics();
    renderWash(wash, 0, 100, 0, viewport, 0xffffff, 0.12);

    expect(actions(wash)).toEqual(['fill']);

    // The selection over the same frame strokes as well.
    const selection = new Graphics();
    renderHighlight(selection, 0, 100, 0, viewport, { sourceColor: 0xffffff });
    expect(actions(selection)).toContain('stroke');
  });

  it('covers the frame it is washing, gapped as the frame is drawn', () => {
    const wash = new Graphics();
    renderWash(wash, 200, 100, 2, viewport, 0xffffff, 0.12);

    const gap = TIMELINE_CONSTANTS.RECT_GAP;
    const bounds = wash.context.bounds;
    expect(bounds.minX).toBeCloseTo(200 + gap / 2);
    expect(bounds.maxX).toBeCloseTo(200 + 100 - gap / 2);
    expect(bounds.minY).toBeCloseTo(2 * TIMELINE_CONSTANTS.EVENT_HEIGHT + gap / 2);
  });

  // A frame thinner than a few pixels still has to show a hover.
  it('widens a frame too thin to see', () => {
    const wash = new Graphics();
    renderWash(wash, 500, 0.5, 0, viewport, 0xffffff, 0.12);

    const bounds = wash.context.bounds;
    expect(bounds.maxX - bounds.minX).toBeGreaterThanOrEqual(6);
  });
});
