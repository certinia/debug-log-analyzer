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

/**
 * Highlight colors with alpha values for true transparency.
 */
export interface HighlightColors {
  /** Source color (0xRRGGBB) - extracted from CSS variables */
  sourceColor: number;
}

/**
 * Minimum visible highlight width in pixels.
 * Small events are expanded to this width for visibility.
 */
export const MIN_HIGHLIGHT_WIDTH = 6;

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
    const centeredX = screenX + screenWidth / 2 - MIN_HIGHLIGHT_WIDTH / 2;
    graphics.rect(centeredX, y, MIN_HIGHLIGHT_WIDTH, height);
  } else {
    graphics.rect(screenX + halfGap, y, screenWidth - TIMELINE_CONSTANTS.RECT_GAP, height);
  }
  graphics.fill({ color, alpha });
}

/**
 * Render a highlight rectangle with true alpha transparency.
 * Creates a "yellow glass" tint effect where the frame color shows through.
 *
 * For small events (< MIN_HIGHLIGHT_WIDTH):
 * - More opaque fill for visibility (0.6 alpha)
 *
 * For normal events:
 * - Semi-transparent overlay (0.3 alpha) + border (0.9 alpha)
 *
 * @param graphics - PixiJS Graphics to draw to
 * @param timestamp - Event start time in nanoseconds
 * @param duration - Event duration in nanoseconds
 * @param depth - Event depth (0-indexed)
 * @param viewport - Current viewport state
 * @param colors - Highlight colors (source color only, alpha applied during render)
 */
export function renderHighlight(
  graphics: PIXI.Graphics,
  timestamp: number,
  duration: number,
  depth: number,
  viewport: ViewportState,
  colors: HighlightColors,
): void {
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

  if (isNarrow) {
    return;
  }

  // Border at FULL bounds (before gap adjustment) so stroke extends outside
  // Canvas strokes are center-aligned: half inside, half outside the path
  // With 2px stroke at full bounds, the border extends 1px outside the rectangle
  // This matches Chrome DevTools selection highlight behavior
  graphics.rect(
    timestamp * viewport.zoom,
    depth * TIMELINE_CONSTANTS.EVENT_HEIGHT,
    screenWidth,
    TIMELINE_CONSTANTS.EVENT_HEIGHT,
  );
  graphics.stroke({
    width: 2,
    color: colors.sourceColor,
    alpha: 0.9,
  });
}

/**
 * Create highlight colors from a resolved PixiJS color value.
 *
 * @param findMatchBackground - Resolved find match color (0xRRGGBB)
 * @returns Highlight colors (source color only)
 */
export function createHighlightColors(findMatchBackground: number): HighlightColors {
  return {
    sourceColor: findMatchBackground,
  };
}

/**
 * Default highlight color used when no editor colors are provided.
 */
export const DEFAULT_FIND_MATCH_COLOR = 0xea5c00;
