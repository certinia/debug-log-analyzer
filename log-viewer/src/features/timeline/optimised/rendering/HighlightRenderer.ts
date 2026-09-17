/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * HighlightRenderer - Shared highlight drawing utility
 *
 * Used by both SearchHighlightRenderer and SelectionHighlightRenderer
 * to ensure consistent visual appearance. Uses true alpha transparency
 * to create a "yellow glass" tint effect where frame colors show through.
 */

import type * as PIXI from 'pixi.js';
import { TIMELINE_CONSTANTS, type ViewportState } from '../../types/flamechart.types.js';
import { isLightBackground } from './ColorUtils.js';

/**
 * Highlight colors with alpha values for true transparency.
 */
export interface HighlightColors {
  /** Source color (0xRRGGBB) - extracted from CSS variables */
  sourceColor: number;
  /** The halo's tone: whichever of black and white the source colour is not. */
  haloColor: number;
}

/**
 * Minimum visible highlight width in pixels.
 * Small events are expanded to this width for visibility.
 */
export const MIN_HIGHLIGHT_WIDTH = 6;

const HALO_DARK = 0x000000;
const HALO_LIGHT = 0xffffff;

/** The halo is an edge, not a colour of its own, so it stays under the border it separates. */
const HALO_ALPHA = 0.55;

/** Width of the halo and of the border. Both are hairlines: the pair is the edge. */
const EDGE_WIDTH = 1;

/** Where a frame too thin to see starts once widened to {@link MIN_HIGHLIGHT_WIDTH}. */
function widenedX(screenX: number, screenWidth: number): number {
  return screenX + screenWidth / 2 - MIN_HIGHLIGHT_WIDTH / 2;
}

/**
 * Wash a frame: one fill over the frame's own gapped bounds.
 *
 * A frame thinner than {@link MIN_HIGHLIGHT_WIDTH} widens to it, centred on the frame, so a
 * sub-pixel frame can still be seen.
 *
 * @param graphics - PixiJS Graphics to draw to
 * @param timestamp - Event start time in nanoseconds
 * @param duration - Event duration in nanoseconds
 * @param depth - Event depth (0-indexed)
 * @param viewport - Current viewport state
 * @param color - Wash color (0xRRGGBB)
 * @param alpha - Wash alpha
 */
export function renderWash(
  graphics: PIXI.Graphics,
  timestamp: number,
  duration: number,
  depth: number,
  viewport: ViewportState,
  color: number,
  alpha: number,
): void {
  const screenX = timestamp * viewport.zoom;
  const screenWidth = duration * viewport.zoom;

  // Must match rectangle rendering in EventBatchRenderer: x + halfGap, width - gap.
  const halfGap = TIMELINE_CONSTANTS.RECT_GAP / 2;
  const y = depth * TIMELINE_CONSTANTS.EVENT_HEIGHT + halfGap;
  const height = TIMELINE_CONSTANTS.EVENT_HEIGHT - TIMELINE_CONSTANTS.RECT_GAP;

  if (screenWidth < MIN_HIGHLIGHT_WIDTH) {
    graphics.rect(widenedX(screenX, screenWidth), y, MIN_HIGHLIGHT_WIDTH, height);
  } else {
    graphics.rect(screenX + halfGap, y, screenWidth - TIMELINE_CONSTANTS.RECT_GAP, height);
  }
  graphics.fill({ color, alpha });
}

/**
 * Render a highlight rectangle with true alpha transparency.
 * Creates a "yellow glass" tint effect where the frame color shows through.
 *
 * An overlay (0.3 alpha, 0.6 for an event under {@link MIN_HIGHLIGHT_WIDTH}), a border, and a
 * halo outside it, so both the search and the selection highlight keep an edge whatever the
 * theme makes the source colour and whatever the frames around them are coloured.
 *
 * @param graphics - PixiJS Graphics to draw to
 * @param timestamp - Event start time in nanoseconds
 * @param duration - Event duration in nanoseconds
 * @param depth - Event depth (0-indexed)
 * @param viewport - Current viewport state
 * @param colors - The source colour and the halo's tone; alpha is applied during render
 */
export function renderHighlight(
  graphics: PIXI.Graphics,
  timestamp: number,
  duration: number,
  depth: number,
  viewport: ViewportState,
  colors: HighlightColors,
): void {
  const screenX = timestamp * viewport.zoom;
  const screenWidth = duration * viewport.zoom;
  const isNarrow = screenWidth < MIN_HIGHLIGHT_WIDTH;

  renderWash(
    graphics,
    timestamp,
    duration,
    depth,
    viewport,
    colors.sourceColor,
    isNarrow ? 0.6 : 0.3,
  );

  // The edge sits on the frame's own gapped bounds, the rect the wash covers, so a highlight
  // never reaches into the rows above and below. Canvas strokes are centre-aligned, so the
  // halo's outer half falls in the gap between frames and the border sits wholly inside.
  //
  // A frame too thin to carry a border takes the width the wash widened to, so the highlight
  // is a bordered block rather than a hairline.
  const halfGap = TIMELINE_CONSTANTS.RECT_GAP / 2;
  const x = isNarrow ? widenedX(screenX, screenWidth) : screenX + halfGap;
  const width = isNarrow ? MIN_HIGHLIGHT_WIDTH : screenWidth - TIMELINE_CONSTANTS.RECT_GAP;
  const y = depth * TIMELINE_CONSTANTS.EVENT_HEIGHT + halfGap;
  const height = TIMELINE_CONSTANTS.EVENT_HEIGHT - TIMELINE_CONSTANTS.RECT_GAP;

  // Themes take the source colour from `editor.findMatchBackground`, which several of them
  // give a grey no further from the frames around the highlight than its own border is. The
  // halo takes the outside, where the frames it has to be told apart from are.
  graphics.rect(x, y, width, height);
  graphics.stroke({ width: EDGE_WIDTH, color: colors.haloColor, alpha: HALO_ALPHA });

  graphics.rect(x + EDGE_WIDTH, y + EDGE_WIDTH, width - EDGE_WIDTH * 2, height - EDGE_WIDTH * 2);
  graphics.stroke({
    width: EDGE_WIDTH,
    color: colors.sourceColor,
    alpha: 0.9,
  });
}

/**
 * Create highlight colors from a resolved PixiJS color value.
 *
 * @param findMatchBackground - Resolved find match color (0xRRGGBB)
 * @returns Highlight colors, with the halo's tone resolved against the source colour
 */
export function createHighlightColors(findMatchBackground: number): HighlightColors {
  return {
    sourceColor: findMatchBackground,
    // Here, not per draw: the tone only changes with the theme.
    haloColor: isLightBackground(findMatchBackground) ? HALO_DARK : HALO_LIGHT,
  };
}

/**
 * Default highlight color used when no editor colors are provided.
 */
export const DEFAULT_FIND_MATCH_COLOR = 0xea5c00;
