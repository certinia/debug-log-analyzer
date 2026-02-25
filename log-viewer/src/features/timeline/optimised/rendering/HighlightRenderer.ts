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

import * as PIXI from 'pixi.js';
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
  // Calculate screen position from event data and current viewport
  const screenX = timestamp * viewport.zoom;
  const screenWidth = duration * viewport.zoom;
  const screenY = depth * TIMELINE_CONSTANTS.EVENT_HEIGHT;
  const screenHeight = TIMELINE_CONSTANTS.EVENT_HEIGHT;

  // Pre-calculate gap values (must match rectangle rendering in EventBatchRenderer)
  const halfGap = TIMELINE_CONSTANTS.RECT_GAP / 2;
  const gappedHeight = screenHeight - TIMELINE_CONSTANTS.RECT_GAP;

  // Calculate event center point (always accurate regardless of zoom)
  const eventCenterX = screenX + screenWidth / 2;

  // Enforce minimum visible size for highlight
  const visibleWidth = Math.max(screenWidth, MIN_HIGHLIGHT_WIDTH);

  // Center the minimum-size highlight on the actual event position
  const centeredX = eventCenterX - visibleWidth / 2;

  // Calculate gapped dimensions to match rectangle rendering exactly
  // Rectangle renderer uses: x + halfGap, y + halfGap, width - gap, height - gap
  const gappedWidth = Math.max(2, screenWidth - TIMELINE_CONSTANTS.RECT_GAP);
  const rectX = screenX + halfGap;
  const rectY = screenY + halfGap;

  if (screenWidth < MIN_HIGHLIGHT_WIDTH) {
    // Small event: use minimum width, centered on event, more opaque for visibility
    graphics.rect(centeredX, rectY, visibleWidth, gappedHeight);
    graphics.fill({ color: colors.sourceColor, alpha: 0.6 });
  } else {
    // Normal event: overlay + border
    // Overlay fill with true alpha transparency (frame color shows through)
    // Uses gapped bounds to match rectangle rendering exactly
    graphics.rect(rectX, rectY, gappedWidth, gappedHeight);
    graphics.fill({ color: colors.sourceColor, alpha: 0.3 });

    // Border at FULL bounds (before gap adjustment) so stroke extends outside
    // Canvas strokes are center-aligned: half inside, half outside the path
    // With 2px stroke at full bounds, the border extends 1px outside the rectangle
    // This matches Chrome DevTools selection highlight behavior
    graphics.rect(screenX, screenY, screenWidth, screenHeight);
    graphics.stroke({
      width: 2,
      color: colors.sourceColor,
      alpha: 0.9,
    });
  }
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
