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

/**
 * A marker to lay out, in screen/world X pixels. Must be pre-sorted by `screenStartX`
 * ascending. `MarkerIndicator` is structurally assignable, so renderers can pass their
 * indicator array directly (no per-frame mapping allocation).
 */
export interface MarkerLayoutItem {
  screenStartX: number;
  /** Unclamped width in px (0 for a point marker such as an exception). */
  exactWidth: number;
  color: number;
  alpha: number;
}

/**
 * Duration of a marker's own range: `endTime - startTime` for a bounded marker (e.g. a
 * truncation), or `0` for a point marker (e.g. an exception, which has no `endTime`).
 *
 * This is the single source of truth for a marker's extent — used by the renderers, the
 * selection highlight, and zoom/centre. It intentionally does NOT extend to the next
 * marker (the old behaviour that over-shaded recovered regions and mis-zoomed).
 */
export function markerDuration(marker: Pick<TimelineMarker, 'startTime' | 'endTime'>): number {
  return (marker.endTime ?? marker.startTime) - marker.startTime;
}

/** A resolved rectangle to draw. */
export interface MarkerDrawRect {
  x: number;
  width: number;
  color: number;
  alpha: number;
}

/**
 * Resolves overlapping markers into drawable rectangles with a guaranteed gap.
 *
 * - Every drawn rectangle is at least `minWidth` wide.
 * - A point marker (`exactWidth < minWidth`, e.g. an exception hairline) within
 *   `bucketDistance` of the previous rectangle is dropped from the draw list — a dense
 *   cluster collapses to one line for a cleaner look. The caller keeps the full marker set
 *   for hit testing, so the dropped ones still contribute to the "N markers" tooltip count.
 * - A real band is shifted right by `gap` to preserve separation rather than dropped.
 *
 * @param items - Layout items pre-sorted by `startX` ascending
 * @param minWidth - Minimum rendered width in px
 * @param gap - Minimum gap in px between adjacent rectangles (band separation)
 * @param bucketDistance - Merge distance in px for point markers; defaults to `gap`
 */
export function layoutMarkerRects(
  items: readonly MarkerLayoutItem[],
  minWidth: number,
  gap: number,
  bucketDistance: number = gap,
): MarkerDrawRect[] {
  const rects: MarkerDrawRect[] = [];
  let lastEnd = -Infinity;

  for (const item of items) {
    const width = Math.max(item.exactWidth, minWidth);
    let x = item.screenStartX;
    const isPoint = item.exactWidth < minWidth;

    if (isPoint) {
      // A point within the merge distance of the previous rectangle buckets (skip drawing).
      if (x < lastEnd + bucketDistance) {
        continue;
      }
    } else if (x < lastEnd + gap) {
      // A real band — shift right so the gap is preserved.
      x = lastEnd + gap;
    }

    rects.push({ x, width, color: item.color, alpha: item.alpha });
    lastEnd = x + width;
  }

  return rects;
}
