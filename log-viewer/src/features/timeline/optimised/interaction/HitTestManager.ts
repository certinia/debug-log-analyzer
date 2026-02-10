/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

/**
 * HitTestManager
 *
 * Handles hit detection for mouse interactions on the timeline.
 * Determines which event, bucket, or marker is under the mouse cursor.
 *
 * Priority order for hit detection:
 * 1. Visible rectangles from the last render pass
 * 2. Events from the event index
 * 3. Buckets (aggregated sub-pixel events)
 * 4. Timeline markers (only if not over events/buckets)
 */

import {
  BUCKET_CONSTANTS,
  type EventNode,
  type LogEvent,
  type PixelBucket,
  type TimelineMarker,
  type ViewportBounds,
  type ViewportState,
} from '../../types/flamechart.types.js';
import type { PrecomputedRect, RectangleManager } from '../RectangleManager.js';
import type { TimelineEventIndex } from '../TimelineEventIndex.js';

/**
 * Interface for marker renderers that support hit testing.
 */
export interface MarkerHitTestable {
  hitTest(screenX: number, screenY: number): TimelineMarker | null;
}

/**
 * Result of a hit test operation.
 */
export interface HitTestResult {
  /** The event node at the hit position, if any */
  eventNode: EventNode | null;
  /** The marker at the hit position, if any (only set if no event/bucket) */
  marker: TimelineMarker | null;
  /** Whether the cursor is over an event or bucket area */
  isOverEventArea: boolean;
}

/**
 * Configuration for HitTestManager.
 */
export interface HitTestConfig {
  /** Event index for spatial queries */
  index: TimelineEventIndex;
  /** Current visible rectangles from last render pass */
  visibleRects: Map<string, PrecomputedRect[]>;
  /** Current buckets from last render pass */
  buckets: Map<string, PixelBucket[]>;
  /** Optional marker renderer for hit testing markers */
  markerRenderer?: MarkerHitTestable | null;
  /** Optional RectangleManager for O(log n) hit testing queries */
  rectangleManager?: RectangleManager | null;
}

export class HitTestManager {
  private index: TimelineEventIndex;
  private visibleRects: Map<string, PrecomputedRect[]>;
  private buckets: Map<string, PixelBucket[]>;
  private markerRenderer: MarkerHitTestable | null;
  private rectangleManager: RectangleManager | null;

  constructor(config: HitTestConfig) {
    this.index = config.index;
    this.visibleRects = config.visibleRects;
    this.buckets = config.buckets;
    this.markerRenderer = config.markerRenderer ?? null;
    this.rectangleManager = config.rectangleManager ?? null;
  }

  /**
   * Update visible rectangles from last render pass.
   */
  public setVisibleRects(rects: Map<string, PrecomputedRect[]>): void {
    this.visibleRects = rects;
  }

  /**
   * Update buckets from last render pass.
   */
  public setBuckets(buckets: Map<string, PixelBucket[]>): void {
    this.buckets = buckets;
  }

  /**
   * Update marker renderer reference.
   */
  public setMarkerRenderer(renderer: MarkerHitTestable | null): void {
    this.markerRenderer = renderer;
  }

  /**
   * Perform hit test at screen coordinates.
   *
   * @param screenX - Mouse X coordinate in screen space
   * @param screenY - Mouse Y coordinate in screen space
   * @param depth - Depth level at the Y position
   * @param viewport - Current viewport state
   * @param maxDepth - Maximum depth in the timeline
   * @returns Hit test result with eventNode, marker, and area info
   */
  public hitTest(
    screenX: number,
    screenY: number,
    depth: number,
    viewport: ViewportState,
    maxDepth: number,
  ): HitTestResult {
    // Check if depth is within valid bounds (0 to maxDepth)
    const isValidDepth = depth >= 0 && depth <= maxDepth;

    let logEvent: LogEvent | null = null;
    let isOverEventArea = false;

    if (isValidDepth) {
      // Priority 1: Check visible rectangles from last render (in sync with display)
      logEvent = this.findVisibleRectAtPosition(screenX, depth, viewport);

      // Priority 2: If no visible rect, check event index (for wider search)
      if (!logEvent) {
        logEvent = this.index.findEventAtPosition(screenX, screenY, viewport, depth, false);
      }

      isOverEventArea = logEvent !== null;

      // Priority 3: If no event found, check if we're over a bucket at this depth
      if (!logEvent) {
        const bucketResult = this.findBucketAtPosition(screenX, depth, viewport);
        if (bucketResult) {
          isOverEventArea = true;
          // Find best event from bucket using priority and duration
          logEvent = this.findBestEventInBucket(bucketResult.bucket);
        }
      }
    }

    // Priority 4: Only show marker if NOT over any event/bucket area
    // Markers should only show when hovering empty space
    let marker: TimelineMarker | null = null;
    if (!isOverEventArea && this.markerRenderer) {
      marker = this.markerRenderer.hitTest(screenX, screenY);
    }

    // Convert LogEvent to EventNode for public API
    const eventNode = logEvent ? this.toEventNode(logEvent, depth) : null;

    return { eventNode, marker, isOverEventArea };
  }

  /**
   * Convert a LogEvent to an EventNode for the public API.
   * Stores the original LogEvent reference for adapter layer access.
   */
  private toEventNode(logEvent: LogEvent, depth: number): EventNode {
    return {
      id: `${logEvent.timestamp}-${depth}`,
      timestamp: logEvent.timestamp,
      duration: logEvent.duration?.total ?? 0,
      type: logEvent.type ?? logEvent.subCategory ?? 'UNKNOWN',
      text: logEvent.text,
      original: logEvent,
    };
  }

  /**
   * Find visible rectangle at screen position from last render pass.
   * This ensures hit detection is in sync with what's actually displayed.
   *
   * @returns Event reference if found, null otherwise
   */
  private findVisibleRectAtPosition(
    screenX: number,
    depth: number,
    viewport: ViewportState,
  ): LogEvent | null {
    for (const categoryRects of this.visibleRects.values()) {
      for (const rect of categoryRects) {
        // Check depth match
        if (rect.depth !== depth) {
          continue;
        }

        // Calculate screen X position
        const rectScreenX = rect.timeStart * viewport.zoom - viewport.offsetX;
        const rectScreenEnd = rect.timeEnd * viewport.zoom - viewport.offsetX;

        // Check if mouse X is within rect bounds
        if (screenX >= rectScreenX && screenX <= rectScreenEnd) {
          return rect.eventRef;
        }
      }
    }
    return null;
  }

  /**
   * Find bucket at screen position, if any.
   * Uses the bucket's pre-computed x position (same as rendering) for accurate hit detection.
   * @returns Bucket and its screen bounds, or null if not over a bucket
   */
  private findBucketAtPosition(
    screenX: number,
    depth: number,
    viewport: ViewportState,
  ): { bucket: PixelBucket; screenX: number; screenWidth: number } | null {
    for (const categoryBuckets of this.buckets.values()) {
      for (const bucket of categoryBuckets) {
        // Check if bucket is at the target depth
        if (bucket.depth !== depth) {
          continue;
        }

        // Use pre-computed x position (grid-aligned, matches rendering)
        const bucketScreenX = bucket.x - viewport.offsetX;
        const bucketScreenEnd = bucketScreenX + BUCKET_CONSTANTS.BUCKET_WIDTH;

        // Check if mouse X is within bucket bounds
        if (screenX >= bucketScreenX && screenX <= bucketScreenEnd) {
          return {
            bucket,
            screenX: bucketScreenX,
            screenWidth: BUCKET_CONSTANTS.BUCKET_WIDTH,
          };
        }
      }
    }
    return null;
  }

  /**
   * Find the best event in a bucket using priority and duration.
   *
   * Selection strategy:
   * 1. Highest priority category wins (DML > SOQL > Method > etc.)
   * 2. For same priority, longest duration wins
   *
   * @param bucket - The bucket containing aggregated events
   * @returns Best event based on priority/duration, or null if bucket is empty
   */
  private findBestEventInBucket(bucket: PixelBucket): LogEvent | null {
    let events = bucket.eventRefs;

    // If eventRefs is empty (TemporalSegmentTree optimization), query for events in region
    if (events.length === 0) {
      // Use RectangleManager for O(log n) query when available, fall back to O(n) index
      if (this.rectangleManager) {
        events = this.rectangleManager.queryEventsInRegion(
          bucket.timeStart,
          bucket.timeEnd,
          bucket.depth,
          bucket.depth,
        );
      } else {
        const bounds: ViewportBounds = {
          timeStart: bucket.timeStart,
          timeEnd: bucket.timeEnd,
          depthStart: bucket.depth,
          depthEnd: bucket.depth,
        };
        events = this.index.findEventsInRegion(bounds);
      }
    }

    if (events.length === 0) {
      return null;
    }

    // Single event - return it directly
    if (events.length === 1) {
      return events[0] ?? null;
    }

    // Build priority map for O(1) lookup
    const priorityMap = new Map<string, number>();
    BUCKET_CONSTANTS.CATEGORY_PRIORITY.forEach((cat, i) => priorityMap.set(cat, i));

    let bestEvent: LogEvent | null = null;
    let bestPriority = Infinity;
    let bestDuration = -1;

    for (const event of events) {
      const priority = priorityMap.get(event.subCategory) ?? Infinity;
      const duration = event.duration?.total ?? 0;

      // Priority wins first (lower index = higher priority)
      if (priority < bestPriority) {
        bestEvent = event;
        bestPriority = priority;
        bestDuration = duration;
      } else if (priority === bestPriority && duration > bestDuration) {
        // Same priority: longest duration wins
        bestEvent = event;
        bestDuration = duration;
      }
    }

    return bestEvent;
  }
}
