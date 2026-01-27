/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

/**
 * AreaZoomRenderer
 *
 * Renders the area zoom overlay using a "spotlight" effect like Chrome DevTools.
 * Instead of highlighting the selection, it dims the areas OUTSIDE the selection,
 * creating a clear visual focus on what will be zoomed.
 *
 * Visual design:
 * - Dark (30% opacity) overlay on areas OUTSIDE the selection
 * - Selection area stays clear/bright
 * - Thin white edge lines for definition
 * - Centered label showing duration
 */

import * as PIXI from 'pixi.js';
import { formatDuration } from '../../../../core/utility/Util.js';
import type { ViewportState } from '../../types/flamechart.types.js';
import type { MeasurementState } from './MeasurementManager.js';

/** Opacity for the dim overlay outside the selection */
const DIM_ALPHA = 0.3;

/** Width of the edge lines in pixels */
const EDGE_LINE_WIDTH = 2;

/** Edge line opacity */
const EDGE_LINE_ALPHA = 0.5;

/**
 * AreaZoomRenderer
 *
 * Renders spotlight-style area zoom overlay with PixiJS Graphics and HTML label.
 */
export class AreaZoomRenderer {
  /** Graphics for the overlay */
  private graphics: PIXI.Graphics;

  /** HTML container for the label */
  private labelElement: HTMLDivElement;

  /** Parent HTML container for positioning */
  private container: HTMLElement;

  /**
   * @param pixiContainer - PixiJS container for graphics (worldContainer)
   * @param htmlContainer - HTML container for label positioning
   */
  constructor(pixiContainer: PIXI.Container, htmlContainer: HTMLElement) {
    this.container = htmlContainer;

    // Create graphics for overlay - render above frames but below tooltips
    this.graphics = new PIXI.Graphics();
    this.graphics.zIndex = 5; // Above measurement overlay (4)
    pixiContainer.addChild(this.graphics);

    // Create HTML label element
    this.labelElement = this.createLabelElement();
    htmlContainer.appendChild(this.labelElement);
  }

  /**
   * Create the HTML label element with styling.
   */
  private createLabelElement(): HTMLDivElement {
    const label = document.createElement('div');
    label.className = 'area-zoom-label';
    label.style.cssText = `
      position: absolute;
      display: none;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 8px 12px;
      border-radius: 4px;
      background: var(--vscode-editorWidget-background, #252526);
      border: 1px solid var(--vscode-editorWidget-border, #454545);
      color: var(--vscode-editorWidget-foreground, #cccccc);
      font-family: var(--vscode-font-family, sans-serif);
      font-size: 12px;
      pointer-events: none;
      z-index: 100;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    `;
    return label;
  }

  /**
   * Render the area zoom overlay and label.
   * Uses spotlight effect: dims OUTSIDE the selection.
   *
   * @param viewport - Current viewport state
   * @param state - Area zoom state (normalized: startTime <= endTime)
   */
  public render(viewport: ViewportState, state: MeasurementState | null): void {
    this.graphics.clear();

    if (!state) {
      this.labelElement.style.display = 'none';
      return;
    }

    const { startTime, endTime } = state;

    // Calculate screen positions (in world coordinates, before viewport offset)
    const screenStartX = startTime * viewport.zoom;
    const screenEndX = endTime * viewport.zoom;

    // Full height - extend well beyond viewport for vertical panning
    const screenY = -viewport.displayHeight;
    const screenHeight = viewport.displayHeight * 3;

    // Draw LEFT dim area (from viewport start to selection start)
    const leftDimX = -viewport.offsetX;
    const leftDimWidth = screenStartX + viewport.offsetX;
    if (leftDimWidth > 0) {
      this.graphics.rect(leftDimX, screenY, leftDimWidth, screenHeight);
      this.graphics.fill({ color: 0x000000, alpha: DIM_ALPHA });
    }

    // Draw RIGHT dim area (from selection end to viewport end)
    const rightDimX = screenEndX;
    const rightDimWidth = viewport.displayWidth + viewport.offsetX - screenEndX;
    if (rightDimWidth > 0) {
      this.graphics.rect(rightDimX, screenY, rightDimWidth, screenHeight);
      this.graphics.fill({ color: 0x000000, alpha: DIM_ALPHA });
    }

    // Draw thin white edge lines for clarity
    this.graphics.rect(screenStartX - EDGE_LINE_WIDTH / 2, screenY, EDGE_LINE_WIDTH, screenHeight);
    this.graphics.fill({ color: 0xffffff, alpha: EDGE_LINE_ALPHA });

    this.graphics.rect(screenEndX - EDGE_LINE_WIDTH / 2, screenY, EDGE_LINE_WIDTH, screenHeight);
    this.graphics.fill({ color: 0xffffff, alpha: EDGE_LINE_ALPHA });

    // Update label position and content
    this.updateLabel(viewport, state);
  }

  /**
   * Update the HTML label position and content.
   * Shows duration only (no zoom icon since zoom happens automatically on release).
   */
  private updateLabel(viewport: ViewportState, state: MeasurementState): void {
    const { startTime, endTime } = state;
    const duration = endTime - startTime;

    // Calculate screen bounds of selection
    const screenStartX = startTime * viewport.zoom - viewport.offsetX;
    const screenEndX = endTime * viewport.zoom - viewport.offsetX;

    // Check if fully offscreen
    if (screenEndX < 0 || screenStartX > viewport.displayWidth) {
      this.labelElement.style.display = 'none';
      return;
    }

    // Format times
    const durationStr = formatDuration(duration);
    const startStr = formatDuration(startTime);
    const endStr = formatDuration(endTime);

    // Update label content - duration, time range, and instruction
    this.labelElement.innerHTML = `
      <div style="text-align: center;">
        <div style="font-size: 14px; font-weight: 600;">${durationStr}</div>
        <div style="font-size: 11px; opacity: 0.8; margin-top: 2px;">${startStr} → ${endStr}</div>
        <div style="font-size: 10px; opacity: 0.6; margin-top: 4px;">Release to zoom</div>
      </div>
    `;

    // Show label
    this.labelElement.style.display = 'flex';

    // Position label after content is set (need to measure label size)
    requestAnimationFrame(() => {
      const labelRect = this.labelElement.getBoundingClientRect();
      const labelWidth = labelRect.width;
      const labelHeight = labelRect.height;
      const padding = 8;

      // Calculate visible portion of selection
      const visibleStartX = Math.max(screenStartX, 0);
      const visibleEndX = Math.min(screenEndX, viewport.displayWidth);
      const visibleWidth = visibleEndX - visibleStartX;

      // Determine horizontal position - center in visible portion
      let left: number;

      const centeredLeft = visibleStartX + (visibleWidth - labelWidth) / 2;

      if (visibleWidth >= labelWidth + padding * 2) {
        // Visible portion is wide enough: center tooltip in visible portion
        left = centeredLeft;
      } else if (screenStartX < 0 && screenEndX > viewport.displayWidth) {
        // Both edges offscreen: center on viewport
        left = (viewport.displayWidth - labelWidth) / 2;
      } else if (screenStartX < 0) {
        // Left edge offscreen, right visible: stick to left edge of viewport
        left = padding;
      } else if (screenEndX > viewport.displayWidth) {
        // Right edge offscreen, left visible: stick to right edge of viewport
        left = viewport.displayWidth - labelWidth - padding;
      } else {
        // Selection is small but fully visible: center on selection (may extend outside)
        left = centeredLeft;
      }

      // Clamp to viewport bounds
      left = Math.max(padding, Math.min(viewport.displayWidth - labelWidth - padding, left));

      // Vertical center
      const top = Math.max(
        padding,
        Math.min(
          viewport.displayHeight - labelHeight - padding,
          viewport.displayHeight / 2 - labelHeight / 2,
        ),
      );

      this.labelElement.style.left = `${left}px`;
      this.labelElement.style.top = `${top}px`;
    });
  }

  /**
   * Clear the area zoom display.
   */
  public clear(): void {
    this.graphics.clear();
    this.labelElement.style.display = 'none';
  }

  /**
   * Destroy renderer and cleanup resources.
   */
  public destroy(): void {
    this.graphics.destroy();
    this.labelElement.remove();
  }
}
