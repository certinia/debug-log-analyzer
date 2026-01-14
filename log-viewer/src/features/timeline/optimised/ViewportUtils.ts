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
