/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * Pure helpers for the timeline's half of the inspector selection sync. Kept
 * side-effect free so both directions can be unit tested without a PixiJS
 * flame chart instance.
 */
import type { DetailSelection } from '../../../core/events/EventBus.js';
import type { ViewportBounds, ViewportPanAxes } from '../types/flamechart.types.js';

/** The `detail:select` payload for a frame, or null when it carries no eventIndex. */
export function toDetailSelection(eventIndex: number | undefined): DetailSelection | null {
  return eventIndex === undefined ? null : { kind: 'event', eventIndex };
}

/**
 * Which axes a reveal should centre the frame on, given what the view already
 * shows. A frame wider than the view keeps its place: it covers the screen
 * either way, so centring its midpoint would only lose the reader's bearings.
 */
export function revealPanAxes(
  bounds: ViewportBounds,
  timestamp: number,
  duration: number,
  depth: number,
): ViewportPanAxes {
  const frameEnd = timestamp + duration;
  const fullyVisible = timestamp >= bounds.timeStart && frameEnd <= bounds.timeEnd;
  const fits = duration <= bounds.timeEnd - bounds.timeStart;
  const overlaps = frameEnd >= bounds.timeStart && timestamp <= bounds.timeEnd;

  return {
    time: !fullyVisible && (fits || !overlaps),
    depth: depth < bounds.depthStart || depth > bounds.depthEnd,
  };
}
