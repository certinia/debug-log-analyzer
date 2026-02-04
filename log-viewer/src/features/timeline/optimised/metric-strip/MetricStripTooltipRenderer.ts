/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * MetricStripTooltipRenderer
 *
 * Renders HTML tooltip for the metric strip visualization.
 * Uses unified filtering rules for both collapsed and expanded views.
 *
 * Unified Tooltip Rules:
 * - Always show: cpuTime, heapSize, dmlStatements, dmlRows, soqlQueries, queryRows
 * - Show top 3 by percentage (if not already in always-show list)
 * - Show any metric ≥80%
 * - Combine remaining into "Other: X metrics" summary
 * - Sort by percentage descending
 *
 * Design:
 * - Follows existing HeatStripRenderer tooltip patterns
 * - Shows metric name, percentage, and used/limit values
 * - Color swatches match line colors
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
 * Metrics that should always be shown in the tooltip regardless of their value.
 * These are the "important" metrics users care about most.
 */
const ALWAYS_SHOW_METRICS = new Set([
  'cpuTime',
  'heapSize',
  'dmlStatements',
  'dmlRows',
  'soqlQueries',
  'queryRows',
]);

/**
 * Threshold for auto-promoting metrics to visible (80%).
 */
const DANGER_THRESHOLD = 0.8;

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

  /** Strip height for positioning tooltip below. */
  private stripHeight: number = 60;

  constructor(htmlContainer: HTMLElement, options: MetricStripTooltipOptions = {}) {
    super(htmlContainer, { mode: 'cursor-offset', offset: 8, padding: 4 });

    this.colors = getMetricStripColors();
    this.title = options.title ?? 'Governor Limits';
  }

  /**
   * No-op: theme is not used (universal colors).
   */
  public setTheme(_isDark: boolean): void {
    // No-op: metric strip uses universal colors
  }

  /**
   * Show the tooltip with metric data at the specified position.
   *
   * @param screenX - X position in container coordinates
   * @param screenY - Y position in container coordinates (ignored, uses stripHeight)
   * @param dataPoint - Data point at this timestamp
   * @param classifiedMetrics - All classified metrics for display info
   * @param stripHeight - Height of the metric strip (tooltip positions below this)
   */
  public show(
    screenX: number,
    _screenY: number,
    dataPoint: MetricStripDataPoint,
    classifiedMetrics: MetricStripClassifiedMetric[],
    stripHeight?: number,
  ): void {
    // Store strip height for positioning
    if (stripHeight !== undefined) {
      this.stripHeight = stripHeight;
    }

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

    // Position tooltip (Y is ignored, we always position below the strip)
    this.positionTooltip(screenX, 0);
  }

  // ============================================================================
  // PROTECTED METHODS
  // ============================================================================

  /**
   * Create the HTML tooltip element with metric-strip-specific styling.
   */
  protected override createTooltipElement(): HTMLDivElement {
    const tooltip = super.createTooltipElement();
    tooltip.className = 'metric-strip-tooltip';
    tooltip.style.minWidth = '200px';
    return tooltip;
  }

  /**
   * Position tooltip below the metric strip.
   * Overrides base positioning to always place tooltip below the strip,
   * preventing it from covering the visualization or the mouse cursor.
   */
  protected override positionTooltip(screenX: number, _screenY: number): void {
    const offset = this.positionOptions.offset ?? 8;
    const padding = this.positionOptions.padding ?? 4;

    requestAnimationFrame(() => {
      const tooltipWidth = this.tooltipElement.offsetWidth;
      const containerWidth = this.container.offsetWidth;

      // X: position at cursor with flip if needed
      let left = screenX + offset;
      if (left + tooltipWidth > containerWidth) {
        left = screenX - tooltipWidth - offset;
      }
      left = Math.max(padding, Math.min(containerWidth - tooltipWidth - padding, left));

      // Y: always position below the strip
      const top = this.stripHeight + offset;

      this.tooltipElement.style.left = `${left}px`;
      this.tooltipElement.style.top = `${top}px`;
    });
  }

  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================

  /**
   * Build tooltip rows using unified filtering rules.
   *
   * Rules:
   * 1. Always show important metrics (cpuTime, heapSize, dmlStatements, dmlRows, soqlQueries, queryRows)
   *    - But only show zeros for these important metrics
   * 2. Show top 3 by percentage (if not already in always-show list) - only if percent > 0
   * 3. Show any metric ≥80%
   * 4. Combine remaining metrics with value > 0 into "Other: X metrics" summary
   * 5. Sort by percentage descending
   */
  private buildTooltipRows(
    dataPoint: MetricStripDataPoint,
    classifiedMetrics: MetricStripClassifiedMetric[],
  ): string[] {
    const rows: string[] = [];

    // Build list of all metrics with their current values
    const allMetrics = classifiedMetrics
      .map((metric) => ({
        metric,
        percent: dataPoint.values.get(metric.metricId) ?? 0,
        rawValue: dataPoint.rawValues.get(metric.metricId),
        isImportant: ALWAYS_SHOW_METRICS.has(metric.metricId),
      }))
      .sort((a, b) => b.percent - a.percent);

    // Determine which metrics to show based on unified rules
    const shownMetricIds = new Set<string>();
    const visibleMetrics: typeof allMetrics = [];
    const hiddenMetrics: typeof allMetrics = [];

    // Pass 1: Add always-show metrics (important metrics shown even at 0%)
    for (const item of allMetrics) {
      if (item.isImportant) {
        visibleMetrics.push(item);
        shownMetricIds.add(item.metric.metricId);
      }
    }

    // Pass 2: Add metrics ≥80% (danger threshold)
    for (const item of allMetrics) {
      if (!shownMetricIds.has(item.metric.metricId) && item.percent >= DANGER_THRESHOLD) {
        visibleMetrics.push(item);
        shownMetricIds.add(item.metric.metricId);
      }
    }

    // Pass 3: Add top 3 by percentage (if not already shown) - only if percent > 0
    let addedFromTop3 = 0;
    for (const item of allMetrics) {
      if (addedFromTop3 >= 3) {
        break;
      }
      // Only add non-zero metrics to top 3
      if (!shownMetricIds.has(item.metric.metricId) && item.percent > 0) {
        visibleMetrics.push(item);
        shownMetricIds.add(item.metric.metricId);
        addedFromTop3++;
      }
    }

    // Collect ALL remaining metrics for "Other" summary (including zeros)
    for (const item of allMetrics) {
      if (!shownMetricIds.has(item.metric.metricId)) {
        hiddenMetrics.push(item);
      }
    }

    // Sort visible metrics by percentage (highest first)
    visibleMetrics.sort((a, b) => b.percent - a.percent);

    // Render visible metric rows
    for (const { metric, percent, rawValue } of visibleMetrics) {
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

    // Add "Other" summary if there are hidden metrics with data
    if (hiddenMetrics.length > 0) {
      const maxHiddenPercent = Math.max(...hiddenMetrics.map((m) => m.percent));
      const otherPercentStr = (maxHiddenPercent * 100).toFixed(1).padStart(5);
      const otherPercentColor = getPercentColor(maxHiddenPercent);
      const otherLineColor = hexToCSS(this.colors.tier3);

      rows.push(
        `<div style="display:grid;grid-template-columns:12px 120px 55px auto;gap:4px;align-items:center;margin:2px 0;opacity:0.7;">` +
          `<span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${otherLineColor};"></span>` +
          `<span style="color:${TOOLTIP_CSS.descriptionForeground}">Other (${hiddenMetrics.length})</span>` +
          `<span style="text-align:right;font-weight:500;color:${otherPercentColor}">${otherPercentStr}%</span>` +
          `<span></span>` +
          `</div>`,
      );
    }

    return rows;
  }
}
