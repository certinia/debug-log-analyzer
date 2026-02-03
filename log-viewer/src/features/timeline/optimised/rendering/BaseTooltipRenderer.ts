/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * BaseTooltipRenderer
 *
 * Abstract base class for HTML tooltip renderers.
 * Provides common tooltip functionality:
 * - Element creation with VS Code theme styling
 * - Positioning with boundary clamping
 * - Show/hide lifecycle
 * - Theme updates
 *
 * Subclasses implement content generation via setTheme() for theme-specific colors.
 */

import { TOOLTIP_CSS } from './tooltip-utils.js';

/**
 * Positioning mode for tooltips.
 */
export type TooltipPositionMode =
  /** Center on X, position above Y */
  | 'centered-above'
  /** Position at cursor with offset, flip if needed */
  | 'cursor-offset'
  /** Center on X, position above Y but flip below if not enough room above */
  | 'adaptive';

/**
 * Options for tooltip positioning.
 */
export interface TooltipPositionOptions {
  /** Positioning mode */
  mode: TooltipPositionMode;
  /** Offset from reference point in pixels */
  offset?: number;
  /** Padding from container edges in pixels */
  padding?: number;
}

/**
 * Abstract base class for tooltip renderers.
 */
export abstract class BaseTooltipRenderer {
  /** HTML container for tooltip positioning. */
  protected container: HTMLElement;

  /** HTML tooltip element. */
  protected tooltipElement: HTMLDivElement;

  /** Whether dark theme is active. */
  protected isDarkTheme = true;

  /** Default positioning options. */
  protected positionOptions: TooltipPositionOptions;

  /**
   * Create a new tooltip renderer.
   *
   * @param container - HTML container for tooltip positioning
   * @param options - Positioning options
   */
  constructor(
    container: HTMLElement,
    options: TooltipPositionOptions = { mode: 'centered-above', offset: 8, padding: 4 },
  ) {
    this.container = container;
    this.positionOptions = options;

    this.tooltipElement = this.createTooltipElement();
    container.appendChild(this.tooltipElement);
  }

  /**
   * Set the theme for color selection.
   * Subclasses should override to update theme-specific state.
   *
   * @param isDark - Whether dark theme is active
   */
  public abstract setTheme(isDark: boolean): void;

  /**
   * Hide the tooltip.
   */
  public hide(): void {
    this.tooltipElement.style.display = 'none';
  }

  /**
   * Destroy the tooltip and cleanup.
   */
  public destroy(): void {
    this.tooltipElement.remove();
  }

  /**
   * Check if tooltip is currently visible.
   */
  public isVisible(): boolean {
    return this.tooltipElement.style.display !== 'none';
  }

  // ============================================================================
  // PROTECTED METHODS
  // ============================================================================

  /**
   * Create the HTML tooltip element with VS Code theme styling.
   * Subclasses can override to customize the element.
   */
  protected createTooltipElement(): HTMLDivElement {
    const tooltip = document.createElement('div');
    tooltip.style.cssText = `
      position: absolute;
      display: none;
      padding: 8px 12px;
      border-radius: 4px;
      background: ${TOOLTIP_CSS.background};
      border: 1px solid ${TOOLTIP_CSS.border};
      color: ${TOOLTIP_CSS.foreground};
      font-family: monospace;
      font-size: 11px;
      pointer-events: none;
      z-index: 200;
      white-space: nowrap;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
    `;
    return tooltip;
  }

  /**
   * Position the tooltip relative to a reference point.
   * Uses requestAnimationFrame for accurate dimensions.
   *
   * @param screenX - X position in container coordinates
   * @param screenY - Y position in container coordinates
   */
  protected positionTooltip(screenX: number, screenY: number): void {
    const { mode, offset = 8, padding = 4 } = this.positionOptions;

    requestAnimationFrame(() => {
      const tooltipWidth = this.tooltipElement.offsetWidth;
      const tooltipHeight = this.tooltipElement.offsetHeight;
      const containerWidth = this.container.offsetWidth;
      const containerHeight = this.container.offsetHeight;

      let left: number;
      let top: number;

      if (mode === 'centered-above') {
        // Center on X, position above Y
        left = screenX - tooltipWidth / 2;
        left = Math.max(padding, Math.min(containerWidth - tooltipWidth - padding, left));
        top = screenY - tooltipHeight - offset;
        top = Math.max(0, top);
      } else if (mode === 'adaptive') {
        // Center on X, position above Y but flip below if not enough room above
        left = screenX - tooltipWidth / 2;
        left = Math.max(padding, Math.min(containerWidth - tooltipWidth - padding, left));

        // Try above first
        const aboveTop = screenY - tooltipHeight - offset;
        // If there's room above, position above; otherwise position below
        if (aboveTop >= 0) {
          top = aboveTop;
        } else {
          // Position below the reference point (below the metric strip)
          top = screenY + offset;
          // Clamp to container bounds
          top = Math.min(containerHeight - tooltipHeight - padding, top);
        }
      } else {
        // Cursor offset mode: position to the right and below, flip if needed
        left = screenX + offset;
        top = screenY + offset;

        // Flip horizontally if needed
        if (left + tooltipWidth > containerWidth) {
          left = screenX - tooltipWidth - offset;
        }

        // Flip vertically if needed
        if (top + tooltipHeight > containerHeight) {
          top = screenY - tooltipHeight - offset;
        }

        // Clamp to bounds
        left = Math.max(0, Math.min(left, containerWidth - tooltipWidth));
        top = Math.max(0, Math.min(top, containerHeight - tooltipHeight));
      }

      this.tooltipElement.style.left = `${left}px`;
      this.tooltipElement.style.top = `${top}px`;
    });
  }

  /**
   * Show the tooltip element.
   * Call this after setting content.
   */
  protected showElement(): void {
    this.tooltipElement.style.display = 'block';
  }

  /**
   * Set the tooltip HTML content.
   *
   * @param html - HTML content string
   */
  protected setContent(html: string): void {
    this.tooltipElement.innerHTML = html;
  }
}
