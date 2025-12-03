/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

/**
 * TimelineTooltipManager
 *
 * Manages HTML tooltip display for event hover interactions.
 * Handles tooltip positioning, content generation, and visibility.
 */

import type { ApexLog, LogEvent } from '../../../core/log-parser/LogEvents.js';
import { formatDuration } from '../../../core/utility/Util.js';
import type { TimelineMarker } from '../types/flamechart.types.js';

/**
 * Configuration options for tooltip behavior.
 */
export interface TooltipOptions {
  /** Whether to flip tooltip position if it goes off-screen. Default: true */
  enableFlip: boolean;

  /** Offset from cursor in pixels. Default: 10px */
  cursorOffset: number;

  categoryColors: Record<string, string>;

  apexLog?: ApexLog | null;
}

export class TimelineTooltipManager {
  private container: HTMLElement;
  private tooltipElement: HTMLElement | null = null;
  private options: TooltipOptions;
  private currentEvent: LogEvent | null = null;
  private currentTruncationMarker: TimelineMarker | null = null;

  constructor(
    container: HTMLElement,
    options: TooltipOptions = {
      categoryColors: {},
      cursorOffset: 10,
      enableFlip: true,
    },
  ) {
    this.container = container;

    // Apply default options
    this.options = {
      enableFlip: options.enableFlip,
      cursorOffset: options.cursorOffset,
      categoryColors: options.categoryColors,
      apexLog: options.apexLog,
    };

    this.createTooltipElement();
  }

  /**
   * Create tooltip HTML element and append to container.
   */
  private createTooltipElement(): void {
    this.tooltipElement = document.createElement('div');
    this.tooltipElement.id = 'timeline-tooltip';
    this.container.appendChild(this.tooltipElement);
  }

  /**
   * Show tooltip for an event at the specified mouse position.
   * @param event - Event to display tooltip for
   * @param mouseX - Mouse X position relative to container
   * @param mouseY - Mouse Y position relative to container
   */
  public show(event: LogEvent, mouseX: number, mouseY: number): void {
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

    // New tooltip - apply delay or show immediately if delay is 0
    this.currentEvent = event;

    this.displayTooltip(event, mouseX, mouseY);
  }

  /**
   * Show tooltip for a truncation marker at the specified mouse position.
   * @param marker - Truncation marker to display tooltip for
   * @param mouseX - Mouse X position relative to container
   * @param mouseY - Mouse Y position relative to container
   */
  public showTruncation(marker: TimelineMarker, mouseX: number, mouseY: number): void {
    // If tooltip is already visible, update immediately
    const wasVisible = this.tooltipElement?.style.display === 'block';

    // If different marker and tooltip is visible, update immediately
    if (wasVisible && this.currentTruncationMarker !== marker) {
      this.currentEvent = null; // Clear event state
      this.currentTruncationMarker = marker;
      this.displayTruncationTooltip(marker, mouseX, mouseY);
      return;
    }

    // If same marker and visible, just update position
    if (this.currentTruncationMarker === marker && wasVisible) {
      this.positionTooltip(mouseX, mouseY);
      return;
    }

    // New tooltip - show immediately
    this.currentEvent = null;
    this.currentTruncationMarker = marker;
    this.displayTruncationTooltip(marker, mouseX, mouseY);
  }

  /**
   * Hide tooltip immediately.
   */
  public hide(): void {
    if (this.tooltipElement) {
      this.tooltipElement.style.display = 'none';
    }

    this.currentEvent = null;
    this.currentTruncationMarker = null;
  }

  /**
   * Display tooltip with event information.
   */
  private displayTooltip(event: LogEvent, mouseX: number, mouseY: number): void {
    if (!this.tooltipElement) {
      return;
    }

    // Generate tooltip content
    const content = this.generateTooltipContent(event);
    // Clear existing content and append new content
    while (this.tooltipElement.firstChild) {
      this.tooltipElement.removeChild(this.tooltipElement.firstChild);
    }
    if (content) {
      this.tooltipElement.appendChild(content);
    }

    // Show tooltip
    this.tooltipElement.style.display = 'block';

    // Position tooltip
    this.positionTooltip(mouseX, mouseY);
  }

  /**
   * Display tooltip with truncation marker information.
   */
  private displayTruncationTooltip(marker: TimelineMarker, mouseX: number, mouseY: number): void {
    if (!this.tooltipElement) {
      return;
    }

    // Generate tooltip content
    const content = this.generateTruncationTooltipContent(marker);

    // Clear existing content and append new content
    while (this.tooltipElement.firstChild) {
      this.tooltipElement.removeChild(this.tooltipElement.firstChild);
    }
    if (content) {
      this.tooltipElement.appendChild(content);
    }

    // Show tooltip
    this.tooltipElement.style.display = 'block';

    // Position tooltip
    this.positionTooltip(mouseX, mouseY);
  }

  /**
   * Generate tooltip content for truncation marker.
   */
  private generateTruncationTooltipContent(marker: TimelineMarker): HTMLDivElement | null {
    const rows: { label: string; value: string }[] = [];
    const color = this.getTruncationColor(marker.type);
    return this.createTooltip(marker.summary, marker.metadata, rows, color);
  }

  /**
   * Get human-readable label for truncation type.
   */
  private getTruncationTypeLabel(type: string): string {
    switch (type) {
      case 'error':
        return 'Error';
      case 'skip':
        return 'Skipped Lines';
      case 'unexpected':
        return 'Unexpected Truncation';
      default:
        return type;
    }
  }

  /**
   * Format nanoseconds as milliseconds for display.
   */
  private formatNanoseconds(ns: number): string {
    const ms = ns / 1_000_000;
    return `${ms.toFixed(2)}ms`;
  }

  /**
   * T017: Get CSS color string for truncation type tooltip borders.
   * Converts PixiJS numeric colors (0xRRGGBB) to CSS hex strings (#RRGGBB).
   */
  private getTruncationColor(type: string): string {
    // Map truncation types to CSS colors matching TRUNCATION_COLORS
    switch (type) {
      case 'error':
        return '#ff808033'; // rgba(255, 128, 128, 0.2)
      case 'skip':
        return '#1e80ff33'; // rgba(30, 128, 255, 0.2)
      case 'unexpected':
        return '#8080ff33'; // rgba(128, 128, 255, 0.2)
      default:
        return '#999999'; // Gray fallback
    }
  }

  private generateTooltipContent(event: LogEvent): HTMLDivElement | null {
    if (event?.isParent) {
      const rows = [];
      if (event.type) {
        rows.push({ label: 'type:', value: event.type.toString() });
      }

      if (event.exitStamp) {
        if (event.duration.total) {
          let val = formatDuration(event.duration.total);
          if (event.cpuType === 'free') {
            val += ' (free)';
          } else if (event.duration.self) {
            val += ` (self ${formatDuration(event.duration.self)})`;
          }

          rows.push({ label: 'total:', value: val });
        }

        const govLimits = this.options.apexLog?.governorLimits;
        if (event.dmlCount.total) {
          rows.push({
            label: 'DML:',
            value: this.formatLimit(
              event.dmlCount.total,
              event.dmlCount.self,
              govLimits?.dmlStatements.limit,
            ),
          });
        }

        if (event.dmlRowCount.total) {
          rows.push({
            label: 'DML rows:',
            value: this.formatLimit(
              event.dmlRowCount.total,
              event.dmlRowCount.self,
              govLimits?.dmlRows.limit,
            ),
          });
        }

        if (event.soqlCount.total) {
          rows.push({
            label: 'SOQL:',
            value: this.formatLimit(
              event.soqlCount.total,
              event.soqlCount.self,
              govLimits?.soqlQueries.limit,
            ),
          });
        }

        if (event.soqlRowCount.total) {
          rows.push({
            label: 'SOQL rows:',
            value: this.formatLimit(
              event.soqlRowCount.total,
              event.soqlRowCount.self,
              govLimits?.queryRows.limit,
            ),
          });
        }

        if (event.soslCount.total) {
          rows.push({
            label: 'SOSL:',
            value: this.formatLimit(
              event.soslCount.total,
              event.soslCount.self,
              govLimits?.soslQueries.limit,
            ),
          });
        }

        if (event.soslRowCount.total) {
          rows.push({
            label: 'SOSL rows:',
            value: this.formatLimit(
              event.soslRowCount.total,
              event.soslRowCount.self,
              govLimits?.soslQueries.limit,
            ),
          });
        }
      }

      return this.createTooltip(
        '',
        event.text + (event.suffix ?? ''),
        rows,
        this.options.categoryColors[event.subCategory] || '',
      );
    }

    return null;
  }

  private formatLimit(val: number, self: number, total = 0) {
    const outOf = total > 0 ? `/${total}` : '';
    return `${val}${outOf} (self ${self})`;
  }

  private createTooltip(
    title: string,
    description = '',
    rows: { label: string; value: string }[],
    color: string,
  ) {
    const tooltipBody = document.createElement('div');
    tooltipBody.className = 'timeline-tooltip';

    if (color) {
      tooltipBody.style.borderColor = color;
    }

    if (title) {
      const header = document.createElement('div');
      header.className = 'tooltip-header';
      header.textContent = title;
      tooltipBody.appendChild(header);
    }

    const descriptionDiv = document.createElement('div');
    descriptionDiv.className = 'tooltip-header';
    descriptionDiv.textContent = description;
    tooltipBody.appendChild(descriptionDiv);

    rows.forEach(({ label, value }) => {
      const row = document.createElement('div');
      row.className = 'tooltip-row';

      const labelDiv = document.createElement('div');
      labelDiv.className = 'tooltip-label';
      labelDiv.textContent = label;

      const valueDiv = document.createElement('div');
      valueDiv.className = 'tooltip-value';
      valueDiv.textContent = value;

      row.appendChild(labelDiv);
      row.appendChild(valueDiv);
      tooltipBody.appendChild(row);
    });

    return tooltipBody;
  }

  /**
   * Position tooltip relative to mouse, with boundary detection.
   */
  private positionTooltip(mouseX: number, mouseY: number): void {
    if (!this.tooltipElement) {
      return;
    }

    // Reset width to allow natural sizing based on content
    this.tooltipElement.style.width = 'auto';

    // Force reflow to recalculate dimensions after content change
    // This ensures getBoundingClientRect() returns accurate dimensions
    // void this.tooltipElement.offsetHeight;

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
   * Clean up tooltip element.
   */
  public destroy(): void {
    if (this.tooltipElement && this.tooltipElement.parentNode) {
      this.tooltipElement.parentNode.removeChild(this.tooltipElement);
    }

    this.tooltipElement = null;
    this.currentEvent = null;
    this.currentTruncationMarker = null;
  }
}
