/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

/**
 * MeasureRangeRenderer
 *
 * Renders the measurement overlay and label for the Measure Range feature.
 * Shows a semi-transparent overlay between start and end times with
 * duration and endpoint times displayed in a centered label.
 *
 * Visual design:
 * - Semi-transparent overlay using VS Code selection colors
 * - 4px solid borders on left/right edges (distinguishable from axis lines)
 * - Full height (extends beyond viewport for vertical panning)
 * - Centered label showing duration and start/end times
 */

import * as PIXI from 'pixi.js';
import { formatDuration, formatTimeRange } from '../../../../core/utility/Util.js';
import type { ViewportState } from '../../types/flamechart.types.js';
import { parseColorToHex } from '../rendering/ColorUtils.js';
import { calculateLabelPosition, createTimelineLabel } from '../rendering/LabelPositioning.js';
import type { MeasurementState } from './MeasurementManager.js';

/**
 * Colors for the measurement overlay, extracted from CSS variables.
 */
interface MeasurementColors {
  /** Fill color for overlay (0xRRGGBB) */
  fillColor: number;
  /** Border color (0xRRGGBB) */
  borderColor: number;
}

/** Border width in pixels - wider than axis lines (1px) to avoid confusion */
const BORDER_WIDTH = 3;

/** Minimum visible width for the overlay */
const MIN_OVERLAY_WIDTH = 3;

/**
 * MeasureRangeRenderer
 *
 * Renders measurement overlay with PixiJS Graphics and HTML label.
 */
export class MeasureRangeRenderer {
  /** Graphics for the overlay (renders behind frames) */
  private graphics: PIXI.Graphics;

  /** HTML container for the label (avoids PIXI coordinate inversion issues) */
  private labelElement: HTMLDivElement;

  /** Parent HTML container for positioning */
  private container: HTMLElement;

  /** Cached colors from CSS variables */
  private colors: MeasurementColors;

  /** Optional callback when zoom icon is clicked */
  private onZoomClick?: () => void;

  /**
   * @param pixiContainer - PixiJS container for graphics (worldContainer)
   * @param htmlContainer - HTML container for label positioning
   * @param onZoomClick - Optional callback when zoom icon is clicked
   */
  constructor(pixiContainer: PIXI.Container, htmlContainer: HTMLElement, onZoomClick?: () => void) {
    this.container = htmlContainer;
    this.onZoomClick = onZoomClick;

    // Create graphics for overlay - render above frames but below tooltips
    this.graphics = new PIXI.Graphics();
    this.graphics.zIndex = 4; // Above frames (0) and selection highlight (3), below tooltips (HTML 100+)
    pixiContainer.addChild(this.graphics);

    // Create HTML label element
    this.labelElement = this.createLabelElement();
    htmlContainer.appendChild(this.labelElement);

    // Extract colors from CSS variables
    this.colors = this.extractColors();
  }

  /**
   * Create the HTML label element with styling.
   */
  private createLabelElement(): HTMLDivElement {
    return createTimelineLabel('measure-range-label');
  }

  /**
   * Extract measurement colors from CSS variables.
   * Uses VS Code selection colors for theme compatibility.
   */
  private extractColors(): MeasurementColors {
    const computedStyle = getComputedStyle(document.documentElement);

    // Selection background for fill
    const fillStr =
      computedStyle.getPropertyValue('--vscode-editor-selectionBackground').trim() ||
      'rgba(38, 79, 120, 0.5)';

    // Selection highlight border or fallback to a visible color
    const borderStr =
      computedStyle.getPropertyValue('--vscode-editor-selectionHighlightBorder').trim() ||
      computedStyle.getPropertyValue('--vscode-focusBorder').trim() ||
      '#007fd4';

    // Default blue (0x264f78) for measurement overlay
    const defaultBlue = 0x264f78;

    return {
      fillColor: parseColorToHex(fillStr, defaultBlue),
      borderColor: parseColorToHex(borderStr, defaultBlue),
    };
  }

  /**
   * Render the measurement overlay and label.
   *
   * @param viewport - Current viewport state
   * @param measurement - Measurement state (normalized: startTime <= endTime)
   */
  public render(viewport: ViewportState, measurement: MeasurementState | null): void {
    this.graphics.clear();

    if (!measurement) {
      this.labelElement.style.display = 'none';
      return;
    }

    const { startTime, endTime } = measurement;

    // Calculate screen positions
    const screenStartX = startTime * viewport.zoom;
    const screenEndX = endTime * viewport.zoom;
    const screenWidth = Math.max(screenEndX - screenStartX, MIN_OVERLAY_WIDTH);

    // Full height - extend well beyond viewport for vertical panning
    const screenY = -viewport.displayHeight;
    const screenHeight = viewport.displayHeight * 3;

    // Draw overlay fill
    this.graphics.rect(screenStartX, screenY, screenWidth, screenHeight);
    this.graphics.fill({ color: this.colors.fillColor, alpha: 0.3 });

    // Draw left border (4px wide)
    this.graphics.rect(screenStartX - BORDER_WIDTH / 2, screenY, BORDER_WIDTH, screenHeight);
    this.graphics.fill({ color: this.colors.borderColor, alpha: 0.9 });

    // Draw right border (4px wide)
    this.graphics.rect(screenEndX - BORDER_WIDTH / 2, screenY, BORDER_WIDTH, screenHeight);
    this.graphics.fill({ color: this.colors.borderColor, alpha: 0.9 });

    // Update label position and content
    this.updateLabel(viewport, measurement);
  }

  /**
   * Update the HTML label position and content.
   * Smart positioning: center in visible portion, stick to edge when partially offscreen,
   * hide when fully offscreen.
   */
  private updateLabel(viewport: ViewportState, measurement: MeasurementState): void {
    const { startTime, endTime, isActive } = measurement;
    const duration = endTime - startTime;

    // Calculate screen bounds of measurement
    const screenStartX = startTime * viewport.zoom - viewport.offsetX;
    const screenEndX = endTime * viewport.zoom - viewport.offsetX;

    // Check if fully offscreen
    if (screenEndX < 0 || screenStartX > viewport.displayWidth) {
      this.labelElement.style.display = 'none';
      return;
    }

    // Format times using shared utilities
    const durationStr = formatDuration(duration);
    const rangeStr = formatTimeRange(startTime, endTime);

    // Only show zoom icon when measurement is finished (not while dragging)
    const zoomIconHtml =
      !isActive && this.onZoomClick
        ? `<button class="measure-zoom-icon" style="
          display: flex;
          align-items: center;
          justify-content: center;
          width: 24px;
          height: 24px;
          margin-left: 8px;
          padding: 0;
          border: none;
          border-radius: 4px;
          background: var(--vscode-button-secondaryBackground, #3a3d41);
          color: var(--vscode-button-secondaryForeground, #cccccc);
          cursor: pointer;
          pointer-events: auto;
          transition: background 0.1s;
        " title="Zoom to fit (double-click)">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z"/>
            <path d="M6.5 3a.5.5 0 0 1 .5.5V6h2.5a.5.5 0 0 1 0 1H7v2.5a.5.5 0 0 1-1 0V7H3.5a.5.5 0 0 1 0-1H6V3.5a.5.5 0 0 1 .5-.5z"/>
          </svg>
        </button>`
        : '';

    // Update label content with centered duration
    this.labelElement.innerHTML = `
      <div style="display: flex; align-items: center;">
        <div style="text-align: center;">
          <div style="font-size: 14px; font-weight: 600;">${durationStr}</div>
          <div style="font-size: 11px; opacity: 0.8; margin-top: 2px;">${rangeStr}</div>
        </div>
        ${zoomIconHtml}
      </div>
    `;

    // Add click listener to zoom icon
    if (!isActive && this.onZoomClick) {
      const zoomIcon = this.labelElement.querySelector('.measure-zoom-icon');
      if (zoomIcon) {
        zoomIcon.addEventListener('click', (e) => {
          e.stopPropagation();
          this.onZoomClick?.();
        });
        // Hover effect
        zoomIcon.addEventListener('mouseenter', () => {
          (zoomIcon as HTMLElement).style.background =
            'var(--vscode-button-secondaryHoverBackground, #45494e)';
        });
        zoomIcon.addEventListener('mouseleave', () => {
          (zoomIcon as HTMLElement).style.background =
            'var(--vscode-button-secondaryBackground, #3a3d41)';
        });
      }
    }

    // Show label
    this.labelElement.style.display = 'flex';

    // Position label after content is set (need to measure label size)
    requestAnimationFrame(() => {
      const labelRect = this.labelElement.getBoundingClientRect();
      const { left, top } = calculateLabelPosition({
        labelWidth: labelRect.width,
        labelHeight: labelRect.height,
        screenStartX,
        screenEndX,
        displayWidth: viewport.displayWidth,
        displayHeight: viewport.displayHeight,
      });

      this.labelElement.style.left = `${left}px`;
      this.labelElement.style.top = `${top}px`;
    });
  }

  /**
   * Clear the measurement display.
   */
  public clear(): void {
    this.graphics.clear();
    this.labelElement.style.display = 'none';
  }

  /**
   * Refresh colors from CSS variables (e.g., after theme change).
   */
  public refreshColors(): void {
    this.colors = this.extractColors();
  }

  /**
   * Destroy renderer and cleanup resources.
   */
  public destroy(): void {
    this.graphics.destroy();
    this.labelElement.remove();
  }
}
