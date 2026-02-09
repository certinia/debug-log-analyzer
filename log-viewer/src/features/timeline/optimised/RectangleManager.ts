/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

/**
 * RectangleManager
 *
 * Single source of truth for rectangle computation and viewport culling.
 * Separates "what to draw" from "how to draw it" to eliminate coupling between renderers.
 *
 * Responsibilities:
 * - Pre-compute all rectangles from event tree (once at initialization)
 * - Maintain spatial index (rectsByCategory) for efficient access
 * - Maintain event → rect mapping (rectMap) for search functionality
 * - Perform viewport culling on demand
 * - Provide culled rectangles to any consumer (renderers)
 *
 * Does NOT:
 * - Perform any rendering
 * - Contain any PixiJS graphics logic
 * - Implement any search logic
 */

import type { LogEvent } from '../../../core/log-parser/LogEvents.js';
import type {
  CulledRenderData,
  RenderRectangle,
  ViewportState,
} from '../types/flamechart.types.js';
import { TIMELINE_CONSTANTS } from '../types/flamechart.types.js';
import type { BatchColorInfo } from './BucketColorResolver.js';
import { TemporalSegmentTree } from './TemporalSegmentTree.js';

/**
 * Pre-computed event rectangle with fixed and dynamic properties.
 * Stored once at construction to avoid recalculating every frame.
 */
export interface PrecomputedRect extends RenderRectangle {
  /** Unique ID for this rectangle (timestamp-depth-childIndex) */
  id: string;

  /** Timestamp in nanoseconds (fixed) */
  timeStart: number;

  /** Exit timestamp in nanoseconds (fixed) */
  timeEnd: number;

  /** Call stack depth (fixed) */
  depth: number;

  /** Total duration in nanoseconds including children (fixed) */
  duration: number;

  /** Self duration in nanoseconds excluding children (fixed, for category resolution) */
  selfDuration: number;

  /** Event category for color batching (fixed) */
  category: string;

  /** Reference to original event (fixed) */
  eventRef: LogEvent;

  /** Screen X position (updated during culling) */
  x: number;

  /** Screen Y position (fixed) */
  y: number;

  /** Screen width (updated during culling) */
  width: number;

  /** Screen height (fixed) */
  height: number;
}

/**
 * Precomputed data from unified tree conversion (single-pass optimization).
 * When provided, RectangleManager skips its own flattenEvents traversal.
 */
export interface PrecomputedRectData {
  rectsByCategory: Map<string, PrecomputedRect[]>;
  rectMap: Map<LogEvent, PrecomputedRect>;
  /** Pre-grouped by depth for TemporalSegmentTree (optional - computed if not provided) */
  rectsByDepth?: Map<number, PrecomputedRect[]>;
  /** Whether rectsByCategory arrays are pre-sorted by timeStart (skips sorting) */
  preSorted?: boolean;
}

/**
 * RectangleManager
 *
 * Manages rectangle pre-computation, spatial indexing, and viewport culling.
 * Provides a clean API for renderers to consume rectangle data without coupling.
 *
 * Uses TemporalSegmentTree for O(log n) viewport culling.
 * For O(n) legacy culling, use LegacyViewportCuller directly.
 */
export class RectangleManager {
  /** Spatial index: all rectangles grouped by category */
  private rectsByCategory: Map<string, PrecomputedRect[]> = new Map();

  /** Map from LogEvent to RenderRectangle for search functionality */
  private rectMap: Map<LogEvent, PrecomputedRect> = new Map();

  /** Cached map from rect ID to PrecomputedRect (lazy-built on first access) */
  private rectMapById: Map<string, PrecomputedRect> | null = null;

  /** Segment tree for O(log n) viewport culling */
  private segmentTree: TemporalSegmentTree;

  /**
   * Create RectangleManager with either raw events or precomputed data.
   *
   * @param events - Event tree to pre-compute rectangles from
   * @param categories - Set of valid categories for spatial indexing
   * @param precomputed - Optional precomputed rectangle data from unified conversion
   */
  constructor(events: LogEvent[], categories: Set<string>, precomputed?: PrecomputedRectData) {
    if (precomputed) {
      // Use precomputed data from unified conversion (skips flattenEvents traversal)
      this.rectsByCategory = precomputed.rectsByCategory;
      this.rectMap = precomputed.rectMap;

      // PERF: Only sort if not already pre-sorted (~15-20ms saved)
      if (!precomputed.preSorted) {
        for (const rects of this.rectsByCategory.values()) {
          rects.sort((a, b) => a.timeStart - b.timeStart);
        }
      }
    } else {
      // Legacy path: compute rectangles from events
      this.precomputeRectangles(events, categories);
    }

    // Pass pre-grouped rectsByDepth if available (saves ~12ms grouping iteration)
    this.segmentTree = new TemporalSegmentTree(
      this.rectsByCategory,
      undefined, // batchColors
      precomputed?.rectsByDepth,
    );
  }

  /**
   * Get culled rectangles and buckets for current viewport.
   * Uses TemporalSegmentTree for O(log n) performance.
   *
   * Events > MIN_RECT_SIZE (2px) are returned as visible rectangles.
   * Events <= MIN_RECT_SIZE are aggregated into time-aligned buckets.
   *
   * @param viewport - Current viewport state
   * @param batchColors - Optional colors from RenderBatch (for theme support)
   * @returns CulledRenderData with visible rectangles, buckets, and stats
   *
   * Performance target: <5ms for 50,000 events
   */
  public getCulledRectangles(
    viewport: ViewportState,
    batchColors?: Map<string, BatchColorInfo>,
  ): CulledRenderData {
    return this.segmentTree.query(viewport, batchColors);
  }

  /**
   * Get map from LogEvent to PrecomputedRect for search functionality.
   * Returns live references that update during each culling pass.
   *
   * @returns Map from LogEvent to PrecomputedRect (live references)
   */
  public getRectMap(): Map<LogEvent, PrecomputedRect> {
    return this.rectMap;
  }

  /**
   * Get map from rect ID to PrecomputedRect.
   * Lazy-built on first access to avoid O(n) iteration at init time.
   * Used by SearchOrchestrator for O(1) rect lookup by ID.
   *
   * PERF: Saves ~18ms by avoiding redundant map rebuild in SearchOrchestrator.init()
   *
   * @returns Map from rect ID string to PrecomputedRect
   */
  public getRectMapById(): Map<string, PrecomputedRect> {
    if (!this.rectMapById) {
      this.rectMapById = new Map();
      for (const rect of this.rectMap.values()) {
        this.rectMapById.set(rect.id, rect);
      }
    }
    return this.rectMapById;
  }

  /**
   * Update batch colors for segment tree (for theme changes).
   *
   * @param batchColors - New batch colors from theme
   */
  public setBatchColors(batchColors: Map<string, BatchColorInfo>): void {
    if (this.segmentTree) {
      this.segmentTree.setBatchColors(batchColors);
    }
  }

  /**
   * Get spatial index of rectangles by category.
   * Used for search functionality and segment tree construction.
   *
   * @returns Map of category to rectangles
   */
  public getRectsByCategory(): Map<string, PrecomputedRect[]> {
    return this.rectsByCategory;
  }

  /**
   * Query events within a specific time and depth region.
   * Delegates to TemporalSegmentTree for O(log n + k) performance.
   * Used for hit testing when bucket eventRefs are empty.
   *
   * @param timeStart - Start time in nanoseconds
   * @param timeEnd - End time in nanoseconds
   * @param depthStart - Minimum depth (inclusive)
   * @param depthEnd - Maximum depth (inclusive)
   * @returns Array of LogEvent references in the region
   */
  public queryEventsInRegion(
    timeStart: number,
    timeEnd: number,
    depthStart: number,
    depthEnd: number,
  ): LogEvent[] {
    return this.segmentTree.queryEventsInRegion(timeStart, timeEnd, depthStart, depthEnd);
  }

  /**
   * Get the underlying segment tree for direct queries.
   * Used by MinimapDensityQuery for O(B×log N) density computation.
   *
   * @returns The TemporalSegmentTree instance
   */
  public getSegmentTree(): TemporalSegmentTree {
    return this.segmentTree;
  }

  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================

  /**
   * Pre-compute all rectangles from event tree.
   * Creates a flat spatial index for fast culling during render.
   *
   * @param events - Root events to process
   * @param categories - Valid categories for indexing
   */
  private precomputeRectangles(events: LogEvent[], categories: Set<string>): void {
    // Initialize category arrays
    for (const category of categories) {
      this.rectsByCategory.set(category, []);
    }

    // Flatten event tree into rectangles
    this.flattenEvents(events, 0);

    // Sort rectangles by timeStart for early exit during culling
    // This enables breaking out of the loop when we've passed the viewport
    for (const rects of this.rectsByCategory.values()) {
      rects.sort((a, b) => a.timeStart - b.timeStart);
    }
  }

  /**
   * Iteratively flatten event tree into pre-computed rectangles.
   * Uses parallel stacks to avoid recursion for better performance.
   *
   * @param events - Events at root level
   * @param startDepth - Starting depth (0-indexed)
   */
  private flattenEvents(events: LogEvent[], startDepth: number): void {
    const eventHeight = TIMELINE_CONSTANTS.EVENT_HEIGHT;

    // Parallel stacks for iterative traversal
    const stackEvents: LogEvent[][] = [events];
    const stackDepths: number[] = [startDepth];
    let stackSize = 1;

    while (stackSize > 0) {
      // Pop from parallel stacks
      stackSize--;
      const currentEvents = stackEvents[stackSize]!;
      const depth = stackDepths[stackSize]!;
      const depthY = depth * eventHeight;

      // Process all events at current depth
      const len = currentEvents.length;
      for (let i = 0; i < len; i++) {
        const event = currentEvents[i]!;
        const { duration, subCategory, timestamp, exitStamp, children } = event;

        // Check if this event should be rendered
        if (duration.total && subCategory) {
          const rects = this.rectsByCategory.get(subCategory);
          if (rects) {
            // Create persistent rect object (updated during culling)
            // ID format: timestamp-depth-childIndex
            const rect: PrecomputedRect = {
              id: `${timestamp}-${depth}-${i}`,
              timeStart: timestamp,
              timeEnd: exitStamp ?? timestamp,
              depth,
              duration: duration.total,
              selfDuration: duration.self,
              category: subCategory,
              eventRef: event,
              x: 0,
              y: depthY,
              width: 0,
              height: eventHeight,
            };
            rects.push(rect);

            // Store live reference for search (will be updated during culling)
            this.rectMap.set(event, rect);
          }
        }

        // Push children onto parallel stacks for processing at depth + 1
        if (children?.length) {
          stackEvents[stackSize] = children;
          stackDepths[stackSize] = depth + 1;
          stackSize++;
        }
      }
    }
  }
}
