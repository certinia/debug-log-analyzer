/**
 * @jest-environment jsdom
 */

/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * The source colour is the host theme's, and several themes give it a grey close to the frames
 * around a highlight. The halo is what keeps the highlight readable there: it takes the tone the
 * source colour does not, so one of the two always reads against what is under them.
 */

import { describe, expect, it } from '@jest/globals';
import { Graphics } from 'pixi.js';
import { makeViewport } from '../../../../__tests__/helpers/viewport.js';
import { TIMELINE_CONSTANTS } from '../../types/flamechart.types.js';
import {
  createHighlightColors,
  MIN_HIGHLIGHT_WIDTH,
  renderHighlight,
} from '../rendering/HighlightRenderer.js';

const viewport = makeViewport({ displayWidth: 800, displayHeight: 300 });

/** The colours the graphics was told to stroke with, in order: the halo, then the border. */
function strokeColors(graphics: Graphics): number[] {
  return graphics.context.instructions
    .filter((instruction) => instruction.action === 'stroke')
    .map((instruction) => (instruction.data as { style: { color: number } }).style.color);
}

describe('the halo around a highlight', () => {
  // #515c6a and #a8ac94: the greys Dark+ and Light+ give `editor.findMatchBackground`.
  it('goes light behind a dark source colour', () => {
    const graphics = new Graphics();
    renderHighlight(graphics, 0, 100, 0, viewport, createHighlightColors(0x515c6a));

    expect(strokeColors(graphics)).toEqual([0xffffff, 0x515c6a]);
  });

  it('goes dark behind a light source colour', () => {
    const graphics = new Graphics();
    renderHighlight(graphics, 0, 100, 0, viewport, createHighlightColors(0xa8ac94));

    expect(strokeColors(graphics)).toEqual([0x000000, 0xa8ac94]);
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
