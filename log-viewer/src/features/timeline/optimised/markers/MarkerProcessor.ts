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

import type { TimelineMarker } from '../../types/flamechart.types.js';
import { SEVERITY_RANK } from '../../types/flamechart.types.js';

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
