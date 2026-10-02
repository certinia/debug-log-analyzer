/**
 * @jest-environment jsdom
 */

/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

import { describe, expect, it } from '@jest/globals';
import { Graphics } from 'pixi.js';
import { TIMELINE_CONSTANTS } from '../../types/flamechart.types.js';
import { makeViewport } from '#test-helpers/viewport.js';
import {
  createHighlightColors,
  MIN_HIGHLIGHT_WIDTH,
  renderHighlight,
  renderWash,
} from '../rendering/HighlightRenderer.js';

const viewport = makeViewport();

/** The actions the graphics recorded, in order. */
function actions(graphics: Graphics): string[] {
  return graphics.context.instructions.map((instruction) => instruction.action);
}

/** The colours the graphics was told to stroke with, in order: the halo, then the border. */
function strokeColors(graphics: Graphics): number[] {
  return graphics.context.instructions
    .filter((instruction) => instruction.action === 'stroke')
    .map((instruction) => (instruction.data as { style: { color: number } }).style.color);
}

/**
 * The source colour is the host theme's, and several themes give it a grey close to the frames
 * around a highlight. The halo is what keeps the highlight readable there: it takes the tone the
 * source colour does not, so one of the two always reads against what is under them.
 */
describe('the halo around a highlight', () => {
  // #515c6a and #a8ac94: the greys Dark+ and Light+ give `editor.findMatchBackground`.
  it.each([
    ['light behind a dark', 0x515c6a, 0xffffff],
    ['dark behind a light', 0xa8ac94, 0x000000],
  ])('goes %s source colour', (_name, source, halo) => {
    const graphics = new Graphics();
    renderHighlight(graphics, 0, 100, 0, viewport, createHighlightColors(source));

    expect(strokeColors(graphics)).toEqual([halo, source]);
  });

  it('borders a frame too thin to border at the width the wash widened it to', () => {
    const graphics = new Graphics();
    renderHighlight(graphics, 500, 0.5, 0, viewport, createHighlightColors(0xea5c00));

    // Was a wash alone: a hairline the reader could step to and not find.
    expect(strokeColors(graphics)).toHaveLength(2);
    const bounds = graphics.context.bounds;
    expect(bounds.maxX - bounds.minX).toBeGreaterThanOrEqual(MIN_HIGHLIGHT_WIDTH);
    expect(bounds.maxY - bounds.minY).toBeGreaterThanOrEqual(TIMELINE_CONSTANTS.EVENT_HEIGHT);
  });
});

/**
 * The hover wash: a fill under the pointer, and no outline — the outline belongs to the
 * selection, so the two read apart when both are on screen.
 */
describe('renderWash', () => {
  it('fills without stroking, unlike the selection highlight', () => {
    const wash = new Graphics();
    renderWash(wash, 0, 100, 0, viewport, 0xffffff, 0.12);

    expect(actions(wash)).toEqual(['fill']);

    // The selection over the same frame strokes as well.
    const selection = new Graphics();
    renderHighlight(selection, 0, 100, 0, viewport, createHighlightColors(0xffffff));
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
