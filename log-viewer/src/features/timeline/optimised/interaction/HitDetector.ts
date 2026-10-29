/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

/**
 * HitDetector
 *
 * Handles hit detection for mouse interactions on the timeline.
 * Determines which event, bucket, or marker is under the mouse cursor.
 *
 * Priority order for hit detection:
 * 1. Visible rectangles from the last render pass
 * 2. Rectangles from the segment tree
 * 3. Buckets (aggregated sub-pixel events)
 * 4. Timeline markers (only if not over events/buckets)
 */

import {
  BUCKET_CONSTANTS,
  type EventNode,
  type PixelBucket,
  type RectColumns,
  rectCategory,
  type TimelineMarker,
  type ViewportState,
} from '../../types/flamechart.types.js';
import type { PrecomputedRect, RectangleCache } from '../RectangleCache.js';

/** Narrower than this many pixels, a frame is left to its bucket. */
const MIN_HIT_WIDTH = 0.05;

const PRIORITY = new Map<string, number>(
  BUCKET_CONSTANTS.CATEGORY_PRIORITY.map((category, rank) => [category, rank]),
);

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
 * Configuration for HitDetector.
 */
export interface HitTestConfig {
  /** The node for a rect's row */
  nodeOf: (row: number) => EventNode;
  /** The frames, to compare rows without making a rect for each */
  columns: RectColumns;
  /** Current visible rectangles from last render pass */
  visibleRects: Map<string, PrecomputedRect[]>;
  /** Current buckets from last render pass */
  buckets: Map<string, PixelBucket[]>;
  /** Optional marker renderer for hit testing markers */
  markerRenderer?: MarkerHitTestable | null;
  /** RectangleCache for O(log n) hit testing queries */
  rectangleManager: RectangleCache;
}

export class HitDetector {
  private readonly nodeOf: (row: number) => EventNode;
  private readonly columns: RectColumns;
  private visibleRects: Map<string, PrecomputedRect[]>;
  private buckets: Map<string, PixelBucket[]>;
  private markerRenderer: MarkerHitTestable | null;
  private rectangleManager: RectangleCache;

  constructor(config: HitTestConfig) {
    this.nodeOf = config.nodeOf;
    this.columns = config.columns;
    this.visibleRects = config.visibleRects;
    this.buckets = config.buckets;
    this.markerRenderer = config.markerRenderer ?? null;
    this.rectangleManager = config.rectangleManager;
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

    let hit: number | null = null;
    let isOverEventArea = false;

    if (isValidDepth) {
      // Priority 1: Check visible rectangles from last render (in sync with display)
      hit = this.findVisibleRectAtPosition(screenX, depth, viewport)?.row ?? null;

      // Priority 2: If no visible rect, check the segment tree (for wider search)
      if (hit === null) {
        const time = (screenX + viewport.offsetX) / viewport.zoom;
        const { total } = this.columns;
        hit =
          this.rectangleManager
            .queryRowsInRegion(time, time, depth, depth)
            .find((row) => total[row]! * viewport.zoom >= MIN_HIT_WIDTH) ?? null;
      }

      isOverEventArea = hit !== null;

      // Priority 3: If no event found, check if we're over a bucket at this depth
      if (hit === null) {
        const bucketResult = this.findBucketAtPosition(screenX, depth, viewport);
        if (bucketResult) {
          isOverEventArea = true;
          // Find best event from bucket using priority and duration
          hit = this.findBestRowInBucket(bucketResult.bucket);
        }
      }
    }

    // Priority 4: Only show marker if NOT over any event/bucket area
    // Markers should only show when hovering empty space
    let marker: TimelineMarker | null = null;
    if (!isOverEventArea && this.markerRenderer) {
      marker = this.markerRenderer.hitTest(screenX, screenY);
    }

    const eventNode = hit !== null ? this.nodeOf(hit) : null;

    return { eventNode, marker, isOverEventArea };
  }

  /**
   * Find visible rectangle at screen position from last render pass.
   * This ensures hit detection is in sync with what's actually displayed.
   *
   * @returns The rect if found, null otherwise
   */
  private findVisibleRectAtPosition(
    screenX: number,
    depth: number,
    viewport: ViewportState,
  ): PrecomputedRect | null {
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
          return rect;
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
   * @returns Best row based on priority/duration, or null if bucket is empty
   */
  private findBestRowInBucket(bucket: PixelBucket): number | null {
    const rows = this.rectangleManager.queryRowsInRegion(
      bucket.timeStart,
      bucket.timeEnd,
      bucket.depth,
      bucket.depth,
    );

    let bestRow: number | null = null;
    let bestPriority = Infinity;
    let bestDuration = -1;

    for (const row of rows) {
      const priority = PRIORITY.get(rectCategory(this.columns, row)) ?? Infinity;
      const duration = this.columns.total[row]!;

      // Priority wins first (lower index = higher priority)
      if (priority < bestPriority) {
        bestRow = row;
        bestPriority = priority;
        bestDuration = duration;
      } else if (priority === bestPriority && duration > bestDuration) {
        // Same priority: longest duration wins
        bestRow = row;
        bestDuration = duration;
      }
    }

    return bestRow;
  }
}
