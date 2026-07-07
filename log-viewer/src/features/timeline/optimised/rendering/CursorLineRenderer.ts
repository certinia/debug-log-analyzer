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

  /** Cursor line color */
  private cursorColor: number;

  /**
   * @param container - PixiJS container to add graphics to (uiContainer)
   * @param cursorColor - Resolved cursor color (0xRRGGBB)
   */
  constructor(container: PIXI.Container, cursorColor: number = DEFAULT_CURSOR_COLOR) {
    this.graphics = new PIXI.Graphics();
    // Position above other UI elements
    this.graphics.zIndex = 10;
    container.addChild(this.graphics);

    this.cursorColor = cursorColor;
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
   * Update cursor color (e.g., after theme change).
   *
   * @param cursorColor - Resolved cursor color (0xRRGGBB)
   */
  public setColor(cursorColor: number): void {
    this.cursorColor = cursorColor;
  }

  /**
   * Destroy renderer and cleanup resources.
   */
  public destroy(): void {
    this.graphics.destroy();
  }
}
