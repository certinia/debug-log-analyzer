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

export class EventBatchRenderer {
  private batches: Map<string, RenderBatch>;
  private graphics: Map<string, PIXI.Graphics>;
  private container: PIXI.Container;

  constructor(container: PIXI.Container, batches: Map<string, RenderBatch>) {
    this.batches = batches;
    this.graphics = new Map();
    this.container = container;

    // Create Graphics objects for each batch
    for (const [category, _batch] of batches) {
      const gfx = new PIXI.Graphics();
      this.graphics.set(category, gfx);
      container.addChild(gfx);
    }
  }

  /**
   * Render all visible events grouped by category.
   *
   * Implements view frustum culling: only renders events within viewport bounds.
   */
  public render(events: LogEvent[], viewport: ViewportState): void {
    const bounds = this.calculateBounds(viewport);

    // Clear all batches
    for (const batch of this.batches.values()) {
      batch.rectangles = [];
      batch.isDirty = true;
    }

    // Collect visible rectangles grouped by category
    this.collectVisibleRectangles(events, 0, viewport, bounds);

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
   */
  private calculateBounds(viewport: ViewportState): ViewportBounds {
    const timeStart = viewport.offsetX / viewport.zoom;
    const timeEnd = (viewport.offsetX + viewport.displayWidth) / viewport.zoom;

    const depthStart = Math.floor(viewport.offsetY / TIMELINE_CONSTANTS.EVENT_HEIGHT);
    const depthEnd = Math.ceil(
      (viewport.offsetY + viewport.displayHeight) / TIMELINE_CONSTANTS.EVENT_HEIGHT,
    );

    return {
      timeStart,
      timeEnd,
      depthStart,
      depthEnd,
    };
  }

  /**
   * Recursively collect visible event rectangles.
   *
   * Implements hierarchical culling:
   * 1. Check if event is within viewport bounds
   * 2. If visible, add to appropriate batch
   * 3. Recurse into children
   */
  private collectVisibleRectangles(
    events: LogEvent[],
    depth: number,
    viewport: ViewportState,
    bounds: ViewportBounds,
  ): void {
    for (const event of events) {
      const { duration, subCategory } = event;
      if (!duration.total || !subCategory) {
        continue;
      }

      // Calculate rectangle position and size
      const { timestamp, children } = event;
      const x = timestamp * viewport.zoom;
      const width = duration.total * viewport.zoom;
      const y = depth * TIMELINE_CONSTANTS.EVENT_HEIGHT;

      // Check if rectangle is visible (frustum culling)
      if (this.isRectangleVisible(event, depth, width, bounds)) {
        // Add to batch for this category
        const batch = this.batches.get(subCategory);
        if (batch) {
          const rect: RenderRectangle = {
            x,
            y,
            width,
            height: TIMELINE_CONSTANTS.EVENT_HEIGHT,
            eventRef: event,
          };
          batch.rectangles.push(rect);
        }

        // Recurse into children
        if (children && children.length > 0) {
          this.collectVisibleRectangles(children, depth + 1, viewport, bounds);
        }
      }
    }
  }

  /**
   * Check if rectangle is visible within viewport bounds.
   *
   * Culls rectangles that are:
   * 1. Outside horizontal bounds (time range)
   * 2. Outside vertical bounds (depth range)
   * 3. Too small to render (< MIN_RECT_SIZE pixels)
   */
  private isRectangleVisible(
    event: LogEvent,
    depth: number,
    width: number,
    bounds: ViewportBounds,
  ): boolean {
    // Horizontal overlap
    const eventTimeStart = event.timestamp;
    const eventTimeEnd = event.exitStamp ?? event.timestamp;
    const horizontalOverlap = eventTimeStart < bounds.timeEnd && eventTimeEnd > bounds.timeStart;

    // Vertical overlap
    const verticalOverlap = depth >= bounds.depthStart && depth <= bounds.depthEnd;

    // Minimum size filter (skip sub-pixel rectangles)
    const isSizeValid = width >= TIMELINE_CONSTANTS.MIN_RECT_SIZE;

    return horizontalOverlap && verticalOverlap && isSizeValid;
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
