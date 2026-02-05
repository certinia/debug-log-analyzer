/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

/**
 * MarkerHitTest
 *
 * Shared utility for hit testing timeline markers.
 * Used by TimelineMarkerRenderer and MeshMarkerRenderer.
 */

import type { TimelineMarker } from '../../types/flamechart.types.js';
import { SEVERITY_RANK } from '../../types/flamechart.types.js';

/**
 * Internal representation of a marker indicator's visual state.
 * Used for hit testing against rendered markers.
 */
export interface MarkerIndicator {
  marker: TimelineMarker;
  resolvedEndTime: number;
  screenStartX: number;
  screenEndX: number;
  screenWidth: number;
  color: number;
  isVisible: boolean;
}

/**
 * Tests if a screen coordinate intersects any marker indicator.
 *
 * Used for hover detection. Returns marker with highest severity when multiple overlap.
 *
 * Algorithm:
 * 1. Convert screen X to world X using viewport offset
 * 2. Iterate through visible indicators (already culled during render)
 * 3. Check AABB collision: worldX falls within [screenStartX, screenEndX]
 * 4. Sort matches by severity rank (error > unexpected > skip)
 * 5. Return highest priority marker, or null if no hits
 *
 * @param screenX - Mouse X coordinate in pixels (canvas-relative)
 * @param offsetX - Viewport horizontal offset in pixels
 * @param indicators - Array of visible marker indicators
 * @returns Marker under cursor (highest severity if multiple), or null if no hit
 */
export function hitTestMarkers(
  screenX: number,
  offsetX: number,
  indicators: readonly MarkerIndicator[],
): TimelineMarker | null {
  // Convert screen coordinates to world coordinates
  // Container is positioned at -offsetX, so add offsetX to convert screen to world
  const worldX = screenX + offsetX;

  // Collect all indicators under cursor
  const hits: TimelineMarker[] = [];

  for (const indicator of indicators) {
    // AABB collision test: check if world X coordinate falls within indicator bounds
    if (worldX >= indicator.screenStartX && worldX <= indicator.screenEndX) {
      hits.push(indicator.marker);
    }
  }

  // No hits
  if (hits.length === 0) {
    return null;
  }

  // Single hit - return immediately
  if (hits.length === 1) {
    return hits[0]!;
  }

  // Multiple hits - return highest severity
  hits.sort((a, b) => SEVERITY_RANK[b.type] - SEVERITY_RANK[a.type]);
  return hits[0]!;
}
