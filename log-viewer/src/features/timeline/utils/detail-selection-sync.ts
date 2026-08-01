/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * Pure helpers for the timeline's half of the inspector selection sync. Kept
 * side-effect free so both directions can be unit tested without a PixiJS
 * flame chart instance.
 */
import type { DetailSelection } from '../../../core/events/EventBus.js';
import type { ViewportBounds } from '../types/flamechart.types.js';

/** The `detail:select` payload for a frame, or null when it carries no eventIndex. */
export function toDetailSelection(eventIndex: number | undefined): DetailSelection | null {
  return eventIndex === undefined ? null : { kind: 'event', eventIndex };
}

/** True when the frame falls outside the viewport in time or in depth. */
export function isFrameOffscreen(
  bounds: ViewportBounds,
  timestamp: number,
  duration: number,
  depth: number,
): boolean {
  const frameEnd = timestamp + duration;
  const inTimeRange = frameEnd >= bounds.timeStart && timestamp <= bounds.timeEnd;
  const inDepthRange = depth >= bounds.depthStart && depth <= bounds.depthEnd;
  return !(inTimeRange && inDepthRange);
}
