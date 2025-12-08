/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

/**
 * TextLabelRenderer
 *
 * Renders text labels on timeline event rectangles using PixiJS BitmapText.
 * Labels are created lazily (on first visibility) and never destroyed.
 *
 * Key behaviors:
 * - Labels created lazily when rect first becomes visible AND wide enough
 * - Once created, labels persist for session (never destroyed)
 * - Visibility + truncation updated per frame based on LOD
 * - Uses visibility toggle (not remove/add) for culling
 * - Labels "stick" to left edge of viewport when panning
 * - Middle truncation (e.g., "MyClass…method") for better context
 *
 * Performance characteristics:
 * - Target: <5ms for 1000 visible rectangles
 * - Memory: ~1MB typical, ~10MB worst case (if user zooms into everything)
 * - Zero GC after warmup (labels never destroyed)
 */

import { BitmapFont, BitmapText, Container } from 'pixi.js';
import type { ViewportState } from '../types/flamechart.types.js';
import { TEXT_LABEL_CONSTANTS, TIMELINE_CONSTANTS } from '../types/flamechart.types.js';
import type { PrecomputedRect } from './RectangleManager.js';

/**
 * TextLabelRenderer
 *
 * Manages BitmapText labels for timeline event rectangles.
 * Provides lazy creation, LOD-based visibility, and efficient truncation.
 */
export class TextLabelRenderer {
  /** Container for all text labels */
  private container: Container;

  /** Labels keyed by rectangle ID (created lazily, never destroyed) */
  private labels: Map<string, BitmapText> = new Map();

  /** Whether the font has been loaded/created */
  private fontReady = false;

  /**
   * Create a new TextLabelRenderer.
   *
   * @param parentContainer - The worldContainer to add labels to
   */
  constructor(parentContainer: Container) {
    this.container = new Container();
    this.container.zIndex = TEXT_LABEL_CONSTANTS.Z_INDEX;
    this.container.label = 'TextLabelRenderer';
    parentContainer.addChild(this.container);
  }

  /**
   * Initialize the BitmapFont for rendering.
   * Uses dynamic font creation instead of pre-generated MSDF for simplicity.
   *
   * Must be called before render().
   */
  public async loadFont(): Promise<void> {
    // Create BitmapFont dynamically from system font
    // This avoids the need for pre-generated MSDF font files
    // Character set: alphanumeric + common programming symbols
    const chars =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 ._()<>[]{}:;,!@#$%^&*-+=/?\'"`\\|~…';

    BitmapFont.install({
      name: TEXT_LABEL_CONSTANTS.FONT.FAMILY,
      style: {
        fontFamily: 'monospace',
        fontSize: TEXT_LABEL_CONSTANTS.FONT.SIZE * 2, // Generate at 2x for quality
        fill: TEXT_LABEL_CONSTANTS.FONT.COLOR,
        fontWeight: 'lighter',
      },
      chars,
    });

    this.fontReady = true;
  }

  /**
   * Update label visibility and truncation for visible rectangles.
   * Creates labels lazily for rectangles that are visible AND wide enough.
   * Labels "stick" to the left edge of the viewport when panning.
   *
   * @param culledRects - Rectangles grouped by category (from RectangleManager)
   * @param viewport - Current viewport state for sticky label positioning
   *
   * Performance target: <5ms for 1000 visible rectangles
   */
  public render(culledRects: Map<string, PrecomputedRect[]>, viewport: ViewportState): void {
    if (!this.fontReady) {
      return;
    }

    // Reset visibility for all existing labels
    for (const label of this.labels.values()) {
      label.visible = false;
    }

    // Calculate the left edge of the visible viewport in world coordinates
    const viewportLeftEdge = viewport.offsetX;
    const stickyLeftX = viewportLeftEdge + TEXT_LABEL_CONSTANTS.PADDING_LEFT;

    const fontHeightAdjustment = (TIMELINE_CONSTANTS.EVENT_HEIGHT - 4) / 2;
    const fontSize = TIMELINE_CONSTANTS.EVENT_HEIGHT - fontHeightAdjustment;
    const fontYPositionOffset = TIMELINE_CONSTANTS.EVENT_HEIGHT - fontHeightAdjustment / 2;

    // Process visible rectangles
    for (const rects of culledRects.values()) {
      for (const rect of rects) {
        // LOD: Skip small rectangles
        if (rect.width < TEXT_LABEL_CONSTANTS.MIN_VISIBLE_WIDTH) {
          continue;
        }

        const text = rect.eventRef.text;
        if (!text) {
          continue;
        }

        // Calculate label X position with sticky behavior
        // Label sticks to left edge of viewport when rect extends off-screen
        const rectLeftX = rect.x + TEXT_LABEL_CONSTANTS.PADDING_LEFT;
        const rectRightX = rect.x + rect.width - TEXT_LABEL_CONSTANTS.PADDING_RIGHT;

        // Use the rightmost of: rect left edge or viewport left edge
        const labelX = Math.max(rectLeftX, stickyLeftX);

        // Calculate available width from label position to rect right edge
        const availableWidth = rectRightX - labelX;

        // Skip if not enough room for text
        if (availableWidth < TEXT_LABEL_CONSTANTS.MIN_VISIBLE_WIDTH) {
          continue;
        }

        // Calculate truncated text based on available width
        const truncated = this.truncateText(text, availableWidth);
        if (!truncated) {
          continue;
        }

        // Lazy create: get existing or create new label
        let label = this.labels.get(rect.id);
        if (!label) {
          label = new BitmapText({
            text: '',
            style: {
              fontFamily: TEXT_LABEL_CONSTANTS.FONT.FAMILY,
              fontSize: fontSize,
            },
          });
          // Compensate for worldContainer Y-axis inversion
          label.scale.y = -1;
          this.container.addChild(label);
          this.labels.set(rect.id, label);
        }

        // Update label
        label.text = truncated;
        label.x = labelX;
        // Position near top of rectangle (in inverted Y space)
        label.y = rect.y + fontYPositionOffset;
        label.visible = true;
      }
    }
  }

  /**
   * Hide all labels (set visible = false).
   * Called when switching modes (e.g., search mode).
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
   * Preserves both the beginning and end of the text for better context.
   * E.g., "MyVeryLongClassName.method" -> "MyVery…method"
   * For very short space: "method" -> "m…"
   *
   * @param text - The text to truncate
   * @param availableWidth - Available width in pixels for the text
   * @returns Truncated text with ellipsis, or null if too narrow
   */
  private truncateText(text: string, availableWidth: number): string | null {
    const maxChars = Math.floor(availableWidth / TEXT_LABEL_CONSTANTS.CHAR_WIDTH);

    // Too narrow for any text (need at least 1 char + ellipsis = 2)
    if (maxChars < TEXT_LABEL_CONSTANTS.MIN_CHARS_WITH_ELLIPSIS) {
      return null;
    }

    // Full text fits
    if (text.length <= maxChars) {
      return text;
    }

    // For very short space (2-3 chars), just show start + ellipsis
    if (maxChars <= 3) {
      return text.slice(0, maxChars - 1) + TEXT_LABEL_CONSTANTS.ELLIPSIS;
    }

    // Middle truncation: keep start and end, ellipsis in middle
    // Reserve 1 char for ellipsis, split remaining chars between start and end
    const charsAvailable = maxChars - 1; // -1 for ellipsis
    const startChars = Math.ceil(charsAvailable / 2);
    const endChars = Math.floor(charsAvailable / 2);

    return (
      text.slice(0, startChars) + TEXT_LABEL_CONSTANTS.ELLIPSIS + text.slice(text.length - endChars)
    );
  }
}
