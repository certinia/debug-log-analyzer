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
 * shows. A frame spanning the view from edge to edge keeps its place: it fills
 * the screen either way, so centring its midpoint would only lose the reader's
 * bearings. One merely wider than the view still moves, or a frame showing a
 * sliver at the edge would never be brought in.
 */
function revealPanAxes(
  bounds: ViewportBounds,
  timestamp: number,
  duration: number,
  depth: number,
): ViewportPanAxes {
  const frameEnd = timestamp + duration;
  const fullyVisible = timestamp >= bounds.timeStart && frameEnd <= bounds.timeEnd;
  const fillsTheView = timestamp <= bounds.timeStart && frameEnd >= bounds.timeEnd;

  return {
    time: !fullyVisible && !fillsTheView,
    depth: depth < bounds.depthStart || depth > bounds.depthEnd,
  };
}

/** Where a frame sits, as the reveal policy reads it. */
export interface FramePlacement {
  timestamp: number;
  duration: number;
  depth: number;
}

/** The frame to bring into view, and the axes to centre it on. */
export interface RevealTarget {
  frame: FramePlacement;
  axes: ViewportPanAxes;
}

/**
 * Which frame a reveal should bring into view - of several, the one nearest the
 * middle of what is on screen - or null when one of them is already there. A row
 * that merges occurrences names no single frame, so the view moves without
 * selecting: the mark on every occurrence is what says where they all are.
 */
export function revealTarget(
  bounds: ViewportBounds,
  frames: readonly FramePlacement[],
): RevealTarget | null {
  const middle = (bounds.timeStart + bounds.timeEnd) / 2;
  let nearest: RevealTarget | null = null;
  let shortest = Infinity;

  for (const frame of frames) {
    const axes = revealPanAxes(bounds, frame.timestamp, frame.duration, frame.depth);
    if (!axes.time && !axes.depth) {
      return null;
    }

    const distance = Math.abs(frame.timestamp + frame.duration / 2 - middle);
    if (distance < shortest) {
      shortest = distance;
      nearest = { frame, axes };
    }
  }

  return nearest;
}
