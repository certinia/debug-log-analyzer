/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

/**
 * TimelineTooltipManager
 *
 * Manages HTML tooltip display for event hover interactions.
 * Handles tooltip positioning, content generation, and visibility.
 */

import type { LogEvent } from '../../../core/log-parser/LogEvents.js';

/**
 * Configuration options for tooltip behavior.
 */
export interface TooltipOptions {
  /** Delay before showing tooltip in milliseconds. Default: 100ms */
  showDelay?: number;

  /** Whether to flip tooltip position if it goes off-screen. Default: true */
  enableFlip?: boolean;

  /** Offset from cursor in pixels. Default: 10px */
  cursorOffset?: number;
}

export class TimelineTooltipManager {
  private container: HTMLElement;
  private tooltipElement: HTMLElement | null = null;
  private showTimeout: number | null = null;
  private options: Required<TooltipOptions>;
  private currentEvent: LogEvent | null = null;

  constructor(container: HTMLElement, options: TooltipOptions = {}) {
    this.container = container;

    // Apply default options
    this.options = {
      showDelay: options.showDelay ?? 100,
      enableFlip: options.enableFlip ?? true,
      cursorOffset: options.cursorOffset ?? 10,
    };

    this.createTooltipElement();
  }

  /**
   * Create tooltip HTML element and append to container.
   */
  private createTooltipElement(): void {
    this.tooltipElement = document.createElement('div');
    this.tooltipElement.className = 'timeline-tooltip';
    this.tooltipElement.style.cssText = `
      position: absolute;
      display: none;
      background: var(--vscode-editorHoverWidget-background, #252526);
      border: 1px solid var(--vscode-editorHoverWidget-border, #454545);
      border-radius: 3px;
      padding: 8px 12px;
      font-family: var(--vscode-font-family);
      font-size: 12px;
      color: var(--vscode-editorHoverWidget-foreground, #cccccc);
      z-index: 1000;
      pointer-events: none;
      max-width: 400px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    `;

    this.container.appendChild(this.tooltipElement);
  }

  /**
   * Show tooltip for an event at the specified mouse position.
   * @param event - Event to display tooltip for
   * @param mouseX - Mouse X position relative to container
   * @param mouseY - Mouse Y position relative to container
   */
  public show(event: LogEvent, mouseX: number, mouseY: number): void {
    // Cancel any pending show
    if (this.showTimeout !== null) {
      clearTimeout(this.showTimeout);
      this.showTimeout = null;
    }

    // If tooltip is already visible, update immediately (no delay between events)
    const wasVisible = this.tooltipElement?.style.display === 'block';

    // If different event and tooltip is visible, update immediately
    if (wasVisible && this.currentEvent !== event) {
      this.currentEvent = event;
      this.displayTooltip(event, mouseX, mouseY);
      return;
    }

    // If same event and visible, just update position
    if (this.currentEvent === event && wasVisible) {
      this.positionTooltip(mouseX, mouseY);
      return;
    }

    // New tooltip - apply delay
    this.currentEvent = event;
    this.showTimeout = window.setTimeout(() => {
      this.displayTooltip(event, mouseX, mouseY);
      this.showTimeout = null;
    }, this.options.showDelay);
  }

  /**
   * Hide tooltip immediately.
   */
  public hide(): void {
    // Cancel any pending show
    if (this.showTimeout !== null) {
      clearTimeout(this.showTimeout);
      this.showTimeout = null;
    }

    if (this.tooltipElement) {
      this.tooltipElement.style.display = 'none';
    }

    this.currentEvent = null;
  }

  /**
   * Display tooltip with event information.
   */
  private displayTooltip(event: LogEvent, mouseX: number, mouseY: number): void {
    if (!this.tooltipElement) return;

    // Generate tooltip content
    const content = this.generateTooltipContent(event);
    this.tooltipElement.innerHTML = content;

    // Show tooltip
    this.tooltipElement.style.display = 'block';

    // Position tooltip
    this.positionTooltip(mouseX, mouseY);
  }

  /**
   * Generate HTML content for tooltip based on event data.
   */
  private generateTooltipContent(event: LogEvent): string {
    const parts: string[] = [];

    // Event type
    if (event.type) {
      parts.push(
        `<div style="font-weight: 600; margin-bottom: 4px;">${this.escapeHtml(event.type)}</div>`,
      );
    }

    // Event category
    if (event.subCategory) {
      parts.push(
        `<div style="color: var(--vscode-descriptionForeground, #999); margin-bottom: 4px;">${this.escapeHtml(event.subCategory)}</div>`,
      );
    }

    // Duration
    if (event.duration) {
      const durationMs = (event.duration.total / 1_000_000).toFixed(3);
      parts.push(
        `<div style="margin-bottom: 4px;"><strong>Duration:</strong> ${durationMs}ms</div>`,
      );

      if (event.duration.self !== undefined) {
        const selfMs = (event.duration.self / 1_000_000).toFixed(3);
        parts.push(`<div style="margin-bottom: 4px;"><strong>Self:</strong> ${selfMs}ms</div>`);
      }
    }

    // Timestamp
    const timestampMs = (event.timestamp / 1_000_000).toFixed(3);
    parts.push(`<div style="margin-bottom: 4px;"><strong>Start:</strong> ${timestampMs}ms</div>`);

    // Line number
    if (event.lineNumber) {
      parts.push(
        `<div style="margin-bottom: 4px;"><strong>Line:</strong> ${event.lineNumber}</div>`,
      );
    }

    // Event text (truncated if too long)
    if (event.text) {
      const text = event.text.length > 100 ? event.text.substring(0, 100) + '...' : event.text;
      parts.push(
        `<div style="margin-top: 8px; color: var(--vscode-descriptionForeground, #999); font-size: 11px;">${this.escapeHtml(text)}</div>`,
      );
    }

    return parts.join('');
  }

  /**
   * Position tooltip relative to mouse, with boundary detection.
   */
  private positionTooltip(mouseX: number, mouseY: number): void {
    if (!this.tooltipElement) return;

    const containerRect = this.container.getBoundingClientRect();
    const tooltipRect = this.tooltipElement.getBoundingClientRect();

    const offset = this.options.cursorOffset;

    // Default position: below and to the right of cursor
    let x = mouseX + offset;
    let y = mouseY + offset;

    // Check if tooltip goes off right edge
    if (x + tooltipRect.width > containerRect.width) {
      x = mouseX - tooltipRect.width - offset;
    }

    // Check if tooltip goes off bottom edge
    if (y + tooltipRect.height > containerRect.height) {
      y = mouseY - tooltipRect.height - offset;
    }

    // Ensure tooltip stays within container bounds
    x = Math.max(0, Math.min(x, containerRect.width - tooltipRect.width));
    y = Math.max(0, Math.min(y, containerRect.height - tooltipRect.height));

    this.tooltipElement.style.left = `${x}px`;
    this.tooltipElement.style.top = `${y}px`;
  }

  /**
   * Escape HTML special characters to prevent XSS.
   */
  private escapeHtml(unsafe: string): string {
    return unsafe
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Clean up tooltip element.
   */
  public destroy(): void {
    if (this.showTimeout !== null) {
      clearTimeout(this.showTimeout);
      this.showTimeout = null;
    }

    if (this.tooltipElement && this.tooltipElement.parentNode) {
      this.tooltipElement.parentNode.removeChild(this.tooltipElement);
    }

    this.tooltipElement = null;
    this.currentEvent = null;
  }
}
