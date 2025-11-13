/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */

/**
 * TimelineEventIndex
 *
 * Spatial index for fast event lookup during mouse interactions.
 * Uses hierarchical binary search with depth-first traversal.
 */

import type { LogEvent } from '../../../core/log-parser/LogEvents.js';
import type { ViewportBounds, ViewportState } from '../types/timeline.types.js';

export class TimelineEventIndex {
  private rootEvents: LogEvent[];
  private _maxDepth: number;
  private _totalDuration: number;

  constructor(events: LogEvent[]) {
    this.rootEvents = events;
    this._maxDepth = this.calculateMaxDepth(events);
    this._totalDuration = this.calculateTotalDuration(events);
  }

  /**
   * Get maximum call stack depth.
   */
  public get maxDepth(): number {
    return this._maxDepth;
  }

  /**
   * Get total timeline duration in nanoseconds.
   */
  public get totalDuration(): number {
    return this._totalDuration;
  }

  /**
   * Find the event at a specific screen position.
   *
   * Uses binary search on sorted event arrays + depth-first traversal.
   * Based on existing Canvas2D implementation (Timeline.ts:588-634).
   *
   * @param screenX - X coordinate relative to canvas
   * @param screenY - Y coordinate relative to canvas (NOT YET INVERTED)
   * @param viewport - Current viewport state
   * @param targetDepth - Target depth level to search
   * @param shouldIgnoreWidth - Whether to ignore minimum width threshold
   * @returns Event at position, or null if none found
   */
  public findEventAtPosition(
    screenX: number,
    screenY: number,
    viewport: ViewportState,
    targetDepth: number,
    shouldIgnoreWidth: boolean = false,
  ): LogEvent | null {
    return this.binarySearchAtDepth(
      this.rootEvents,
      0,
      screenX,
      targetDepth,
      viewport,
      shouldIgnoreWidth,
    );
  }

  /**
   * Find all events intersecting a viewport region (for culling).
   *
   * @param bounds - Viewport bounds to query
   * @returns Array of events in region
   */
  public findEventsInRegion(bounds: ViewportBounds): LogEvent[] {
    const results: LogEvent[] = [];
    this.collectEventsInRegion(this.rootEvents, 0, bounds, results);
    return results;
  }

  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================

  /**
   * Binary search for event at specific depth level.
   * Recursive implementation matching Canvas2D Timeline.ts logic.
   */
  private binarySearchAtDepth(
    events: LogEvent[],
    currentDepth: number,
    screenX: number,
    targetDepth: number,
    viewport: ViewportState,
    shouldIgnoreWidth: boolean,
  ): LogEvent | null {
    if (!events || events.length === 0) {
      return null;
    }

    let start = 0;
    let end = events.length - 1;

    while (start <= end) {
      const mid = Math.floor((start + end) / 2);
      const event = events[mid];

      if (!event || !event.duration) {
        break;
      }

      // Convert event time to screen space
      const eventScreenX = event.timestamp * viewport.zoom - viewport.offsetX;
      const eventWidth = event.duration.total * viewport.zoom;
      const eventScreenEnd = eventScreenX + eventWidth;

      // Check if cursor is over this event (horizontally)
      const isInRange =
        (shouldIgnoreWidth || eventWidth >= 0.05) &&
        eventScreenX <= screenX &&
        eventScreenEnd >= screenX;

      const isMatchingDepth = currentDepth === targetDepth;

      if (isInRange && isMatchingDepth && event.duration.total > 0) {
        return event;
      } else if (isInRange && !isMatchingDepth && event.children && event.children.length > 0) {
        // Recursively search children (depth-first)
        return this.binarySearchAtDepth(
          event.children,
          currentDepth + 1,
          screenX,
          targetDepth,
          viewport,
          shouldIgnoreWidth,
        );
      } else if (screenX > eventScreenEnd) {
        // Search right half
        start = mid + 1;
      } else if (screenX < eventScreenX) {
        // Search left half
        end = mid - 1;
      } else {
        return null;
      }
    }

    return null;
  }

  /**
   * Recursively collect all events within viewport bounds.
   */
  private collectEventsInRegion(
    events: LogEvent[],
    currentDepth: number,
    bounds: ViewportBounds,
    results: LogEvent[],
  ): void {
    for (const event of events) {
      if (!event.duration) {
        continue;
      }

      // Check horizontal overlap
      const eventTimeStart = event.timestamp;
      const eventTimeEnd = event.exitStamp ?? event.timestamp;
      const horizontalOverlap = eventTimeStart < bounds.timeEnd && eventTimeEnd > bounds.timeStart;

      // Check vertical overlap
      const verticalOverlap = currentDepth >= bounds.depthStart && currentDepth <= bounds.depthEnd;

      if (horizontalOverlap && verticalOverlap) {
        results.push(event);
      }

      // Recurse into children
      if (event.children && event.children.length > 0) {
        this.collectEventsInRegion(event.children, currentDepth + 1, bounds, results);
      }
    }
  }

  /**
   * Calculate maximum nesting depth.
   * Based on Timeline.ts:168-186.
   */
  private calculateMaxDepth(events: LogEvent[]): number {
    let maxDepth = 0;
    let currentLevel = events.filter((n) => n.duration && n.children.length);

    while (currentLevel.length) {
      maxDepth++;
      const nextLevel: LogEvent[] = [];
      for (const node of currentLevel) {
        for (const child of node.children) {
          if (child.duration && child.children.length) {
            nextLevel.push(child);
          }
        }
      }
      currentLevel = nextLevel;
    }

    return maxDepth;
  }

  /**
   * Calculate total timeline duration.
   */
  private calculateTotalDuration(events: LogEvent[]): number {
    if (events.length === 0) {
      return 0;
    }

    let maxExitStamp = 0;
    const len = events.length - 1;
    for (let i = len; i >= 0; i--) {
      const event = events[i];
      if (!event) {
        continue;
      }
      const exitStamp = event.exitStamp ?? event.timestamp;
      if (exitStamp <= maxExitStamp) {
        break;
      }
      maxExitStamp = exitStamp;
    }
    return maxExitStamp;
  }
}
