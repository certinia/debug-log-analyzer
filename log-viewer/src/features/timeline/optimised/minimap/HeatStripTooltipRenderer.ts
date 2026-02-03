/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * HeatStripTooltipRenderer
 *
 * Renders HTML tooltip for the minimap heat strip visualization.
 * Shows metric percentages and values when hovering over the heat strip.
 *
 * Design:
 * - High-priority metrics (priority < 4) always shown
 * - Other metrics only shown if > 0%
 * - Sorted by priority, then by percentage descending
 * - Traffic light color coding for percentages
 */

import type {
  HeatStripMetricSnapshot,
  HeatStripTimeSeriesMetric,
} from '../../types/flamechart.types.js';
import { BaseTooltipRenderer } from '../rendering/BaseTooltipRenderer.js';
import { formatMetricValue, getPercentColor, TOOLTIP_CSS } from '../rendering/tooltip-utils.js';

/** Priority threshold for always-shown metrics. */
const HIGH_PRIORITY_THRESHOLD = 4;

/**
 * Options for heat strip tooltip display.
 */
export interface HeatStripTooltipOptions {
  /** Title shown at top of tooltip. Default: "Metrics" */
  title?: string;
}

export class HeatStripTooltipRenderer extends BaseTooltipRenderer {
  /** Tooltip title. */
  private title: string;

  constructor(htmlContainer: HTMLElement, options: HeatStripTooltipOptions = {}) {
    super(htmlContainer, { mode: 'centered-above', offset: 8, padding: 4 });

    this.title = options.title ?? 'Metrics';
  }

  /**
   * Set the theme for color selection.
   * Heat strip tooltip doesn't have theme-specific colors beyond base styling.
   */
  public setTheme(isDark: boolean): void {
    this.isDarkTheme = isDark;
  }

  /**
   * Show the tooltip with metric data at the specified position.
   *
   * @param screenX - X position in container coordinates
   * @param screenY - Y position in container coordinates
   * @param metricSnapshots - Map of metric ID to snapshot data
   * @param metrics - Map of metric ID to metric definition
   */
  public show(
    screenX: number,
    screenY: number,
    metricSnapshots: Map<string, HeatStripMetricSnapshot>,
    metrics: Map<string, HeatStripTimeSeriesMetric>,
  ): void {
    // Build tooltip content
    const rows: string[] = [];

    // Sort metrics by priority (lower = shown first), then by percentage descending
    const sortedMetrics = Array.from(metricSnapshots.entries()).sort((a, b) => {
      const metricA = metrics.get(a[0]);
      const metricB = metrics.get(b[0]);
      const priorityA = metricA?.priority ?? 999;
      const priorityB = metricB?.priority ?? 999;
      if (priorityA !== priorityB) {
        return priorityA - priorityB;
      }
      return b[1].percent - a[1].percent;
    });

    // High-priority metrics always shown, others only if > 0%
    for (const [metricId, snapshot] of sortedMetrics) {
      const metric = metrics.get(metricId);
      const isHighPriority = (metric?.priority ?? 999) < HIGH_PRIORITY_THRESHOLD;
      const isNonZero = snapshot.percent > 0;

      // Show high-priority metrics always, others only if > 0%
      if (isHighPriority || isNonZero) {
        const name = metric?.displayName ?? metricId;
        const percentStr = (snapshot.percent * 100).toFixed(1).padStart(5);
        const color = getPercentColor(snapshot.percent);
        const unit = metric?.unit ?? '';
        const valueStr = formatMetricValue(snapshot.used, snapshot.limit, unit);
        rows.push(
          `<div style="display:grid;grid-template-columns:140px 55px auto;gap:4px;margin:2px 0;">` +
            `<span style="color:${TOOLTIP_CSS.descriptionForeground}">${name}</span>` +
            `<span style="text-align:right;color:${color}">${percentStr}%</span>` +
            `<span style="color:${TOOLTIP_CSS.descriptionForegroundMuted}">(${valueStr})</span>` +
            `</div>`,
        );
      }
    }

    if (rows.length === 0) {
      this.hide();
      return;
    }

    // Set content
    const titleHtml = `<div style="font-weight:bold;margin-bottom:4px;">${this.title}</div>`;
    this.setContent(titleHtml + rows.join(''));
    this.showElement();

    // Position tooltip
    this.positionTooltip(screenX, screenY);
  }

  // ============================================================================
  // PROTECTED METHODS
  // ============================================================================

  /**
   * Create the HTML tooltip element with heat-strip-specific styling.
   */
  protected createTooltipElement(): HTMLDivElement {
    const tooltip = super.createTooltipElement();
    tooltip.className = 'heat-strip-tooltip';
    return tooltip;
  }
}
