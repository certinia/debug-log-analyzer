/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

/**
 * EventBatchRenderer
 *
 * Pure rectangle rendering for timeline events.
 * Receives pre-computed, culled rectangles and renders them with original colors.
 *
 * Based on PixiJS performance guide:
 * - Small Graphics objects (rectangles) are as fast as Sprites
 * - Graphics objects are batched when under 100 points
 * - Grouping similar object types is faster (category-based batching)
 *
 * Responsibilities:
 * - Render rectangles with their original colors
 * - Manage PixiJS Graphics objects for each category
 *
 * Does NOT:
 * - Pre-compute rectangles (done by RectangleManager)
 * - Perform culling (done by RectangleManager)
 * - Handle search logic (done by SearchStyleRenderer)
 */

import * as PIXI from 'pixi.js';
import type { PixelBucket, RenderBatch } from '../types/flamechart.types.js';
import { BUCKET_CONSTANTS, TIMELINE_CONSTANTS } from '../types/flamechart.types.js';
import type { PrecomputedRect } from './RectangleManager.js';

export class EventBatchRenderer {
  private batches: Map<string, RenderBatch>;
  private graphics: Map<string, PIXI.Graphics>;
  private container: PIXI.Container;
  /** Dedicated Graphics object for bucket rendering (grouped by color) */
  private bucketGraphics: PIXI.Graphics;

  constructor(container: PIXI.Container, batches: Map<string, RenderBatch>) {
    this.batches = batches;
    this.graphics = new Map();
    this.container = container;

    // Create Graphics objects for each batch (rectangles only)
    for (const [category, _batch] of batches) {
      const gfx = new PIXI.Graphics();
      this.graphics.set(category, gfx);
      container.addChild(gfx);
    }

    // Create dedicated Graphics for bucket rendering
    this.bucketGraphics = new PIXI.Graphics();
    container.addChild(this.bucketGraphics);
  }

  /**
   * Render culled rectangles and buckets.
   * Receives pre-culled rectangles and aggregated buckets from RectangleManager.
   * Both are keyed by category.
   *
   * @param culledRects - Rectangles grouped by category (events > 2px)
   * @param buckets - Aggregated buckets grouped by category (events ≤ 2px)
   */
  public render(
    culledRects: Map<string, PrecomputedRect[]>,
    buckets: Map<string, PixelBucket[]>,
  ): void {
    // Clear all batches - reuse existing arrays
    for (const batch of this.batches.values()) {
      batch.rectangles.length = 0;
      batch.isDirty = true;
    }

    // Populate batches from culled rectangles
    for (const [category, rectangles] of culledRects) {
      const batch = this.batches.get(category);
      if (batch) {
        for (const rect of rectangles) {
          batch.rectangles.push(rect);
        }
      }
    }

    // Render rectangles per category
    for (const [category, batch] of this.batches) {
      if (batch.isDirty) {
        this.renderBatch(category, batch);
        batch.isDirty = false;
      }
    }

    // Render all buckets grouped by color (minimizes setFillStyle calls)
    this.renderBuckets(buckets);
  }

  /**
   * Clear all graphics without destroying them.
   * Called when switching to search mode.
   */
  public clear(): void {
    for (const gfx of this.graphics.values()) {
      gfx.clear();
    }
    this.bucketGraphics.clear();
  }

  /**
   * Clean up Graphics objects.
   */
  public destroy(): void {
    for (const gfx of this.graphics.values()) {
      gfx.destroy();
    }
    this.graphics.clear();
    this.bucketGraphics.destroy();
  }

  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================

  /**
   * Render a single batch (category) using PixiJS Graphics.
   *
   * Draws all rectangles for this category as a single Graphics object.
   * Performance: Uses single setFillStyle + fill() call per category.
   *
   * @param category - Category name
   * @param batch - RenderBatch with rectangles and color
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

    // Pre-calculate constants outside loops
    const gap = TIMELINE_CONSTANTS.RECT_GAP;
    const halfGap = gap / 2;

    // Render rectangles (events > 2px) with batch color
    gfx.setFillStyle({ color: batch.color });

    for (const rect of batch.rectangles) {
      const gappedX = rect.x + halfGap;
      const gappedY = rect.y + halfGap;
      const gappedWidth = Math.max(0, rect.width - gap);
      const gappedHeight = Math.max(0, rect.height - gap);

      gfx.rect(gappedX, gappedY, gappedWidth, gappedHeight);
    }

    gfx.fill();
  }

  /**
   * Render all buckets grouped by color using a single Graphics object.
   *
   * Buckets have density-based colors (opacity pre-blended), so colors vary
   * even within the same category. Grouping ALL buckets by color minimizes
   * setFillStyle state changes for better PixiJS performance.
   *
   * @param buckets - Aggregated buckets grouped by category
   */
  private renderBuckets(buckets: Map<string, PixelBucket[]>): void {
    this.bucketGraphics.clear();

    // Collect all buckets from all categories
    const allBuckets: PixelBucket[] = [];
    for (const categoryBuckets of buckets.values()) {
      for (const bucket of categoryBuckets) {
        allBuckets.push(bucket);
      }
    }

    if (allBuckets.length === 0) {
      return;
    }

    // Pre-calculate constants outside loops
    const gap = TIMELINE_CONSTANTS.RECT_GAP;
    const halfGap = gap / 2;
    const blockWidth = BUCKET_CONSTANTS.BUCKET_BLOCK_WIDTH;
    const eventHeight = TIMELINE_CONSTANTS.EVENT_HEIGHT;
    const gappedHeight = Math.max(0, eventHeight - gap);

    // Group ALL buckets by color to minimize setFillStyle state changes
    // Color varies by event count (density-based opacity pre-blended)
    const colorGroups = new Map<number, PixelBucket[]>();
    for (const bucket of allBuckets) {
      let group = colorGroups.get(bucket.color);
      if (!group) {
        group = [];
        colorGroups.set(bucket.color, group);
      }
      group.push(bucket);
    }

    // Render each color group with single setFillStyle + fill
    for (const [color, group] of colorGroups) {
      this.bucketGraphics.setFillStyle({ color });

      for (const bucket of group) {
        const gappedX = bucket.x + halfGap;
        const gappedY = bucket.y + halfGap;
        this.bucketGraphics.rect(gappedX, gappedY, blockWidth, gappedHeight);
      }

      this.bucketGraphics.fill();
    }
  }
}
