/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

/**
 * SearchHighlightRenderer
 *
 * Rendering layer for search highlights using PixiJS Graphics.
 * Draws borders and overlays for matched events with viewport culling.
 *
 * Uses shared HighlightRenderer for consistent styling with SelectionHighlightRenderer.
 */

import * as PIXI from 'pixi.js';
import type { EventNode, ViewportState } from '../../types/flamechart.types.js';
import type { SearchCursor, SearchMatch } from '../../types/search.types.js';
import type { PrecomputedRect } from '../RectangleManager.js';
import {
  extractHighlightColors,
  renderHighlight,
  type HighlightColors,
} from '../rendering/HighlightRenderer.js';

/**
 * Culling bounds derived from viewport.
 */
interface CullingBounds {
  /** Start time in nanoseconds. */
  timeStart: number;

  /** End time in nanoseconds. */
  timeEnd: number;

  /** Start depth (0-indexed). */
  depthStart: number;

  /** End depth (0-indexed). */
  depthEnd: number;
}

/**
 * SearchHighlightRenderer
 *
 * Renders search match highlights as borders over timeline events.
 * Uses two layers: one for all matches, one for current match (distinct styling).
 */
export class SearchHighlightRenderer {
  /** Graphics for all non-current matches (semi-transparent borders). */
  private allMatchGraphics: PIXI.Graphics;

  /** Graphics for current match (distinct border on top). */
  private currentMatchGraphics: PIXI.Graphics;

  /** Highlight colors extracted from CSS variables. */
  private colors: HighlightColors;

  /**
   * @param container - PixiJS container to add graphics to (worldContainer)
   */
  constructor(container: PIXI.Container) {
    this.allMatchGraphics = new PIXI.Graphics();
    this.currentMatchGraphics = new PIXI.Graphics();

    // Set z-index for layering (current match on top)
    this.allMatchGraphics.zIndex = 1;
    this.currentMatchGraphics.zIndex = 2;

    container.addChild(this.allMatchGraphics);
    container.addChild(this.currentMatchGraphics);

    // Extract colors from shared utility
    this.colors = extractHighlightColors();
  }

  /**
   * Render current match highlight only (Chrome DevTools style).
   * All matches retain original colors, current match gets subtle overlay + border.
   *
   * @param cursor - Search cursor (or undefined if no search active)
   * @param viewport - Viewport state for culling and transforms
   */
  public render(cursor: SearchCursor<EventNode> | undefined, viewport: ViewportState): void {
    this.allMatchGraphics.clear();
    this.currentMatchGraphics.clear();

    if (!cursor || cursor.total === 0) {
      return;
    }

    const bounds = this.calculateBounds(viewport);
    const currentMatch = cursor.getCurrent();

    if (!currentMatch || !this.isVisible(currentMatch, currentMatch.rect, bounds)) {
      return;
    }

    // Use shared highlight rendering logic
    renderHighlight(
      this.currentMatchGraphics,
      currentMatch.event.timestamp,
      currentMatch.event.duration,
      currentMatch.depth,
      viewport,
      this.colors,
    );
  }

  /**
   * Clear all highlights from display.
   */
  public clear(): void {
    this.allMatchGraphics.clear();
    this.currentMatchGraphics.clear();
  }

  /**
   * Update highlight colors from theme.
   * Called when VS Code theme changes.
   *
   * @param colors - New highlight colors from CSS variables
   */
  public setColors(colors: HighlightColors): void {
    this.colors = colors;
  }

  /**
   * Destroy renderer and cleanup resources.
   */
  public destroy(): void {
    this.allMatchGraphics.destroy();
    this.currentMatchGraphics.destroy();
  }

  /**
   * Calculate culling bounds from viewport state.
   * Same logic as EventBatchRenderer for consistency.
   *
   * @param viewport - Viewport state
   * @returns Culling bounds in timeline coordinates
   */
  private calculateBounds(viewport: ViewportState): CullingBounds {
    const timeStart = viewport.offsetX / viewport.zoom;
    const timeEnd = (viewport.offsetX + viewport.displayWidth) / viewport.zoom;

    // Viewport culling for vertical (depth-based)
    const worldYBottom = -viewport.offsetY;
    const worldYTop = -viewport.offsetY + viewport.displayHeight;

    // Assuming EVENT_HEIGHT = 15 (from TIMELINE_CONSTANTS)
    const EVENT_HEIGHT = 15;
    const depthStart = Math.floor(worldYBottom / EVENT_HEIGHT);
    const depthEnd = Math.floor(worldYTop / EVENT_HEIGHT);

    return { timeStart, timeEnd, depthStart, depthEnd };
  }

  /**
   * Check if rectangle is visible within culling bounds.
   * Uses same culling logic as EventBatchRenderer.
   *
   * @param match - Search match to test
   * @param rect - Rectangle to test
   * @param bounds - Culling bounds
   * @returns true if rectangle is visible
   */
  private isVisible(
    match: SearchMatch<EventNode>,
    rect: PrecomputedRect,
    bounds: CullingBounds,
  ): boolean {
    const rectTimeStart = match.event.timestamp;
    const rectTimeEnd = rectTimeStart + match.event.duration;
    if (rectTimeEnd <= bounds.timeStart || rectTimeStart >= bounds.timeEnd) {
      return false;
    }
    const depth = match.depth;
    if (depth < bounds.depthStart || depth > bounds.depthEnd) {
      return false;
    }
    // Always show current match highlight regardless of rect size
    // (don't check rect.width > 0 because EventBatchRenderer might cull small rects)
    return true;
  }
}
