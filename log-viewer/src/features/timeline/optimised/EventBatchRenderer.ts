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
  /** Dedicated Graphics object for bucket rendering */
  private bucketGraphics: PIXI.Graphics;

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

    // Create dedicated Graphics for bucket rendering
    this.bucketGraphics = new PIXI.Graphics();
    container.addChild(this.bucketGraphics);
  }

  /**
   * Render culled rectangles and buckets.
   * Receives pre-culled rectangles and aggregated buckets from RectangleManager.
   *
   * @param culledRects - Rectangles grouped by category (events > 2px)
   * @param buckets - Aggregated buckets for sub-pixel events (events ≤ 2px)
   */
  public render(culledRects: Map<string, PrecomputedRect[]>, buckets: PixelBucket[]): void {
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

    // Render dirty batches
    for (const [category, batch] of this.batches) {
      if (batch.isDirty) {
        this.renderBatch(category, batch);
        batch.isDirty = false;
      }
    }

    // Render buckets with barcode pattern
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
   * Performance: Uses single fill() call for entire batch instead of per-rectangle.
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

    // Set fill style once for entire batch
    gfx.setFillStyle({ color: batch.color, alpha: batch.alpha ?? 1 });

    // Pre-calculate constants outside loop
    const gap = TIMELINE_CONSTANTS.RECT_GAP;
    const halfGap = gap / 2;

    // Draw all rectangles in this batch
    for (const rect of batch.rectangles) {
      // Apply gap to create separation between rectangles
      const gappedX = rect.x + halfGap;
      const gappedY = rect.y + halfGap;
      const gappedWidth = Math.max(0, rect.width - gap);
      const gappedHeight = Math.max(0, rect.height - gap);

      gfx.rect(gappedX, gappedY, gappedWidth, gappedHeight);
    }

    // Single fill for entire batch - much faster than per-rectangle fill
    gfx.fill();
  }

  /**
   * Render buckets with barcode pattern.
   *
   * Each bucket is rendered as a 1px wide block with a 1px gap.
   * This creates a "barcode" visual effect when multiple buckets are adjacent.
   * Opacity varies by event count to show density.
   *
   * Performance: Groups buckets by color+opacity to minimize setFillStyle/fill calls.
   * Instead of O(N) state changes, we have O(distinct color+opacity combinations).
   *
   * @param buckets - Aggregated pixel buckets to render
   */
  private renderBuckets(buckets: PixelBucket[]): void {
    this.bucketGraphics.clear();

    if (buckets.length === 0) {
      return;
    }

    // Group buckets by color+opacity for batched rendering
    // This reduces state changes from O(N) to O(distinct combinations)
    const groups = new Map<number, PixelBucket[]>();
    for (const bucket of buckets) {
      // Use composite key: color in upper bits, opacity (scaled to int) in lower bits
      // Opacity is 0-1, scale to 0-1000 for sufficient precision
      const opacityKey = Math.round(bucket.opacity * 1000);
      const key = (bucket.color << 10) | opacityKey;

      let group = groups.get(key);
      if (!group) {
        group = [];
        groups.set(key, group);
      }
      group.push(bucket);
    }

    // Pre-calculate constants outside loops
    const blockWidth = BUCKET_CONSTANTS.BUCKET_BLOCK_WIDTH;
    const eventHeight = TIMELINE_CONSTANTS.EVENT_HEIGHT;
    const gap = TIMELINE_CONSTANTS.RECT_GAP;
    const halfGap = gap / 2;
    const gappedHeight = Math.max(0, eventHeight - gap);

    // Render each group with single setFillStyle + single fill
    for (const group of groups.values()) {
      const first = group[0]!;
      this.bucketGraphics.setFillStyle({ color: first.color, alpha: first.opacity });

      // Draw all buckets in this color+opacity group
      for (const bucket of group) {
        const gappedX = bucket.x + halfGap;
        const gappedY = bucket.y + halfGap;
        this.bucketGraphics.rect(gappedX, gappedY, blockWidth, gappedHeight);
      }

      // Single fill for entire group
      this.bucketGraphics.fill();
    }
  }
}
