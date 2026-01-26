/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * CursorLineRenderer
 *
 * Renders a vertical cursor line on the main timeline that mirrors
 * the cursor position from the minimap.
 *
 * - Hover minimap → cursor line appears on BOTH main timeline and minimap
 * - Leave minimap → both cursors hidden
 * - Hover main timeline → no cursor (reduces visual clutter in inspection mode)
 *
 * The cursor line spans the full height of the visible timeline area,
 * helping users track the same time position across both views during navigation.
 */

import * as PIXI from 'pixi.js';
import type { ViewportState } from '../../types/flamechart.types.js';

/**
 * Cursor line width in pixels.
 */
const CURSOR_LINE_WIDTH = 1;

/**
 * Default cursor line color (will be updated from CSS variables).
 */
const DEFAULT_CURSOR_COLOR = 0xffffff;

/**
 * Cursor line opacity.
 */
const CURSOR_LINE_OPACITY = 0.6;

export class CursorLineRenderer {
  /** Graphics object for cursor line */
  private graphics: PIXI.Graphics;

  /** Cursor line color extracted from CSS variables */
  private cursorColor: number;

  /**
   * @param container - PixiJS container to add graphics to (uiContainer)
   */
  constructor(container: PIXI.Container) {
    this.graphics = new PIXI.Graphics();
    // Position above other UI elements
    this.graphics.zIndex = 10;
    container.addChild(this.graphics);

    // Extract color from CSS variables
    this.cursorColor = this.extractCursorColor();
  }

  /**
   * Render the cursor line at the specified time position.
   *
   * @param viewport - Current viewport state for coordinate transforms
   * @param cursorTimeNs - Cursor position in nanoseconds, or null to hide
   */
  public render(viewport: ViewportState, cursorTimeNs: number | null): void {
    this.graphics.clear();

    if (cursorTimeNs === null) {
      return;
    }

    // Convert time to screen X coordinate
    const screenX = cursorTimeNs * viewport.zoom - viewport.offsetX;

    // Skip if cursor is outside visible area
    if (screenX < 0 || screenX > viewport.displayWidth) {
      return;
    }

    // Draw vertical line spanning full height
    // uiContainer uses standard screen coordinates (Y=0 at top)
    this.graphics.rect(
      screenX - CURSOR_LINE_WIDTH / 2,
      0,
      CURSOR_LINE_WIDTH,
      viewport.displayHeight,
    );
    this.graphics.fill({ color: this.cursorColor, alpha: CURSOR_LINE_OPACITY });
  }

  /**
   * Clear the cursor line.
   */
  public clear(): void {
    this.graphics.clear();
  }

  /**
   * Refresh colors from CSS variables (e.g., after theme change).
   */
  public refreshColors(): void {
    this.cursorColor = this.extractCursorColor();
  }

  /**
   * Extract cursor color from CSS variables.
   * Uses the same color as selection/focus for consistency.
   */
  private extractCursorColor(): number {
    const computedStyle = getComputedStyle(document.documentElement);

    // Use focus border color for cursor (matches VS Code selection)
    const colorStr =
      computedStyle.getPropertyValue('--vscode-editorCursor-foreground').trim() ||
      computedStyle.getPropertyValue('--vscode-focusBorder').trim() ||
      '#ffffff';

    return this.parseColorToHex(colorStr);
  }

  /**
   * Parse CSS color string to numeric hex.
   */
  private parseColorToHex(cssColor: string): number {
    if (!cssColor) {
      return DEFAULT_CURSOR_COLOR;
    }

    if (cssColor.startsWith('#')) {
      const hex = cssColor.slice(1);
      if (hex.length === 6) {
        return parseInt(hex, 16);
      }
      if (hex.length === 3) {
        const r = hex[0]!;
        const g = hex[1]!;
        const b = hex[2]!;
        return parseInt(r + r + g + g + b + b, 16);
      }
    }

    // rgba() fallback
    const rgba = cssColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)/);
    if (rgba) {
      const r = parseInt(rgba[1]!, 10);
      const g = parseInt(rgba[2]!, 10);
      const b = parseInt(rgba[3]!, 10);
      return (r << 16) | (g << 8) | b;
    }

    return DEFAULT_CURSOR_COLOR;
  }

  /**
   * Destroy renderer and cleanup resources.
   */
  public destroy(): void {
    this.graphics.destroy();
  }
}
