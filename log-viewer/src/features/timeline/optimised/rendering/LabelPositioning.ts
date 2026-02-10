/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * LabelPositioning
 *
 * Shared utilities for creating and positioning HTML labels in timeline overlays.
 * Used by MeasureRangeRenderer and AreaZoomRenderer for consistent tooltip styling.
 */

/**
 * Parameters for calculating label position.
 */
export interface LabelPositionParams {
  /** Label width in pixels (from getBoundingClientRect) */
  labelWidth: number;
  /** Label height in pixels (from getBoundingClientRect) */
  labelHeight: number;
  /** Screen X position of selection start (time * zoom - offsetX) */
  screenStartX: number;
  /** Screen X position of selection end (time * zoom - offsetX) */
  screenEndX: number;
  /** Viewport width in pixels */
  displayWidth: number;
  /** Viewport height in pixels */
  displayHeight: number;
  /** Padding from viewport edges in pixels (default: 8) */
  padding?: number;
}

/**
 * Result of label position calculation.
 */
export interface LabelPosition {
  /** Left offset in pixels */
  left: number;
  /** Top offset in pixels */
  top: number;
}

/**
 * Create a styled HTML label element for timeline overlays.
 * Uses VS Code theme variables for consistent appearance.
 *
 * @param className - CSS class name for the label element
 * @returns Styled div element, initially hidden
 */
export function createTimelineLabel(className: string): HTMLDivElement {
  const label = document.createElement('div');
  label.className = className;
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
 * Calculate smart label position for timeline overlays.
 *
 * Positioning strategy:
 * - Center in visible portion of selection when space permits
 * - Stick to viewport edge when selection is partially offscreen
 * - Center on viewport when both edges are offscreen
 * - Vertically center in viewport
 *
 * @param params - Label dimensions and viewport state
 * @returns Calculated left and top position in pixels
 */
export function calculateLabelPosition(params: LabelPositionParams): LabelPosition {
  const {
    labelWidth,
    labelHeight,
    screenStartX,
    screenEndX,
    displayWidth,
    displayHeight,
    padding = 8,
  } = params;

  // Calculate visible portion of selection
  const visibleStartX = Math.max(screenStartX, 0);
  const visibleEndX = Math.min(screenEndX, displayWidth);
  const visibleWidth = visibleEndX - visibleStartX;

  // Try to center in visible portion first
  const centeredLeft = visibleStartX + (visibleWidth - labelWidth) / 2;

  let left: number;

  if (visibleWidth >= labelWidth + padding * 2) {
    // Visible portion is wide enough: center tooltip in visible portion
    left = centeredLeft;
  } else if (screenStartX < 0 && screenEndX > displayWidth) {
    // Both edges offscreen: center on viewport
    left = (displayWidth - labelWidth) / 2;
  } else if (screenStartX < 0) {
    // Left edge offscreen, right visible: stick to left edge of viewport
    left = padding;
  } else if (screenEndX > displayWidth) {
    // Right edge offscreen, left visible: stick to right edge of viewport
    left = displayWidth - labelWidth - padding;
  } else {
    // Selection is small but fully visible: center on selection (may extend outside)
    left = centeredLeft;
  }

  // Clamp to viewport bounds
  left = Math.max(padding, Math.min(displayWidth - labelWidth - padding, left));

  // Vertical center, clamped to viewport
  const top = Math.max(
    padding,
    Math.min(displayHeight - labelHeight - padding, displayHeight / 2 - labelHeight / 2),
  );

  return { left, top };
}
