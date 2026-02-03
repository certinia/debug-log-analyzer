/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * SwimlaneTooltipRenderer
 *
 * Renders HTML tooltip for the swimlane visualization.
 * Shows Big 4 metrics (CPU, SOQL, DML, Heap) with color swatches and percentages.
 *
 * Design:
 * - Follows existing HeatStripRenderer tooltip patterns
 * - Shows metric name, percentage, and used/limit values
 * - Color swatches match line colors
 * - Sorted by percentage (highest first) for quick scanning
 */

import type { SwimlaneClassifiedMetric, SwimlaneDataPoint } from '../../types/flamechart.types.js';
import { getSwimlaneColors, SWIMLANE_THRESHOLDS, type SwimlaneColors } from './swimlane-colors.js';

/**
 * Format a number with thousands separators.
 */
function formatNumber(value: number): string {
  return value.toLocaleString();
}

/**
 * Get CSS color for percentage value (traffic light).
 */
function getPercentColor(percent: number): string {
  if (percent >= 1.0) {
    return '#7c3aed'; // Purple - breached
  } else if (percent >= SWIMLANE_THRESHOLDS.dangerStart) {
    return '#dc2626'; // Red - critical (80%+)
  } else if (percent >= 0.5) {
    return '#f59e0b'; // Amber - warning
  }
  return '#10b981'; // Green - safe
}

/**
 * Convert hex number to CSS hex string.
 */
function hexToCSS(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

export class SwimlaneTooltipRenderer {
  /** HTML container for tooltip positioning. */
  private htmlContainer: HTMLElement;

  /** HTML tooltip element. */
  private tooltipElement: HTMLDivElement;

  /** Current color palette. */
  private colors: SwimlaneColors;

  /** Whether dark theme is active. */
  private isDarkTheme = true;

  constructor(htmlContainer: HTMLElement) {
    this.htmlContainer = htmlContainer;
    this.colors = getSwimlaneColors(true);

    // Create tooltip element
    this.tooltipElement = this.createTooltipElement();
    htmlContainer.appendChild(this.tooltipElement);
  }

  /**
   * Set the theme for color selection.
   */
  public setTheme(isDark: boolean): void {
    this.isDarkTheme = isDark;
    this.colors = getSwimlaneColors(isDark);
  }

  /**
   * Show the tooltip with metric data at the specified position.
   *
   * @param screenX - X position in container coordinates
   * @param screenY - Y position in container coordinates
   * @param dataPoint - Data point at this timestamp
   * @param classifiedMetrics - All classified metrics for display info
   */
  public show(
    screenX: number,
    screenY: number,
    dataPoint: SwimlaneDataPoint,
    classifiedMetrics: SwimlaneClassifiedMetric[],
  ): void {
    // Build tooltip content
    const rows = this.buildTooltipRows(dataPoint, classifiedMetrics);

    if (rows.length === 0) {
      this.hide();
      return;
    }

    // Set content
    this.tooltipElement.innerHTML =
      `<div style="font-weight:bold;margin-bottom:6px;color:var(--vscode-foreground, #e3e3e3);">Governor Limits</div>` +
      rows.join('');
    this.tooltipElement.style.display = 'block';

    // Position tooltip
    this.positionTooltip(screenX, screenY);
  }

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

  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================

  /**
   * Create the HTML tooltip element.
   * Styling matches minimap heat strip tooltip for visual consistency.
   */
  private createTooltipElement(): HTMLDivElement {
    const tooltip = document.createElement('div');
    tooltip.className = 'swimlane-tooltip';
    tooltip.style.cssText = `
      position: absolute;
      display: none;
      padding: 8px 12px;
      border-radius: 4px;
      background: var(--vscode-editorWidget-background, #252526);
      border: 1px solid var(--vscode-editorWidget-border, #454545);
      color: var(--vscode-editorWidget-foreground, #e3e3e3);
      font-family: monospace;
      font-size: 11px;
      pointer-events: none;
      z-index: 200;
      white-space: nowrap;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
      min-width: 200px;
    `;
    return tooltip;
  }

  /**
   * Format raw values with unit for tooltip display.
   * Format: "(used / limit unit)" e.g., "(250 / 500 ms)"
   */
  private formatRawValues(used: number, limit: number, unit: string): string {
    const usedStr = formatNumber(Math.round(used));
    const limitStr = formatNumber(Math.round(limit));
    if (unit) {
      return `(${usedStr} / ${limitStr} ${unit})`;
    }
    return `(${usedStr} / ${limitStr})`;
  }

  /**
   * Build tooltip rows for all visible metrics.
   */
  private buildTooltipRows(
    dataPoint: SwimlaneDataPoint,
    classifiedMetrics: SwimlaneClassifiedMetric[],
  ): string[] {
    const rows: string[] = [];

    // Get Tier 1 and Tier 2 metrics (visible on chart)
    const visibleMetrics = classifiedMetrics.filter((m) => m.tier === 1 || m.tier === 2);

    // Sort by current percentage (highest first)
    const sortedMetrics = visibleMetrics
      .map((metric) => ({
        metric,
        percent: dataPoint.values.get(metric.metricId) ?? 0,
        rawValue: dataPoint.rawValues.get(metric.metricId),
      }))
      .sort((a, b) => b.percent - a.percent);

    for (const { metric, percent, rawValue } of sortedMetrics) {
      const percentStr = (percent * 100).toFixed(1).padStart(5);
      const percentColor = getPercentColor(percent);
      const lineColor = hexToCSS(metric.color);
      const rawValueStr = rawValue
        ? this.formatRawValues(rawValue.used, rawValue.limit, metric.unit)
        : '';

      rows.push(
        `<div style="display:grid;grid-template-columns:12px 120px 55px auto;gap:4px;align-items:center;margin:2px 0;">` +
          `<span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${lineColor};"></span>` +
          `<span style="color:var(--vscode-descriptionForeground, #999)">${metric.displayName}</span>` +
          `<span style="text-align:right;font-weight:500;color:${percentColor}">${percentStr}%</span>` +
          `<span style="color:var(--vscode-descriptionForeground, #777);">${rawValueStr}</span>` +
          `</div>`,
      );
    }

    // Add Tier 3 summary if there are tier 3 metrics with data
    const tier3Metrics = classifiedMetrics.filter((m) => m.tier === 3);
    if (tier3Metrics.length > 0 && dataPoint.tier3Max > 0) {
      const tier3PercentStr = (dataPoint.tier3Max * 100).toFixed(1).padStart(5);
      const tier3PercentColor = getPercentColor(dataPoint.tier3Max);
      const tier3LineColor = hexToCSS(this.colors.tier3);

      rows.push(
        `<div style="display:grid;grid-template-columns:12px 120px 55px auto;gap:4px;align-items:center;margin:2px 0;opacity:0.7;">` +
          `<span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${tier3LineColor};"></span>` +
          `<span style="color:var(--vscode-descriptionForeground, #999)">Other (${tier3Metrics.length})</span>` +
          `<span style="text-align:right;font-weight:500;color:${tier3PercentColor}">${tier3PercentStr}%</span>` +
          `<span></span>` +
          `</div>`,
      );
    }

    return rows;
  }

  /**
   * Position the tooltip relative to the cursor.
   * Matches minimap positioning: centered on cursor X, positioned above cursor.
   */
  private positionTooltip(screenX: number, screenY: number): void {
    requestAnimationFrame(() => {
      const tooltipWidth = this.tooltipElement.offsetWidth;
      const tooltipHeight = this.tooltipElement.offsetHeight;
      const containerWidth = this.htmlContainer.offsetWidth;
      const padding = 4;

      // Center on cursor X, clamp to viewport (matches minimap)
      let left = screenX - tooltipWidth / 2;
      left = Math.max(padding, Math.min(containerWidth - tooltipWidth - padding, left));

      // Position above the hover point (matches minimap)
      const top = screenY - tooltipHeight - 8;

      this.tooltipElement.style.left = `${left}px`;
      this.tooltipElement.style.top = `${Math.max(0, top)}px`;
    });
  }
}
