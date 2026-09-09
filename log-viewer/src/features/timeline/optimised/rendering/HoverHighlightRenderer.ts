/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * HoverHighlightRenderer - washes the frame under the pointer
 *
 * Chrome DevTools washes the hovered entry and keeps the outline for the selection, so a
 * hover and a select still read apart when both are on screen. The wash sits above the
 * frames and below the selection highlight.
 */

import * as PIXI from 'pixi.js';
import type { HoveredFrame, ViewportState } from '../../types/flamechart.types.js';
import { renderWash } from './HighlightRenderer.js';

/** How much of the wash colour reaches the frame beneath it. */
const WASH_ALPHA = 0.22;

/** Fallback wash colour, used until the host reports its theme. */
const DEFAULT_WASH_COLOR = 0xcccccc;

export class HoverHighlightRenderer {
  private graphics: PIXI.Graphics;
  private color: number;
  /** Whether a wash is on screen, so a clear can be skipped when there is nothing to clear. */
  private drawn = false;

  /**
   * @param container - PixiJS container to add graphics to (worldContainer)
   * @param washColor - Resolved wash color (0xRRGGBB)
   */
  constructor(container: PIXI.Container, washColor?: number) {
    this.graphics = new PIXI.Graphics();
    // Above the frames (0), below the search highlights (1, 2) and the selection (3): a
    // hover is momentary, so anything the user asked for outranks it.
    this.graphics.zIndex = 0.5;
    container.addChild(this.graphics);

    this.color = washColor ?? DEFAULT_WASH_COLOR;
  }

  /**
   * Wash the hovered frame, or clear when nothing is hovered.
   *
   * Stateless: the hovered frame is passed in on every render.
   *
   * @param viewport - Viewport state for transforms
   * @param hovered - The frame under the pointer and its depth, or null
   */
  public render(viewport: ViewportState, hovered: HoveredFrame | null): void {
    // PIXI marks the Graphics dirty on every clear, so an empty wash must not clear at all.
    if (!hovered && !this.drawn) {
      return;
    }

    this.graphics.clear();
    this.drawn = false;

    if (!hovered) {
      return;
    }

    renderWash(
      this.graphics,
      hovered.node.timestamp,
      hovered.node.duration,
      hovered.depth,
      viewport,
      this.color,
      WASH_ALPHA,
    );
    this.drawn = true;
  }

  /**
   * Update the wash colour after a theme change.
   *
   * @param washColor - Resolved wash color (0xRRGGBB)
   */
  public setColor(washColor: number): void {
    this.color = washColor;
  }

  /** Destroy renderer and cleanup resources. */
  public destroy(): void {
    this.graphics.destroy();
  }
}
