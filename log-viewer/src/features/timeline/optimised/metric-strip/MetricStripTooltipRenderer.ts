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
 * - Sort shown rows by global peak percentage (stable order across the timeline)
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
  formatNumber,
  getPercentColor,
  hexToCSS,
  TOOLTIP_CSS,
} from '../rendering/tooltip-utils.js';
import { getMetricStripColors, type MetricStripColors } from './metric-strip-colors.js';

// web components
import '../../../../components/ColorSwatch.js';

/** One metric row. The swatch track reads the same token the swatch sizes itself by. */
const ROW_STYLE =
  'display:grid;grid-template-columns:var(--lana-swatch-size) 120px 55px auto;' +
  'gap:4px;align-items:center;margin:2px 0;';

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

/** One row's readings, with no DOM attached. */
interface RowData {
  color: string;
  name: string;
  /** 0-1, which decides both the figure and its colour. */
  percent: number;
  value: string;
  /** The corrective count, where the log dropped events Salesforce still counted. */
  ghost: string;
  /** The "Other" summary reads quieter than the metrics it stands for. */
  muted?: boolean;
}

/** The elements one row is written into, held so they are never rebuilt. */
interface RowNodes {
  root: HTMLElement;
  swatch: HTMLElement;
  name: HTMLElement;
  percent: HTMLElement;
  valueText: Text;
  ghost: HTMLElement;
}

export class MetricStripTooltipRenderer extends BaseTooltipRenderer {
  /** Current color palette. */
  private colors: MetricStripColors;

  /** Tooltip title. */
  private title: string;

  /** Strip height for positioning tooltip below. */
  private stripHeight: number = 60;

  /** The reading the panel holds, so sweeping one segment is not a rebuild. */
  private shownPoint: MetricStripDataPoint | null = null;

  /** Row elements, reused across readings and only ever grown. */
  private readonly rowPool: RowNodes[] = [];

  /** Set once the panel's title exists. */
  private titleNode: HTMLElement | null = null;

  /** Set once the no-data note exists; hidden while the cursor is over recorded time. */
  private noDataNode: HTMLElement | null = null;

  /** The note asked for. */
  private noDataLabel: string | null = null;

  /** The note on the panel, so an unchanged one is never touched again. */
  private noDataShown: string | null = null;

  constructor(htmlContainer: HTMLElement, options: MetricStripTooltipOptions = {}) {
    super(htmlContainer, { mode: 'below-anchor', offset: 8, padding: 4 });

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
   * Note that the log recorded nothing here, so the rows are the last reading it has.
   *
   * Applied by the next `show`, which is what appends the panel's title.
   *
   * @param label - Short note to show, or null while the reading is the one at the cursor
   */
  public setNoDataLabel(label: string | null): void {
    this.noDataLabel = label;
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

    // The classifier allocates its points once per `processData` and hands back the same
    // object for every pointer position inside one time segment, so identity tells a
    // re-position from a new reading. A rebuild re-parses the panel and upgrades a swatch
    // element per row, on a mousemove that is not throttled. `hide` leaves the markup in
    // place, so the cache stays good across one.
    if (dataPoint !== this.shownPoint) {
      const rows = this.selectRows(dataPoint, classifiedMetrics);

      if (rows.length === 0) {
        this.hide();
        return;
      }

      this.renderRows(rows);
      this.shownPoint = dataPoint;
    }

    // After the rebuild, which appends the title: the note is the panel's last line. One
    // reading covers a whole unrecorded span, so the note changes while the rows do not.
    this.renderNoDataNote();

    this.showElement();

    // The strip is the anchor: `below-anchor` keeps the panel clear of it, and batches the
    // measurement into one frame rather than forcing a layout per pointer move.
    this.positionTooltip(screenX, this.stripHeight);
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

  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================

  /**
   * Choose which metrics the panel shows, and in what order.
   *
   * Rules:
   * 1. Always show important metrics (cpuTime, heapSize, dmlStatements, dmlRows, soqlQueries,
   *    queryRows) — these show even at 0%
   * 2. Show any metric >= 80%
   * 3. Show the top 3 by percentage, if not already shown and above 0%
   * 4. Combine the rest into an "Other (N)" summary
   * 5. Order by each metric's global peak percentage, which is stable across the timeline, so
   *    a row keeps its slot rather than reshuffling as the cursor moves
   */
  private selectRows(
    dataPoint: MetricStripDataPoint,
    classifiedMetrics: MetricStripClassifiedMetric[],
  ): RowData[] {
    const allMetrics = classifiedMetrics
      .map((metric) => ({
        metric,
        percent: dataPoint.values.get(metric.metricId) ?? 0,
        rawValue: dataPoint.rawValues.get(metric.metricId),
        isImportant: ALWAYS_SHOW_METRICS.has(metric.metricId),
      }))
      .sort((a, b) => b.percent - a.percent);

    const shownMetricIds = new Set<string>();
    const visibleMetrics: typeof allMetrics = [];
    const hiddenMetrics: typeof allMetrics = [];

    // Pass 1: the important metrics, shown even at 0%.
    for (const item of allMetrics) {
      if (item.isImportant) {
        visibleMetrics.push(item);
        shownMetricIds.add(item.metric.metricId);
      }
    }

    // Pass 2: anything at the danger threshold.
    for (const item of allMetrics) {
      if (!shownMetricIds.has(item.metric.metricId) && item.percent >= DANGER_THRESHOLD) {
        visibleMetrics.push(item);
        shownMetricIds.add(item.metric.metricId);
      }
    }

    // Pass 3: the top 3 by percentage, zeros excluded.
    let addedFromTop3 = 0;
    for (const item of allMetrics) {
      if (addedFromTop3 >= 3) {
        break;
      }
      if (!shownMetricIds.has(item.metric.metricId) && item.percent > 0) {
        visibleMetrics.push(item);
        shownMetricIds.add(item.metric.metricId);
        addedFromTop3++;
      }
    }

    for (const item of allMetrics) {
      if (!shownMetricIds.has(item.metric.metricId)) {
        hiddenMetrics.push(item);
      }
    }

    // The peak, not the value at the cursor: a row keeps its slot as the cursor moves, so the
    // panel can be scanned and compared rather than re-read.
    visibleMetrics.sort((a, b) => b.metric.globalMaxPercent - a.metric.globalMaxPercent);

    const rows: RowData[] = visibleMetrics.map(({ metric, percent, rawValue }) => {
      // Always state the limit, even at 0% or before the metric's first observation, so the
      // headroom is visible. The limit is fixed across the series, so the classified metric
      // answers where this timestamp has no data point.
      const limit = rawValue?.limit ?? metric.limit;
      return {
        color: hexToCSS(metric.color),
        name: metric.displayName,
        percent,
        value:
          limit > 0 ? formatMetricValueWithParens(rawValue?.used ?? 0, limit, metric.unit) : '',
        // Only where the count tracked from detailed events falls below the corrective
        // cumulative total — the log dropped events Salesforce still counted.
        ghost:
          rawValue && rawValue.tracked !== undefined && rawValue.tracked < rawValue.used
            ? ` (${formatNumber(Math.round(rawValue.tracked))} seen)`
            : '',
      };
    });

    if (hiddenMetrics.length > 0) {
      const maxHiddenPercent = Math.max(...hiddenMetrics.map((item) => item.percent));
      rows.push({
        color: hexToCSS(this.colors.tier3),
        name: `Other (${hiddenMetrics.length})`,
        percent: maxHiddenPercent,
        value: '',
        ghost: '',
        muted: true,
      });
    }

    return rows;
  }

  /**
   * Writes the readings into the row elements, growing the pool as needed and hiding the
   * spares. Reused rather than reparsed: a rebuild would upgrade a swatch custom element per
   * row, and the panel changes on every segment the pointer crosses.
   */
  private renderRows(rows: RowData[]): void {
    if (!this.titleNode) {
      const title = document.createElement('div');
      title.style.cssText = `font-weight:bold;margin-bottom:6px;color:${TOOLTIP_CSS.foreground};`;
      title.textContent = this.title;
      this.tooltipElement.appendChild(title);
      this.titleNode = title;
    }

    rows.forEach((data, index) => {
      const pooled = this.rowPool[index];
      const row = pooled ?? this.createRow();
      if (!pooled) {
        this.rowPool.push(row);
        // Before the note, which is the panel's last line; `null` appends.
        this.tooltipElement.insertBefore(row.root, this.noDataNode);
      }

      row.swatch.setAttribute('color', data.color);
      row.name.textContent = data.name;
      row.percent.textContent = `${(data.percent * 100).toFixed(1).padStart(5)}%`;
      row.percent.style.color = getPercentColor(data.percent);
      row.valueText.data = data.value;
      row.ghost.textContent = data.ghost;
      row.root.style.opacity = data.muted ? '0.7' : '';
      row.root.style.display = 'grid';
    });

    for (const spare of this.rowPool.slice(rows.length)) {
      spare.root.style.display = 'none';
    }
  }

  /** Writes the no-data note. Reads nothing back from the DOM: this runs per pointer move. */
  private renderNoDataNote(): void {
    const label = this.noDataLabel;
    if (label === this.noDataShown) {
      return;
    }
    this.noDataShown = label;

    if (!label) {
      if (this.noDataNode) {
        this.noDataNode.style.display = 'none';
        // Cleared too: a hidden node still reads out of the panel's text.
        this.noDataNode.textContent = '';
      }
      return;
    }

    let node = this.noDataNode;
    if (!node) {
      node = document.createElement('div');
      node.style.cssText = `margin-top:6px;font-style:italic;color:${TOOLTIP_CSS.descriptionForegroundMuted};`;
      this.tooltipElement.appendChild(node);
      this.noDataNode = node;
    }
    node.textContent = label;
    node.style.display = 'block';
  }

  /** One row's elements, in the order the grid lays them out. */
  private createRow(): RowNodes {
    const root = document.createElement('div');
    root.style.cssText = ROW_STYLE;

    const swatch = document.createElement('color-swatch');
    const name = document.createElement('span');
    name.style.color = TOOLTIP_CSS.descriptionForeground;

    const percent = document.createElement('span');
    percent.style.cssText = 'text-align:right;font-weight:500;';

    const value = document.createElement('span');
    value.style.color = TOOLTIP_CSS.descriptionForegroundMuted;
    const valueText = document.createTextNode('');
    const ghost = document.createElement('span');
    ghost.style.cssText = 'font-style:italic;opacity:0.65;';
    value.append(valueText, ghost);

    root.append(swatch, name, percent, value);
    return { root, swatch, name, percent, valueText, ghost };
  }
}
