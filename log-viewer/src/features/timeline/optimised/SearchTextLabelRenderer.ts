/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

/**
 * SearchTextLabelRenderer
 *
 * Renders text labels with search-aware styling using composition.
 * Delegates matched event labels to TextLabelRenderer (full opacity).
 * Renders non-matched event labels itself (dimmed at 0.4 alpha).
 *
 * Architecture:
 * - Uses TextLabelRenderer for matched text (full opacity 1.0)
 * - Manages own container/labels for unmatched text (dimmed 0.4)
 * - No font loading needed (shares font with TextLabelRenderer)
 */

import { BitmapText, Container } from 'pixi.js';
import type { ViewportState } from '../types/flamechart.types.js';
import { TEXT_LABEL_CONSTANTS, TIMELINE_CONSTANTS } from '../types/flamechart.types.js';
import type { PrecomputedRect } from './RectangleManager.js';
import type { TextLabelRenderer } from './TextLabelRenderer.js';

/** Alpha value for dimmed (non-matched) labels */
const DIMMED_ALPHA = 0.4;

/**
 * SearchTextLabelRenderer
 *
 * Manages BitmapText labels for timeline events in search mode.
 * Renders matched events via TextLabelRenderer, non-matched events dimmed.
 */
export class SearchTextLabelRenderer {
  /** Container for unmatched (dimmed) text labels */
  private container: Container;

  /** Labels for unmatched events keyed by rectangle ID */
  private labels: Map<string, BitmapText> = new Map();

  /**
   * Create a new SearchTextLabelRenderer.
   *
   * @param parentContainer - The worldContainer to add labels to
   * @param textLabelRenderer - TextLabelRenderer instance for rendering matched labels
   */
  constructor(
    parentContainer: Container,
    private textLabelRenderer: TextLabelRenderer,
  ) {
    this.container = new Container();
    this.container.zIndex = TEXT_LABEL_CONSTANTS.Z_INDEX;
    this.container.label = 'SearchTextLabelRenderer';
    parentContainer.addChild(this.container);
  }

  /**
   * Render text labels with search-aware styling.
   * Matched events are rendered by TextLabelRenderer (full opacity).
   * Non-matched events are rendered here (dimmed).
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
    // Reset visibility for unmatched labels (managed by this renderer)
    for (const label of this.labels.values()) {
      label.visible = false;
    }

    // Render unmatched events (dimmed) - managed by this renderer
    this.renderUnmatchedLabels(culledRects, matchedEventIds, viewport);

    // Filter to matched rects only, then delegate to TextLabelRenderer
    const matchedRects = this.filterMatchedRects(culledRects, matchedEventIds);
    this.textLabelRenderer.render(matchedRects, viewport);
  }

  /**
   * Filter culledRects to only include rectangles that match the search.
   *
   * @param culledRects - All visible rectangles grouped by category
   * @param matchedEventIds - Set of event IDs that match search
   * @returns Filtered map containing only matched rectangles
   */
  private filterMatchedRects(
    culledRects: Map<string, PrecomputedRect[]>,
    matchedEventIds: ReadonlySet<string>,
  ): Map<string, PrecomputedRect[]> {
    const result = new Map<string, PrecomputedRect[]>();
    for (const [category, rects] of culledRects) {
      const matched = rects.filter((r) => matchedEventIds.has(r.id));
      if (matched.length > 0) {
        result.set(category, matched);
      }
    }
    return result;
  }

  /**
   * Render labels for non-matched events with dimmed opacity.
   *
   * @param culledRects - Rectangles grouped by category
   * @param matchedEventIds - Set of matched event IDs
   * @param viewport - Current viewport state
   */
  private renderUnmatchedLabels(
    culledRects: Map<string, PrecomputedRect[]>,
    matchedEventIds: ReadonlySet<string>,
    viewport: ViewportState,
  ): void {
    const viewportLeftEdge = viewport.offsetX;
    const stickyLeftX = viewportLeftEdge + TEXT_LABEL_CONSTANTS.PADDING_LEFT;

    const fontHeightAdjustment = (TIMELINE_CONSTANTS.EVENT_HEIGHT - 4) / 2;
    const fontSize = TIMELINE_CONSTANTS.EVENT_HEIGHT - fontHeightAdjustment;
    const fontYPositionOffset = TIMELINE_CONSTANTS.EVENT_HEIGHT - fontHeightAdjustment / 2;

    for (const rects of culledRects.values()) {
      for (const rect of rects) {
        // Only process non-matched events
        if (matchedEventIds.has(rect.id)) {
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
        label.alpha = DIMMED_ALPHA;
        label.visible = true;
      }
    }
  }

  /**
   * Hide all unmatched labels (set visible = false).
   * Called when switching to normal mode.
   * Note: Does NOT clear TextLabelRenderer - FlameChart manages that separately.
   */
  public clear(): void {
    for (const label of this.labels.values()) {
      label.visible = false;
    }
  }

  /**
   * Clean up all labels and remove from container.
   * Called when FlameChart is destroyed.
   * Note: Does NOT destroy TextLabelRenderer (managed by FlameChart).
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
