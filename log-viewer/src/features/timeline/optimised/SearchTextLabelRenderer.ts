/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

/**
 * SearchTextLabelRenderer
 *
 * Renders text labels with search-aware styling.
 * Matched events: full opacity (alpha 1.0)
 * Non-matched events: dimmed (alpha 0.4)
 *
 * Follows the same pattern as SearchStyleRenderer:
 * - Separate render passes for matched vs non-matched
 * - Lazy label creation, never destroyed
 * - clear() for mode switching
 * - destroy() for cleanup
 */

import { BitmapFont, BitmapText, Container } from 'pixi.js';
import type { ViewportState } from '../types/flamechart.types.js';
import { TEXT_LABEL_CONSTANTS, TIMELINE_CONSTANTS } from '../types/flamechart.types.js';
import type { PrecomputedRect } from './RectangleManager.js';

/**
 * SearchTextLabelRenderer
 *
 * Manages BitmapText labels for timeline events in search mode.
 * Renders matched events with full opacity, non-matched events dimmed.
 */
export class SearchTextLabelRenderer {
  /** Container for all text labels */
  private container: Container;

  /** Labels keyed by rectangle ID (created lazily, never destroyed) */
  private labels: Map<string, BitmapText> = new Map();

  /** Whether the font has been loaded/created */
  private fontReady = false;

  /**
   * Create a new SearchTextLabelRenderer.
   *
   * @param parentContainer - The worldContainer to add labels to
   */
  constructor(parentContainer: Container) {
    this.container = new Container();
    this.container.zIndex = TEXT_LABEL_CONSTANTS.Z_INDEX;
    this.container.label = 'SearchTextLabelRenderer';
    parentContainer.addChild(this.container);
  }

  /**
   * Initialize the BitmapFont for rendering.
   * Uses the same dynamic font creation as TextLabelRenderer.
   *
   * Must be called before render().
   */
  public async loadFont(): Promise<void> {
    // Create BitmapFont dynamically from system font
    const chars =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 ._()<>[]{}:;,!@#$%^&*-+=/?\'"`\\|~…';

    BitmapFont.install({
      name: TEXT_LABEL_CONSTANTS.FONT.FAMILY,
      style: {
        fontFamily: 'monospace',
        fontSize: TEXT_LABEL_CONSTANTS.FONT.SIZE * 2,
        fill: TEXT_LABEL_CONSTANTS.FONT.COLOR,
        fontWeight: 'lighter',
      },
      chars,
    });

    this.fontReady = true;
  }

  /**
   * Render text labels with search-aware styling.
   * Two passes: matched events (full opacity), non-matched events (dimmed).
   *
   * @param culledRects - Rectangles grouped by category (from RectangleManager)
   * @param matchedEventIds - Set of event IDs that match search
   * @param viewport - Current viewport state for sticky label positioning
   */
  public render(
    culledRects: Map<string, PrecomputedRect[]>,
    matchedEventIds: ReadonlySet<string>,
    viewport: ViewportState,
  ): void {
    if (!this.fontReady) {
      return;
    }

    // Reset visibility for all existing labels
    for (const label of this.labels.values()) {
      label.visible = false;
    }

    const viewportLeftEdge = viewport.offsetX;

    // First pass: Render matched events with full opacity
    this.renderLabels(culledRects, viewport, viewportLeftEdge, matchedEventIds, true, 1.0);

    // Second pass: Render non-matched events with dimmed opacity
    this.renderLabels(culledRects, viewport, viewportLeftEdge, matchedEventIds, false, 0.4);
  }

  /**
   * Render labels for either matched or non-matched events.
   *
   * @param culledRects - Rectangles grouped by category
   * @param viewport - Current viewport state
   * @param viewportLeftEdge - Left edge of viewport in world coordinates
   * @param matchedEventIds - Set of matched event IDs
   * @param renderMatched - If true, render matched events; if false, render non-matched
   * @param alpha - Opacity for rendered labels (1.0 = full, 0.4 = dimmed)
   */
  private renderLabels(
    culledRects: Map<string, PrecomputedRect[]>,
    viewport: ViewportState,
    viewportLeftEdge: number,
    matchedEventIds: ReadonlySet<string>,
    renderMatched: boolean,
    alpha: number,
  ): void {
    const fontHeightAdjustment = (TIMELINE_CONSTANTS.EVENT_HEIGHT - 4) / 2;
    const fontSize = TIMELINE_CONSTANTS.EVENT_HEIGHT - fontHeightAdjustment;
    const fontYPositionOffset = TIMELINE_CONSTANTS.EVENT_HEIGHT - fontHeightAdjustment / 2;

    for (const rects of culledRects.values()) {
      for (const rect of rects) {
        // Filter: only process matched or non-matched based on renderMatched flag
        const isMatch = matchedEventIds.has(rect.id);
        if (isMatch !== renderMatched) {
          continue;
        }

        // LOD: Skip small rectangles
        if (rect.width < TEXT_LABEL_CONSTANTS.MIN_VISIBLE_WIDTH) {
          continue;
        }

        const text = rect.eventRef.text;
        if (!text) {
          continue;
        }

        // Calculate sticky label position
        const rectLeftX = rect.x + TEXT_LABEL_CONSTANTS.PADDING_LEFT;
        const rectRightX = rect.x + rect.width - TEXT_LABEL_CONSTANTS.PADDING_RIGHT;
        const stickyLeftX = viewportLeftEdge + TEXT_LABEL_CONSTANTS.PADDING_LEFT;
        const labelX = Math.max(rectLeftX, stickyLeftX);

        // Calculate available width
        const availableWidth = rectRightX - labelX;
        if (availableWidth < TEXT_LABEL_CONSTANTS.MIN_VISIBLE_WIDTH) {
          continue;
        }

        // Calculate truncated text
        const truncated = this.truncateText(text, availableWidth);
        if (!truncated) {
          continue;
        }

        // Lazy create or reuse label
        let label = this.labels.get(rect.id);
        if (!label) {
          label = new BitmapText({
            text: '',
            style: {
              fontFamily: TEXT_LABEL_CONSTANTS.FONT.FAMILY,
              fontSize: fontSize,
            },
          });
          label.scale.y = -1; // Compensate for worldContainer Y-axis inversion
          this.container.addChild(label);
          this.labels.set(rect.id, label);
        }

        // Update label
        label.text = truncated;
        label.x = labelX;
        label.y = rect.y + fontYPositionOffset;
        label.alpha = alpha;
        label.visible = true;
      }
    }
  }

  /**
   * Hide all labels (set visible = false).
   * Called when switching to normal mode.
   */
  public clear(): void {
    for (const label of this.labels.values()) {
      label.visible = false;
    }
  }

  /**
   * Clean up all labels and remove from container.
   * Called when FlameChart is destroyed.
   */
  public destroy(): void {
    for (const label of this.labels.values()) {
      label.destroy();
    }
    this.labels.clear();
    this.container.destroy();
  }

  /**
   * Truncate text to fit within available width using middle truncation.
   * Same logic as TextLabelRenderer.
   *
   * @param text - The text to truncate
   * @param availableWidth - Available width in pixels for the text
   * @returns Truncated text with ellipsis, or null if too narrow
   */
  private truncateText(text: string, availableWidth: number): string | null {
    const maxChars = Math.floor(availableWidth / TEXT_LABEL_CONSTANTS.CHAR_WIDTH);

    if (maxChars < TEXT_LABEL_CONSTANTS.MIN_CHARS_WITH_ELLIPSIS) {
      return null;
    }

    if (text.length <= maxChars) {
      return text;
    }

    if (maxChars <= 3) {
      return text.slice(0, maxChars - 1) + TEXT_LABEL_CONSTANTS.ELLIPSIS;
    }

    const charsAvailable = maxChars - 1;
    const startChars = Math.ceil(charsAvailable / 2);
    const endChars = Math.floor(charsAvailable / 2);

    return (
      text.slice(0, startChars) + TEXT_LABEL_CONSTANTS.ELLIPSIS + text.slice(text.length - endChars)
    );
  }
}
