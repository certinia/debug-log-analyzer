/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

/**
 * EventBatchRenderer
 *
 * Batched rectangle rendering for timeline events.
 * Groups events by category for GPU-accelerated rendering.
 *
 * Based on PixiJS performance guide:
 * - Small Graphics objects (rectangles) are as fast as Sprites
 * - Graphics objects are batched when under 100 points
 * - Grouping similar object types is faster (category-based batching)
 */

import * as PIXI from 'pixi.js';
import type { LogEvent } from '../../../core/log-parser/LogEvents.js';
import type { RenderBatch, ViewportBounds, ViewportState } from '../types/timeline.types.js';
import { TIMELINE_CONSTANTS } from '../types/timeline.types.js';

/**
 * Pre-computed event rectangle with fixed properties.
 * Stored once at construction to avoid recalculating every frame.
 */
interface PrecomputedRect {
  timeStart: number; // timestamp in nanoseconds
  timeEnd: number; // exitStamp in nanoseconds
  depth: number; // call stack depth
  duration: number; // duration in nanoseconds
  category: string; // event category
  eventRef: LogEvent; // reference to original event
  x: number; // screen X position (updated every frame)
  y: number; // screen Y position (fixed)
  width: number; // screen width (updated every frame)
  height: number; // screen height (fixed)
}

export class EventBatchRenderer {
  private batches: Map<string, RenderBatch>;
  private graphics: Map<string, PIXI.Graphics>;
  private container: PIXI.Container;

  // Spatial index: rectangles grouped by category for direct batch access

  private rectsByCategory: Map<string, PrecomputedRect[]> = new Map();

  constructor(container: PIXI.Container, batches: Map<string, RenderBatch>, events: LogEvent[]) {
    this.batches = batches;
    this.graphics = new Map();
    this.container = container;

    // Create Graphics objects for each batch
    for (const [category, _batch] of batches) {
      const gfx = new PIXI.Graphics();
      this.graphics.set(category, gfx);
      container.addChild(gfx);
    }

    // Pre-compute all rectangles once at construction
    this.precomputeRectangles(events);
  }

  /**
   * Pre-compute all event rectangles once at construction.
   * Creates a flat array and spatial index for fast culling during render.
   */
  private precomputeRectangles(events: LogEvent[]): void {
    this.rectsByCategory.clear();

    // Recursively flatten event tree
    this.flattenEvents(events, 0);
  }

  /**
   * Iteratively flatten event tree into pre-computed rectangles.
   */
  private flattenEvents(events: LogEvent[], startDepth: number): void {
    // Pre-allocate category arrays and cache them to avoid Map.get() calls
    for (const category of this.batches.keys()) {
      this.rectsByCategory.set(category, []);
    }

    const eventHeight = TIMELINE_CONSTANTS.EVENT_HEIGHT;

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
            // Inline object creation for better optimization
            rects.push({
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
            });
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
   * Render all visible events grouped by category.
   *
   */
  public render(viewport: ViewportState): void {
    const bounds = this.calculateBounds(viewport);

    // Cache all frequently accessed values as primitives
    const zoom = viewport.zoom;
    const boundsTimeStart = bounds.timeStart;
    const boundsTimeEnd = bounds.timeEnd;
    const depthStart = bounds.depthStart;
    const depthEnd = bounds.depthEnd;
    const minRectSize = TIMELINE_CONSTANTS.MIN_RECT_SIZE;

    // Clear all batches - reuse existing arrays instead of creating new ones
    for (const batch of this.batches.values()) {
      batch.rectangles.length = 0;
      batch.isDirty = true;
    }

    // Iterate categories - cache batch lookup outside inner loop
    for (const [category, rectangles] of this.rectsByCategory) {
      const batch = this.batches.get(category);
      if (!batch) {
        continue;
      }

      // Reuse batch.rectangles array instead of temp array
      const batchRects = batch.rectangles;
      const len = rectangles.length;

      for (let i = 0; i < len; i++) {
        const rect = rectangles[i]!;

        // Direct property access - avoid destructuring
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

        // Update rect in-place - zero allocations
        rect.x = rectTimeStart * zoom;
        rect.width = screenWidth;

        batchRects.push(rect);
      }
    }

    // Render dirty batches
    for (const [category, batch] of this.batches) {
      if (batch.isDirty) {
        this.renderBatch(category, batch);
        batch.isDirty = false;
      }
    }
  }

  /**
   * Clean up Graphics objects.
   */
  public destroy(): void {
    for (const gfx of this.graphics.values()) {
      gfx.destroy();
    }
    this.graphics.clear();
  }

  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================

  /**
   * Calculate viewport bounds for culling.
   *
   * With offsetY <= 0 (negative when scrolled down):
   * - worldContainer.y = screen.height - offsetY
   * - When offsetY = 0: see depths 0 to displayHeight/HEIGHT
   * - When offsetY = -100: scrolled down, see higher depths
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
    // Use floor for both to include only depths that are at least partially visible
    const depthStart = Math.floor(worldYBottom / TIMELINE_CONSTANTS.EVENT_HEIGHT);
    const depthEnd = Math.floor(worldYTop / TIMELINE_CONSTANTS.EVENT_HEIGHT);

    return {
      timeStart,
      timeEnd,
      depthStart,
      depthEnd,
    };
  }

  /**
   * Render a single batch (category) using PixiJS Graphics.
   *
   * Draws all rectangles for this category as a single Graphics object.
   * PixiJS automatically batches small Graphics objects (<100 points).
   */
  private renderBatch(category: string, batch: RenderBatch): void {
    const gfx = this.graphics.get(category);
    if (!gfx) {
      return;
    }

    // Clear previous drawings
    gfx.clear();

    if (batch.rectangles.length === 0) {
      return;
    }

    // Set fill style for this batch
    gfx.setFillStyle({ color: batch.color });

    // Draw all rectangles in this batch with negative space separation
    const gap = TIMELINE_CONSTANTS.RECT_GAP;
    const halfGap = gap / 2;

    for (const rect of batch.rectangles) {
      // Apply gap to create separation between rectangles
      // Reduce width and height by gap, and offset position by half gap
      const gappedX = rect.x + halfGap;
      const gappedY = rect.y + halfGap;
      const gappedWidth = Math.max(0, rect.width - gap);
      const gappedHeight = Math.max(0, rect.height - gap);

      // Draw filled rectangle with gaps
      gfx.rect(gappedX, gappedY, gappedWidth, gappedHeight);
      gfx.fill();
    }
  }
}
