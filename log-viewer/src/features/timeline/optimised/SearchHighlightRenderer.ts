/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

/**
 * SearchHighlightRenderer
 *
 * Rendering layer for search highlights using PixiJS Graphics.
 * Draws borders and overlays for matched events with viewport culling.
 */

import * as PIXI from 'pixi.js';
import type { EventNode, ViewportState } from '../types/flamechart.types.js';
import { TIMELINE_CONSTANTS } from '../types/flamechart.types.js';
import type { SearchCursor, SearchMatch } from '../types/search.types.js';
import { blendWithBackground } from './BucketColorResolver.js';
import type { PrecomputedRect } from './RectangleManager.js';

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
 * Highlight colors from VS Code theme (pre-blended opaque).
 */
interface HighlightColors {
  /** Source color for current match (0xRRGGBB) - used for border. */
  currentMatchColor: number;
  /** Pre-blended opaque color for small event solid fill (0.6 opacity). */
  smallEventFillColor: number;
  /** Pre-blended opaque color for overlay fill (0.3 opacity). */
  overlayFillColor: number;
  /** Pre-blended opaque color for border stroke (0.9 opacity). */
  borderStrokeColor: number;
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

    // Extract colors from CSS variables
    this.colors = this.extractColors();
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

    // Minimum visible highlight width in pixels
    const MIN_HIGHLIGHT_WIDTH = 6;

    // Calculate screen position from event data and current viewport (not from stale rect)
    const event = currentMatch.event;
    const screenX = event.timestamp * viewport.zoom;
    const screenWidth = event.duration * viewport.zoom;
    const screenY = currentMatch.depth * TIMELINE_CONSTANTS.EVENT_HEIGHT;
    const screenHeight = TIMELINE_CONSTANTS.EVENT_HEIGHT;

    // Calculate event center point (always accurate regardless of zoom)
    const eventCenterX = screenX + screenWidth / 2;

    // Enforce minimum visible size for highlight
    const visibleWidth = Math.max(screenWidth, MIN_HIGHLIGHT_WIDTH);

    // Center the minimum-size highlight on the actual event position
    const centeredX = eventCenterX - visibleWidth / 2;

    // Use different rendering based on whether minimum width is applied
    if (screenWidth < MIN_HIGHLIGHT_WIDTH) {
      // Small event: solid fill with pre-blended color (simulates 0.6 opacity)
      // This makes the expanded highlight more prominent and avoids visual complexity
      this.currentMatchGraphics.rect(centeredX, screenY, visibleWidth, screenHeight);
      this.currentMatchGraphics.fill({ color: this.colors.smallEventFillColor });
    } else {
      // Normal event: overlay with border (pre-blended opaque colors)
      const halfGap = TIMELINE_CONSTANTS.RECT_GAP / 2;
      const gappedWidth = Math.max(2, visibleWidth - TIMELINE_CONSTANTS.RECT_GAP);
      const gappedHeight = screenHeight - TIMELINE_CONSTANTS.RECT_GAP;

      // Overlay fill with pre-blended color (simulates 0.3 opacity)
      this.currentMatchGraphics.rect(
        centeredX + halfGap,
        screenY + halfGap,
        gappedWidth,
        gappedHeight,
      );
      this.currentMatchGraphics.fill({ color: this.colors.overlayFillColor });

      // Internal border with pre-blended color (simulates 0.9 opacity)
      const borderInset = 1;
      const borderX = centeredX + halfGap + borderInset;
      const borderY = screenY + halfGap + borderInset;
      const borderWidth = Math.max(0, gappedWidth - borderInset * 2);
      const borderHeight = Math.max(0, gappedHeight - borderInset * 2);

      if (borderWidth > 0 && borderHeight > 0) {
        this.currentMatchGraphics.rect(borderX, borderY, borderWidth, borderHeight);
        this.currentMatchGraphics.stroke({
          width: 1,
          color: this.colors.borderStrokeColor,
        });
      }
    }
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

  /**
   * Extract highlight colors from CSS variables and pre-blend for opaque rendering.
   * Falls back to defaults if CSS variables not available.
   *
   * @returns Highlight colors as pre-blended opaque PixiJS numeric values
   */
  private extractColors(): HighlightColors {
    const computedStyle = getComputedStyle(document.documentElement);

    const currentMatchColorStr =
      computedStyle.getPropertyValue('--vscode-editor-findMatchBackground').trim() || '#ff9632';

    const c = this.parseColor(currentMatchColorStr);
    const sourceColor = c.color;

    // Pre-blend colors with background for opaque rendering
    return {
      currentMatchColor: sourceColor,
      smallEventFillColor: blendWithBackground(sourceColor, 0.6),
      overlayFillColor: blendWithBackground(sourceColor, 0.3),
      borderStrokeColor: blendWithBackground(sourceColor, 0.9),
    };
  }

  /**
   * Parse CSS color string to PixiJS numeric color (RGB only, ignoring alpha).
   * Handles hex format (#RGB, #RGBA, #RRGGBB, #RRGGBBAA) and rgb(a) formats.
   * Alpha is intentionally ignored - highlight opacities are fixed for visibility.
   *
   * @param cssColor - CSS color string
   * @returns PixiJS numeric color (0xRRGGBB)
   */
  private parseColor(cssColor: string): { color: number } {
    if (!cssColor) {
      return { color: 0xea5c00 };
    }
    if (cssColor.startsWith('#')) {
      const hex = cssColor.slice(1);
      if (hex.length === 8) {
        // #RRGGBBAA - extract RGB, ignore alpha
        const rgb = hex.slice(0, 6);
        return { color: parseInt(rgb, 16) };
      }
      if (hex.length === 6) {
        return { color: parseInt(hex, 16) };
      }
      if (hex.length === 4) {
        // #RGBA - extract RGB, ignore alpha
        const r = hex[0]!;
        const g = hex[1]!;
        const b = hex[2]!;
        return { color: parseInt(r + r + g + g + b + b, 16) };
      }
      if (hex.length === 3) {
        const r = hex[0]!;
        const g = hex[1]!;
        const b = hex[2]!;
        return { color: parseInt(r + r + g + g + b + b, 16) };
      }
    }
    // rgba() fallback - ignore alpha
    const rgba = cssColor.match(/rgba?\((\d+),(\d+),(\d+)(?:,(\d*(?:\.\d+)?))?\)/);
    if (rgba) {
      const r = parseInt(rgba[1]!, 10);
      const g = parseInt(rgba[2]!, 10);
      const b = parseInt(rgba[3]!, 10);
      return { color: (r << 16) | (g << 8) | b };
    }
    return { color: 0xea5c00 };
  }
}
