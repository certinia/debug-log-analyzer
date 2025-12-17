/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

/**
 * SearchStyleRenderer
 *
 * Renders rectangles with search-aware styling (Chrome DevTools style).
 * Matched events retain original colors, non-matched events are desaturated to greyscale.
 *
 * Responsibilities:
 * - Render rectangles with search styling
 * - Desaturate non-matched events
 * - Maintain original colors for matched events
 *
 * Does NOT:
 * - Pre-compute rectangles (done by RectangleManager)
 * - Perform culling (done by RectangleManager)
 * - Draw highlight borders (done by SearchHighlightRenderer)
 * - Implement search logic
 */

import * as PIXI from 'pixi.js';
import type { RenderBatch } from '../types/flamechart.types.js';
import { TIMELINE_CONSTANTS } from '../types/flamechart.types.js';
import type { PrecomputedRect } from './RectangleManager.js';

/**
 * SearchStyleRenderer
 *
 * Pure rendering class for search-aware styling of timeline events.
 * Receives pre-computed, culled rectangles and matched events set.
 */
export class SearchStyleRenderer {
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
   * Render culled rectangles with search styling.
   * Matched events: original colors
   * Non-matched events: desaturated greyscale
   *
   * @param culledRects - Rectangles grouped by category (from RectangleManager)
   * @param matchedEventIds - Set of event IDs that match search (retain original colors)
   */
  public render(
    culledRects: Map<string, PrecomputedRect[]>,
    matchedEventIds: ReadonlySet<string>,
  ): void {
    // Clear all graphics
    for (const gfx of this.graphics.values()) {
      gfx.clear();
    }

    // Render each category with search styling
    for (const [category, rectangles] of culledRects) {
      const batch = this.batches.get(category);
      const gfx = this.graphics.get(category);

      if (!batch || !gfx || rectangles.length === 0) {
        continue;
      }

      this.renderCategoryWithSearch(
        gfx,
        rectangles,
        batch.color,
        batch.alpha ?? 1,
        matchedEventIds,
      );
    }
  }

  /**
   * Clear all search styling graphics without destroying them.
   * Called when exiting search mode to return to normal rendering.
   */
  public clear(): void {
    for (const gfx of this.graphics.values()) {
      gfx.clear();
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
   * Render a category split into matched and non-matched layers.
   * Chrome DevTools style: matched events keep original color, others desaturate.
   *
   * @param gfx - Graphics object for this category
   * @param rectangles - Rectangles to render
   * @param originalColor - Original category color
   * @param originalAlpha - Original category alpha
   * @param matchedEventIds - Set of matched event IDs
   */
  private renderCategoryWithSearch(
    gfx: PIXI.Graphics,
    rectangles: PrecomputedRect[],
    originalColor: number,
    originalAlpha: number,
    matchedEventIds: ReadonlySet<string>,
  ): void {
    const gap = TIMELINE_CONSTANTS.RECT_GAP;
    const halfGap = gap / 2;
    const greyColor = this.colorToGreyscale(originalColor);

    // Draw matched events with original color
    let hasMatched = false;
    for (const rect of rectangles) {
      if (matchedEventIds.has(rect.id)) {
        const gappedX = rect.x + halfGap;
        const gappedY = rect.y + halfGap;
        const gappedWidth = Math.max(0, rect.width - gap);
        const gappedHeight = Math.max(0, rect.height - gap);
        gfx.rect(gappedX, gappedY, gappedWidth, gappedHeight);
        hasMatched = true;
      }
    }
    if (hasMatched) {
      gfx.fill({ color: originalColor, alpha: originalAlpha });
    }

    // Draw non-matched events with greyscale
    let hasNonMatched = false;
    for (const rect of rectangles) {
      if (!matchedEventIds.has(rect.id)) {
        const gappedX = rect.x + halfGap;
        const gappedY = rect.y + halfGap;
        const gappedWidth = Math.max(0, rect.width - gap);
        const gappedHeight = Math.max(0, rect.height - gap);
        gfx.rect(gappedX, gappedY, gappedWidth, gappedHeight);
        hasNonMatched = true;
      }
    }
    if (hasNonMatched) {
      gfx.fill({ color: greyColor, alpha: originalAlpha });
    }
  }

  /**
   * Convert a color to greyscale based on luminance.
   * Uses standard luminance formula: 0.299*R + 0.587*G + 0.114*B
   * Then applies slight dimming to match Chrome DevTools appearance.
   *
   * @param color - PixiJS color (0xRRGGBB)
   * @returns Greyscale color (0xRRGGBB)
   */
  private colorToGreyscale(color: number): number {
    // Extract RGB components
    const r = (color >> 16) & 0xff;
    const g = (color >> 8) & 0xff;
    const b = color & 0xff;

    // Calculate luminance (perceived brightness)
    const luminance = 0.299 * r + 0.587 * g + 0.114 * b;

    // Apply dimming factor to match Chrome DevTools
    const dimmed = Math.floor(luminance * 0.7);

    // Create greyscale color (same value for R, G, B)
    return (dimmed << 16) | (dimmed << 8) | dimmed;
  }
}
