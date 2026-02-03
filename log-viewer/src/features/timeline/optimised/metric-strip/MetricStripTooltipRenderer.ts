/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * MetricStripTooltipRenderer
 *
 * Renders HTML tooltip for the metric strip visualization.
 * Shows Big 4 metrics (CPU, SOQL, DML, Heap) with color swatches and percentages.
 *
 * Design:
 * - Follows existing HeatStripRenderer tooltip patterns
 * - Shows metric name, percentage, and used/limit values
 * - Color swatches match line colors
 * - Sorted by percentage (highest first) for quick scanning
 */

import type {
  MetricStripClassifiedMetric,
  MetricStripDataPoint,
} from '../../types/flamechart.types.js';
import { BaseTooltipRenderer } from '../rendering/BaseTooltipRenderer.js';
import {
  formatMetricValueWithParens,
  getPercentColor,
  hexToCSS,
  TOOLTIP_CSS,
} from '../rendering/tooltip-utils.js';
import { getMetricStripColors, type MetricStripColors } from './metric-strip-colors.js';

/**
 * Options for metric strip tooltip display.
 */
export interface MetricStripTooltipOptions {
  /** Title shown at top of tooltip. Default: "Governor Limits" */
  title?: string;
}

export class MetricStripTooltipRenderer extends BaseTooltipRenderer {
  /** Current color palette. */
  private colors: MetricStripColors;

  /** Tooltip title. */
  private title: string;

  constructor(htmlContainer: HTMLElement, options: MetricStripTooltipOptions = {}) {
    super(htmlContainer, { mode: 'centered-above', offset: 8, padding: 4 });

    this.colors = getMetricStripColors(true);
    this.title = options.title ?? 'Governor Limits';
  }

  /**
   * Set the theme for color selection.
   */
  public setTheme(isDark: boolean): void {
    this.isDarkTheme = isDark;
    this.colors = getMetricStripColors(isDark);
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
    dataPoint: MetricStripDataPoint,
    classifiedMetrics: MetricStripClassifiedMetric[],
  ): void {
    // Build tooltip content
    const rows = this.buildTooltipRows(dataPoint, classifiedMetrics);

    if (rows.length === 0) {
      this.hide();
      return;
    }

    // Set content
    const titleHtml = `<div style="font-weight:bold;margin-bottom:6px;color:${TOOLTIP_CSS.foreground};">${this.title}</div>`;
    this.setContent(titleHtml + rows.join(''));
    this.showElement();

    // Position tooltip
    this.positionTooltip(screenX, screenY);
  }

  // ============================================================================
  // PROTECTED METHODS
  // ============================================================================

  /**
   * Create the HTML tooltip element with metric-strip-specific styling.
   */
  protected createTooltipElement(): HTMLDivElement {
    const tooltip = super.createTooltipElement();
    tooltip.className = 'metric-strip-tooltip';
    tooltip.style.minWidth = '200px';
    return tooltip;
  }

  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================

  /**
   * Build tooltip rows for all visible metrics.
   */
  private buildTooltipRows(
    dataPoint: MetricStripDataPoint,
    classifiedMetrics: MetricStripClassifiedMetric[],
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
        ? formatMetricValueWithParens(rawValue.used, rawValue.limit, metric.unit)
        : '';

      rows.push(
        `<div style="display:grid;grid-template-columns:12px 120px 55px auto;gap:4px;align-items:center;margin:2px 0;">` +
          `<span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${lineColor};"></span>` +
          `<span style="color:${TOOLTIP_CSS.descriptionForeground}">${metric.displayName}</span>` +
          `<span style="text-align:right;font-weight:500;color:${percentColor}">${percentStr}%</span>` +
          `<span style="color:${TOOLTIP_CSS.descriptionForegroundMuted};">${rawValueStr}</span>` +
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
          `<span style="color:${TOOLTIP_CSS.descriptionForeground}">Other (${tier3Metrics.length})</span>` +
          `<span style="text-align:right;font-weight:500;color:${tier3PercentColor}">${tier3PercentStr}%</span>` +
          `<span></span>` +
          `</div>`,
      );
    }

    return rows;
  }
}
