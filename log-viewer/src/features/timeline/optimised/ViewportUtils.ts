/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

/**
 * ViewportUtils
 *
 * Shared utility functions for viewport calculations used by both
 * TemporalSegmentTree and LegacyViewportCuller implementations.
 */

import type { ViewportBounds, ViewportState } from '../types/flamechart.types.js';
import { TIMELINE_CONSTANTS } from '../types/flamechart.types.js';

/**
 * Calculate viewport bounds for culling.
 * Converts viewport state to time/depth ranges for efficient overlap checks.
 *
 * @param viewport - Current viewport state
 * @returns Culling bounds in timeline coordinates
 */
export function calculateViewportBounds(viewport: ViewportState): ViewportBounds {
  const { zoom, offsetX, offsetY, displayWidth, displayHeight } = viewport;
  const { EVENT_HEIGHT } = TIMELINE_CONSTANTS;

  // Time bounds
  const timeStart = offsetX / zoom;
  const timeEnd = (offsetX + displayWidth) / zoom;

  // World Y coordinates of visible region
  // With scale.y = -1 flip and container.y = screen.height - offsetY:
  // Screen renders worldY in range [-offsetY, screen.height - offsetY]
  const worldYBottom = -offsetY; // Visible at screen bottom (lower depths)
  const worldYTop = -offsetY + displayHeight; // Visible at screen top (higher depths)

  // Convert to depth levels (depth 0 is at worldY = 0)
  // An event at depth D occupies worldY = [D * HEIGHT, (D+1) * HEIGHT]
  const depthStart = Math.floor(worldYBottom / EVENT_HEIGHT);
  const depthEnd = Math.floor(worldYTop / EVENT_HEIGHT);

  return {
    timeStart,
    timeEnd,
    depthStart,
    depthEnd,
  };
}

/**
 * Upper bound on the per-event normalized wheel delta (~one WHEEL_DELTA mouse
 * notch). Windows mouse notches report a far larger deltaY than a macOS
 * trackpad, so clamping keeps a single notch/gesture to a consistent, bounded
 * zoom step across platforms and prevents fast scrolls from jumping.
 */
const MAX_WHEEL_DELTA = 120;

/**
 * Map a wheel event to a zoom multiplier, shared by every timeline wheel
 * handler (main flame chart, minimap, metric strip) so zoom feel is identical.
 *
 * Exponential so zoom-in and zoom-out of equal magnitude are reciprocal (no
 * drift when scrolling in then out) and the factor is always > 0; the delta is
 * clamped so one large event can't produce a jarring jump or a sign flip.
 *
 * @param deltaY - Raw WheelEvent.deltaY (positive = scroll down = zoom out).
 * @param deltaMode - WheelEvent.deltaMode (0 pixel, 1 line, 2 page).
 * @param sensitivity - Multiplier on the zoom step. Default 1.
 * @returns Zoom multiplier to apply to the current zoom (>0; 1 = no change).
 */
export function wheelZoomFactor(deltaY: number, deltaMode: number, sensitivity = 1): number {
  // Scroll up (negative deltaY) zooms in (factor > 1).
  let delta = -deltaY;
  if (deltaMode === 1) {
    delta *= 15; // lines → approx pixels
  } else if (deltaMode === 2) {
    delta *= 800; // pages → approx pixels
  }
  delta = Math.max(-MAX_WHEEL_DELTA, Math.min(MAX_WHEEL_DELTA, delta));
  return Math.exp(delta * 0.001 * sensitivity);
}
