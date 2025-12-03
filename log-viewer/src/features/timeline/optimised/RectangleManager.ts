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
import type { RenderRectangle, ViewportBounds, ViewportState } from '../types/flamechart.types.js';
import { TIMELINE_CONSTANTS } from '../types/flamechart.types.js';

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

  /** Duration in nanoseconds (fixed) */
  duration: number;

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
 * RectangleManager
 *
 * Manages rectangle pre-computation, spatial indexing, and viewport culling.
 * Provides a clean API for renderers to consume rectangle data without coupling.
 */
export class RectangleManager {
  /** Spatial index: all rectangles grouped by category */
  private rectsByCategory: Map<string, PrecomputedRect[]> = new Map();

  /** Map from LogEvent to RenderRectangle for search functionality */
  private rectMap: Map<LogEvent, PrecomputedRect> = new Map();

  /**
   * @param events - Event tree to pre-compute rectangles from
   * @param categories - Set of valid categories for spatial indexing
   */
  constructor(events: LogEvent[], categories: Set<string>) {
    this.precomputeRectangles(events, categories);
  }

  /**
   * Get culled rectangles for current viewport.
   * Runs viewport culling algorithm and returns rectangles ready for rendering.
   *
   * @param viewport - Current viewport state
   * @returns Culled rectangles grouped by category and in flat array
   *
   * Performance target: <10ms for 50,000 events
   */
  public getCulledRectangles(viewport: ViewportState): Map<string, PrecomputedRect[]> {
    const bounds = this.calculateBounds(viewport);
    const byCategory = new Map<string, PrecomputedRect[]>();

    // Cache frequently accessed values as primitives
    const zoom = viewport.zoom;
    const boundsTimeStart = bounds.timeStart;
    const boundsTimeEnd = bounds.timeEnd;
    const depthStart = bounds.depthStart;
    const depthEnd = bounds.depthEnd;
    const minRectSize = TIMELINE_CONSTANTS.MIN_RECT_SIZE;

    // Cull rectangles for each category
    for (const [category, rectangles] of this.rectsByCategory) {
      const culled: PrecomputedRect[] = [];
      const len = rectangles.length;

      for (let i = 0; i < len; i++) {
        const rect = rectangles[i]!;

        // Direct property access - avoid destructuring for performance
        const rectTimeStart = rect.timeStart;
        const rectTimeEnd = rect.timeEnd;
        const rectDepth = rect.depth;
        const rectDuration = rect.duration;

        // Horizontal overlap check
        if (rectTimeStart >= boundsTimeEnd || rectTimeEnd <= boundsTimeStart) {
          continue;
        }

        // Depth culling
        if (rectDepth < depthStart || rectDepth > depthEnd) {
          continue;
        }

        // Calculate screen-space width
        const screenWidth = rectDuration * zoom;

        // Size culling
        if (screenWidth < minRectSize) {
          continue;
        }

        // Update rect screen position in-place (zero allocations)
        rect.x = rectTimeStart * zoom;
        rect.width = screenWidth;

        culled.push(rect);
      }

      if (culled.length > 0) {
        byCategory.set(category, culled);
      }
    }

    return byCategory;
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

  /**
   * Calculate viewport bounds for culling.
   * Converts viewport state to time/depth ranges for efficient overlap checks.
   *
   * @param viewport - Current viewport state
   * @returns Culling bounds in timeline coordinates
   */
  private calculateBounds(viewport: ViewportState): ViewportBounds {
    const timeStart = viewport.offsetX / viewport.zoom;
    const timeEnd = (viewport.offsetX + viewport.displayWidth) / viewport.zoom;

    // World Y coordinates of visible region
    // With scale.y = -1 flip and container.y = screen.height - offsetY:
    // Screen renders worldY in range [-offsetY, screen.height - offsetY]
    const worldYBottom = -viewport.offsetY; // Visible at screen bottom (lower depths)
    const worldYTop = -viewport.offsetY + viewport.displayHeight; // Visible at screen top (higher depths)

    // Convert to depth levels (depth 0 is at worldY = 0)
    // An event at depth D occupies worldY = [D * HEIGHT, (D+1) * HEIGHT]
    const depthStart = Math.floor(worldYBottom / TIMELINE_CONSTANTS.EVENT_HEIGHT);
    const depthEnd = Math.floor(worldYTop / TIMELINE_CONSTANTS.EVENT_HEIGHT);

    return {
      timeStart,
      timeEnd,
      depthStart,
      depthEnd,
    };
  }
}
