/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * MarkerProcessor
 *
 * Shared utilities for processing timeline markers (truncation regions).
 * Consolidates pre-blended color computation and marker processing logic
 * used by both MeshMarkerRenderer and TimelineMarkerRenderer.
 */

import type { MarkerType, TimelineMarker } from '../../types/flamechart.types.js';
import { MARKER_ALPHA, MARKER_COLORS, SEVERITY_RANK } from '../../types/flamechart.types.js';
import { blendWithBackground } from '../BucketColorResolver.js';

/**
 * Pre-blended opaque marker colors (MARKER_COLORS blended at MARKER_ALPHA opacity).
 * Computed once at module load time for performance.
 *
 * Using pre-blended colors avoids runtime alpha compositing on the GPU,
 * which is more efficient for static opacity values.
 */
export const MARKER_COLORS_BLENDED: Record<MarkerType, number> = {
  error: blendWithBackground(MARKER_COLORS.error, MARKER_ALPHA),
  skip: blendWithBackground(MARKER_COLORS.skip, MARKER_ALPHA),
  unexpected: blendWithBackground(MARKER_COLORS.unexpected, MARKER_ALPHA),
};

/**
 * Sort markers by startTime, then by severity (higher severity first for stacking).
 *
 * @param markers - Array of markers to sort
 * @returns New sorted array (does not mutate input)
 */
export function sortMarkersByTimeAndSeverity(
  markers: readonly TimelineMarker[],
): readonly TimelineMarker[] {
  return [...markers].sort((a, b) => {
    if (a.startTime !== b.startTime) {
      return a.startTime - b.startTime;
    }
    return SEVERITY_RANK[b.type] - SEVERITY_RANK[a.type];
  });
}
