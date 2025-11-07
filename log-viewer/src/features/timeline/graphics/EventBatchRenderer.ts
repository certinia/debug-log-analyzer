/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
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
import type {
  RenderBatch,
  RenderRectangle,
  ViewportBounds,
  ViewportState,
} from '../types/timeline.types.js';
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
}

export class EventBatchRenderer {
  private batches: Map<string, RenderBatch>;
  private graphics: Map<string, PIXI.Graphics>;
  private container: PIXI.Container;

  // Performance optimization: pre-computed flat list of all rectangles
  private allRects: PrecomputedRect[] = [];

  // Spatial index: rectangles grouped by depth for faster vertical culling
  private rectsByDepth: Map<number, PrecomputedRect[]> = new Map();
  private maxDepth = 0;

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
    this.allRects = [];
    this.rectsByDepth.clear();
    this.maxDepth = 0;

    // Recursively flatten event tree
    this.flattenEvents(events, 0);
  }

  /**
   * Recursively flatten event tree into pre-computed rectangles.
   */
  private flattenEvents(events: LogEvent[], depth: number): void {
    for (const event of events) {
      const { duration, subCategory, timestamp, children } = event;

      if (duration.total && subCategory) {
        const rect: PrecomputedRect = {
          timeStart: timestamp,
          timeEnd: event.exitStamp ?? timestamp,
          depth,
          duration: duration.total,
          category: subCategory,
          eventRef: event,
        };

        this.allRects.push(rect);

        // Add to spatial index by depth
        if (!this.rectsByDepth.has(depth)) {
          this.rectsByDepth.set(depth, []);
        }
        this.rectsByDepth.get(depth)!.push(rect);

        // Track max depth
        if (depth > this.maxDepth) {
          this.maxDepth = depth;
        }
      }

      // Recurse into children
      if (children && children.length > 0) {
        this.flattenEvents(children, depth + 1);
      }
    }
  }

  /**
   * Render all visible events grouped by category.
   *
   * Optimized: Uses pre-computed rectangles and spatial index for fast culling.
   */
  public render(viewport: ViewportState): void {
    const bounds = this.calculateBounds(viewport);

    // Clear all batches
    for (const batch of this.batches.values()) {
      batch.rectangles = [];
      batch.isDirty = true;
    }

    // Fast path: iterate only depths that are visible
    for (let depth = bounds.depthStart; depth <= bounds.depthEnd; depth++) {
      const rectsAtDepth = this.rectsByDepth.get(depth);
      if (!rectsAtDepth) {
        continue;
      }

      // Check each rectangle at this depth
      for (const rect of rectsAtDepth) {
        // Calculate screen-space width for size culling
        const screenWidth = rect.duration * viewport.zoom;

        // Skip if too small to render
        if (screenWidth < TIMELINE_CONSTANTS.MIN_RECT_SIZE) {
          continue;
        }

        // Horizontal overlap check
        if (rect.timeStart >= bounds.timeEnd || rect.timeEnd <= bounds.timeStart) {
          continue;
        }

        // Visible! Add to batch
        const batch = this.batches.get(rect.category);
        if (batch) {
          const renderRect: RenderRectangle = {
            x: rect.timeStart * viewport.zoom,
            y: rect.depth * TIMELINE_CONSTANTS.EVENT_HEIGHT,
            width: screenWidth,
            height: TIMELINE_CONSTANTS.EVENT_HEIGHT,
            eventRef: rect.eventRef,
          };
          batch.rectangles.push(renderRect);
        }
      }
    }

    // Render each batch
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
      // Don't render if width is too small (already filtered in culling)
      if (rect.width < TIMELINE_CONSTANTS.MIN_RECT_SIZE) {
        continue;
      }

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
