/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * MetricStripRenderer
 *
 * PIXI.js renderer for the governor limit metric strip step chart.
 * Renders metric lines, danger zone, limit line, area fills, and breach areas.
 *
 * Visual Design:
 * - Y-axis: 0% at bottom, 110% at top (100% line at ~91% height)
 * - Step chart: Horizontal then vertical segments between points
 * - Danger zone: Semi-transparent band from 80% to 100%
 * - Limit line: Dashed red line at 100%
 * - Breach areas: Purple fill above 100%
 * - Area fills: 20% opacity fills under each line
 *
 * Render Order (back to front):
 * 1. Marker backgrounds (error/skip/unexpected regions)
 * 2. Vertical time grid lines
 * 3. Danger zone band (80-100%)
 * 4. Area fills under lines
 * 5. Step chart lines (Tier 1/2 solid, Tier 3 dashed)
 * 6. 100% limit line (dashed)
 * 7. Breach areas (above 100%)
 * 8. Cursor line
 */

import { Graphics } from 'pixi.js';
import type {
  MetricStripDataPoint,
  MetricStripProcessedData,
  TimelineMarker,
  ViewportState,
} from '../../types/flamechart.types.js';
import {
  BREACH_AREA_OPACITY,
  DANGER_ZONE_OPACITY,
  getMetricStripColors,
  getTrafficLightColor,
  METRIC_STRIP_HEIGHT,
  METRIC_STRIP_LINE_WIDTHS,
  METRIC_STRIP_MARKER_COLORS_BLENDED,
  METRIC_STRIP_MARKER_OPACITY,
  METRIC_STRIP_THRESHOLDS,
  METRIC_STRIP_TOGGLE_WIDTH,
  METRIC_STRIP_Y_MAX_PERCENT,
  type MetricStripColors,
} from './metric-strip-colors.js';

// Re-export toggle width for use by orchestrator
export { METRIC_STRIP_TOGGLE_WIDTH };

// ============================================================================
// CONSTANTS
// ============================================================================

/** Toggle icon left padding in pixels */
const TOGGLE_ICON_PADDING_X = 6;
/** Toggle icon top padding in pixels */
const TOGGLE_ICON_PADDING_Y = 2.5;
/** Toggle icon size in pixels */
const TOGGLE_ICON_SIZE = 5;

/** Limit line dash length in pixels */
const LIMIT_LINE_DASH = 8;
/** Limit line gap length in pixels */
const LIMIT_LINE_GAP = 4;

/** Heat strip bucket width in pixels for collapsed view */
const HEAT_STRIP_BUCKET_WIDTH_PX = 2;

// ============================================================================
// TYPES
// ============================================================================

/** Function to extract a percentage value from a data point */
type ValueExtractor = (point: MetricStripDataPoint) => number;

/** Result from getDataPointAtTime including segment end time for caching */
interface DataPointResult {
  point: MetricStripDataPoint;
  endTime: number;
}

export class MetricStripRenderer {
  /** Graphics for marker backgrounds. */
  private markerGraphics: Graphics;

  /** Graphics for danger zone band. */
  private dangerZoneGraphics: Graphics;

  /** Graphics for area fills under lines. */
  private areaFillGraphics: Graphics;

  /** Graphics for step chart lines. */
  private lineGraphics: Graphics;

  /** Graphics for limit line. */
  private limitLineGraphics: Graphics;

  /** Graphics for breach areas. */
  private breachGraphics: Graphics;

  /** Graphics for expand/collapse toggle button. */
  private toggleGraphics: Graphics;

  /** All graphics containers. Ordered back to front. */
  private graphics: Graphics[];

  /** Current color palette. */
  private colors: MetricStripColors;

  /** Cached height. */
  private height = METRIC_STRIP_HEIGHT;

  /** Effective Y-max for dynamic scaling. */
  private effectiveYMax = METRIC_STRIP_Y_MAX_PERCENT;

  /** Whether the metric strip is in collapsed mode. */
  private isCollapsed = false;

  /** Whether mouse is hovering over the toggle area. */
  private isToggleHovered = false;

  constructor() {
    this.markerGraphics = new Graphics();
    this.dangerZoneGraphics = new Graphics();
    this.areaFillGraphics = new Graphics();
    this.lineGraphics = new Graphics();
    this.limitLineGraphics = new Graphics();
    this.breachGraphics = new Graphics();
    this.toggleGraphics = new Graphics();

    this.graphics = [
      this.markerGraphics,
      this.dangerZoneGraphics,
      this.areaFillGraphics,
      this.lineGraphics,
      this.limitLineGraphics,
      this.breachGraphics,
      this.toggleGraphics, // Toggle rendered on top
    ];

    this.colors = getMetricStripColors();
  }

  /**
   * Get all graphics objects for adding to a container.
   * Returns in correct render order (back to front).
   */
  public getGraphics(): Graphics[] {
    return this.graphics;
  }

  /**
   * Set the metric strip height.
   */
  public setHeight(height: number): void {
    this.height = height;
  }

  /**
   * Set the effective Y-max for dynamic scaling.
   */
  public setEffectiveYMax(yMax: number): void {
    this.effectiveYMax = yMax;
  }

  /**
   * Set the collapsed state.
   */
  public setCollapsed(collapsed: boolean): void {
    this.isCollapsed = collapsed;
  }

  /**
   * Set the toggle hover state.
   *
   * @param hovered - Whether mouse is over the toggle area
   */
  public setToggleHovered(hovered: boolean): void {
    this.isToggleHovered = hovered;
  }

  /**
   * Check if the toggle is currently hovered.
   */
  public getIsToggleHovered(): boolean {
    return this.isToggleHovered;
  }

  /**
   * Render the metric strip visualization.
   *
   * @param data - Processed metric strip data
   * @param viewportState - Current viewport state for coordinate transforms
   * @param totalDuration - Total timeline duration in nanoseconds
   * @param markers - Timeline markers for background rendering
   */
  public render(
    data: MetricStripProcessedData,
    viewportState: ViewportState,
    totalDuration: number,
    markers?: TimelineMarker[],
  ): void {
    // Clear all graphics
    this.clear();

    const { displayWidth } = viewportState;
    const height = this.height;

    // Always render markers (background layer) - visible in both collapsed and expanded modes
    if (markers && markers.length > 0) {
      this.renderMarkers(markers, viewportState, totalDuration);
    }

    // Note: Time grid lines are now rendered by MeshAxisRenderer in MetricStripOrchestrator

    // Toggle button is rendered in both collapsed and expanded modes
    this.renderToggleButton();

    // In collapsed mode, heat strips are rendered separately via renderCollapsedWithData()
    if (this.isCollapsed || !data.hasData) {
      return;
    }

    // Render expanded view layers (back to front)
    this.renderDangerZone(displayWidth, height);
    this.renderAreaFills(data, viewportState, totalDuration, height);
    this.renderStepChartLines(data, viewportState, totalDuration, height);
    this.renderLimitLine(displayWidth, height);
    this.renderBreachAreas(data, viewportState, totalDuration, height);
  }

  /**
   * Render the expand/collapse toggle button on the left edge.
   * Shows a chevron icon: ▶ when collapsed, ▼ when expanded.
   * No background - just the chevron icon at top left.
   */
  private renderToggleButton(): void {
    const g = this.toggleGraphics;
    const iconColor = this.isToggleHovered ? 0xffffff : 0xcccccc;

    if (this.isCollapsed) {
      // ▶ (right-pointing triangle)
      g.moveTo(TOGGLE_ICON_PADDING_X, TOGGLE_ICON_PADDING_Y);
      g.lineTo(TOGGLE_ICON_PADDING_X + TOGGLE_ICON_SIZE, TOGGLE_ICON_PADDING_Y + TOGGLE_ICON_SIZE);
      g.lineTo(TOGGLE_ICON_PADDING_X, TOGGLE_ICON_PADDING_Y + TOGGLE_ICON_SIZE * 2);
      g.closePath();
    } else {
      // ▼ (down-pointing triangle)
      g.moveTo(TOGGLE_ICON_PADDING_X, TOGGLE_ICON_PADDING_Y);
      g.lineTo(TOGGLE_ICON_PADDING_X + TOGGLE_ICON_SIZE * 2, TOGGLE_ICON_PADDING_Y);
      g.lineTo(TOGGLE_ICON_PADDING_X + TOGGLE_ICON_SIZE, TOGGLE_ICON_PADDING_Y + TOGGLE_ICON_SIZE);
      g.closePath();
    }
    g.fill({ color: iconColor, alpha: 1.0 });
  }

  /**
   * Render the collapsed view with actual metric data.
   * Shows stacked colored strips representing metric percentages.
   */
  public renderCollapsedWithData(
    viewportState: ViewportState,
    getDataPointAtTime: (timeNs: number) => DataPointResult | null,
    totalDuration: number,
  ): void {
    if (this.isCollapsed) {
      this.renderCollapsedHeatStrips(viewportState, getDataPointAtTime, totalDuration);
    }
  }

  /**
   * Render heat-style colored strips in collapsed mode.
   * Uses traffic light system: color based on MAX percentage across ALL metrics.
   * - 0-50%: transparent/clear (safe)
   * - 50-80%: amber/orange (warning)
   * - 80-100%: red (critical)
   * - >100%: purple (breach)
   */
  private renderCollapsedHeatStrips(
    viewportState: ViewportState,
    getDataPointAtTime: (timeNs: number) => DataPointResult | null,
    totalDuration: number,
  ): void {
    const { zoom, offsetX, displayWidth } = viewportState;
    const height = this.height;
    const g = this.areaFillGraphics;

    // Calculate time range and bucket size
    const visibleStartTime = offsetX / zoom;
    const visibleEndTime = (offsetX + displayWidth) / zoom;

    const numBuckets = Math.ceil(displayWidth / HEAT_STRIP_BUCKET_WIDTH_PX);
    const bucketWidth = displayWidth / numBuckets;
    const timeBucketSize = (visibleEndTime - visibleStartTime) / numBuckets;

    // Track current color run for merging adjacent buckets with same color
    let runStartX = 0;
    let runColor = 0;
    let runAlpha = 0;
    let inRun = false;

    // Cache point lookup to avoid redundant binary searches for adjacent buckets
    let cachedResult: DataPointResult | null = null;

    // Process each bucket and merge adjacent ones with same color
    for (let i = 0; i < numBuckets; i++) {
      const bucketStartTime = visibleStartTime + i * timeBucketSize;
      const bucketMidTime = bucketStartTime + timeBucketSize / 2;
      const bucketX = i * bucketWidth;

      // Clamp to valid time range
      const timeNs = Math.max(0, Math.min(totalDuration, bucketMidTime));

      // Reuse cached result if time falls within same segment
      if (!cachedResult || timeNs >= cachedResult.endTime) {
        cachedResult = getDataPointAtTime(timeNs);
      }

      // Get color for this bucket
      let color = 0;
      let alpha = 0;

      if (cachedResult) {
        const maxPercent = this.getMaxPercentAtPoint(cachedResult.point);
        const colorInfo = getTrafficLightColor(maxPercent);
        color = colorInfo.color;
        alpha = colorInfo.alpha;
      }

      // Check if color changed from current run
      if (color !== runColor || alpha !== runAlpha) {
        // Draw previous run if it had visible color
        if (inRun && runAlpha > 0) {
          g.rect(runStartX, 0, bucketX - runStartX, height);
          g.fill({ color: runColor, alpha: runAlpha });
        }
        // Start new run
        runStartX = bucketX;
        runColor = color;
        runAlpha = alpha;
        inRun = alpha > 0;
      }
    }

    // Draw final run if it has visible color
    if (inRun && runAlpha > 0) {
      g.rect(runStartX, 0, displayWidth - runStartX, height);
      g.fill({ color: runColor, alpha: runAlpha });
    }
  }

  /**
   * Clear all graphics.
   */
  public clear(): void {
    for (const graphics of this.getGraphics()) {
      graphics.clear();
    }
  }

  /**
   * Destroy all graphics and cleanup.
   */
  public destroy(): void {
    for (const graphics of this.getGraphics()) {
      graphics.destroy();
    }
  }

  // ============================================================================
  // PRIVATE RENDER METHODS
  // ============================================================================

  /**
   * Render marker backgrounds as vertical colored bands.
   * Follows the same pattern as minimap marker rendering.
   */
  private renderMarkers(
    markers: TimelineMarker[],
    viewportState: ViewportState,
    totalDuration: number,
  ): void {
    const { zoom, offsetX, displayWidth } = viewportState;
    const g = this.markerGraphics;

    const gap = 1;
    const halfGap = gap / 2;

    for (let i = 0; i < markers.length; i++) {
      const marker = markers[i]!;
      const startX = marker.startTime * zoom - offsetX;
      const endTime = markers[i + 1]?.startTime ?? totalDuration;
      const endX = endTime * zoom - offsetX;

      // Viewport culling
      if (endX < 0 || startX > displayWidth) {
        continue;
      }

      const color = METRIC_STRIP_MARKER_COLORS_BLENDED[marker.type];
      if (color === undefined) {
        continue;
      }

      const gappedStartX = Math.max(0, startX + halfGap);
      const gappedEndX = Math.min(displayWidth, endX - halfGap);
      const gappedWidth = gappedEndX - gappedStartX;

      if (gappedWidth > 0) {
        g.rect(gappedStartX, 0, gappedWidth, this.height);
        g.fill({ color, alpha: METRIC_STRIP_MARKER_OPACITY });
      }
    }
  }

  /**
   * Render danger zone band (80% to 100%).
   */
  private renderDangerZone(displayWidth: number, height: number): void {
    const g = this.dangerZoneGraphics;

    const y1 = this.percentToY(METRIC_STRIP_THRESHOLDS.limit, height); // 100% (top of band)
    const y2 = this.percentToY(METRIC_STRIP_THRESHOLDS.dangerStart, height); // 80% (bottom of band)
    const bandHeight = y2 - y1;

    g.rect(0, y1, displayWidth, bandHeight);
    g.fill({ color: this.colors.dangerZone, alpha: DANGER_ZONE_OPACITY });
  }

  /**
   * Render area fills under metric lines.
   */
  private renderAreaFills(
    data: MetricStripProcessedData,
    viewportState: ViewportState,
    totalDuration: number,
    height: number,
  ): void {
    const g = this.areaFillGraphics;
    const { zoom, offsetX, displayWidth } = viewportState;
    const visibleStartTime = offsetX / zoom;
    const visibleEndTime = (offsetX + displayWidth) / zoom;

    // Render area fills for Tier 1 and Tier 2 metrics
    for (const metric of data.classifiedMetrics) {
      if (metric.tier === 1 || metric.tier === 2) {
        this.renderAreaFill(
          g,
          data.points,
          (p) => p.values.get(metric.metricId) ?? 0,
          visibleStartTime,
          visibleEndTime,
          viewportState,
          totalDuration,
          height,
          metric.color,
          this.colors.areaFillOpacity,
        );
      }
    }

    // Render Tier 3 aggregate area fill
    if (data.classifiedMetrics.some((m) => m.tier === 3)) {
      this.renderAreaFill(
        g,
        data.points,
        (p) => p.tier3Max,
        visibleStartTime,
        visibleEndTime,
        viewportState,
        totalDuration,
        height,
        this.colors.tier3,
        this.colors.areaFillOpacity * 0.5,
      );
    }
  }

  /**
   * Render area fill for a metric using a value extractor.
   * Capped at 100% for clean visual appearance.
   */
  private renderAreaFill(
    g: Graphics,
    points: MetricStripDataPoint[],
    getValue: ValueExtractor,
    visibleStartTime: number,
    visibleEndTime: number,
    viewportState: ViewportState,
    totalDuration: number,
    height: number,
    color: number,
    alpha: number,
  ): void {
    const { zoom, offsetX, displayWidth } = viewportState;
    const baseY = this.percentToY(0, height);
    const pathPoints: Array<{ x: number; y: number }> = [];

    for (let i = 0; i < points.length; i++) {
      const point = points[i]!;
      const segmentEnd = points[i + 1]?.timestamp ?? totalDuration;

      if (segmentEnd < visibleStartTime) {
        continue;
      }
      if (point.timestamp > visibleEndTime) {
        break;
      }

      const percent = getValue(point);
      const x1 = point.timestamp * zoom - offsetX;
      const x2 = segmentEnd * zoom - offsetX;
      const y = this.percentToY(Math.min(percent, 1.0), height);

      if (pathPoints.length === 0) {
        pathPoints.push({ x: Math.max(0, x1), y: baseY });
      }

      pathPoints.push({ x: Math.max(0, x1), y });
      pathPoints.push({ x: Math.min(displayWidth, x2), y });
    }

    if (pathPoints.length < 2) {
      return;
    }

    pathPoints.push({ x: pathPoints[pathPoints.length - 1]!.x, y: baseY });

    g.moveTo(pathPoints[0]!.x, pathPoints[0]!.y);
    for (let i = 1; i < pathPoints.length; i++) {
      g.lineTo(pathPoints[i]!.x, pathPoints[i]!.y);
    }
    g.closePath();
    g.fill({ color, alpha });
  }

  /**
   * Render step chart lines for all metrics.
   */
  private renderStepChartLines(
    data: MetricStripProcessedData,
    viewportState: ViewportState,
    totalDuration: number,
    height: number,
  ): void {
    const g = this.lineGraphics;

    // Render Tier 1 and Tier 2 metrics with solid lines
    for (const metric of data.classifiedMetrics) {
      if (metric.tier === 1 || metric.tier === 2) {
        this.renderStepChartLine(
          g,
          data.points,
          (p) => p.values.get(metric.metricId) ?? 0,
          viewportState,
          totalDuration,
          height,
          metric.color,
          METRIC_STRIP_LINE_WIDTHS.primary,
          1.0,
        );
      }
    }

    // Render Tier 3 aggregate line
    if (data.classifiedMetrics.some((m) => m.tier === 3)) {
      this.renderStepChartLine(
        g,
        data.points,
        (p) => p.tier3Max,
        viewportState,
        totalDuration,
        height,
        this.colors.tier3,
        METRIC_STRIP_LINE_WIDTHS.tier3,
        0.7,
      );
    }
  }

  /**
   * Render a step chart line using a value extractor.
   */
  private renderStepChartLine(
    g: Graphics,
    points: MetricStripDataPoint[],
    getValue: ValueExtractor,
    viewportState: ViewportState,
    totalDuration: number,
    height: number,
    color: number,
    width: number,
    alpha: number,
  ): void {
    const { zoom, offsetX, displayWidth } = viewportState;
    const visibleStartTime = offsetX / zoom;
    const visibleEndTime = (offsetX + displayWidth) / zoom;

    let isFirst = true;
    let prevY = 0;

    for (let i = 0; i < points.length; i++) {
      const point = points[i]!;
      const segmentEnd = points[i + 1]?.timestamp ?? totalDuration;

      if (segmentEnd < visibleStartTime) {
        continue;
      }
      if (point.timestamp > visibleEndTime) {
        break;
      }

      const percent = getValue(point);
      const x1 = point.timestamp * zoom - offsetX;
      const x2 = segmentEnd * zoom - offsetX;
      const y = this.percentToY(percent, height);

      if (isFirst) {
        g.moveTo(x1, y);
        isFirst = false;
      } else {
        g.lineTo(x1, prevY);
        g.lineTo(x1, y);
      }

      g.lineTo(x2, y);
      prevY = y;
    }

    if (!isFirst) {
      g.stroke({ color, width, alpha });
    }
  }

  /**
   * Render the 100% limit line with label.
   */
  private renderLimitLine(displayWidth: number, height: number): void {
    const g = this.limitLineGraphics;
    const y = this.percentToY(1.0, height);

    // Dashed line (simulated with multiple segments)
    let x = 0;
    while (x < displayWidth) {
      const dashEnd = Math.min(x + LIMIT_LINE_DASH, displayWidth);
      g.moveTo(x, y);
      g.lineTo(dashEnd, y);
      x += LIMIT_LINE_DASH + LIMIT_LINE_GAP;
    }

    g.stroke({
      color: this.colors.limitLine,
      width: METRIC_STRIP_LINE_WIDTHS.limit,
      alpha: 0.8,
    });
  }

  /**
   * Render breach areas (above 100%) in purple.
   */
  private renderBreachAreas(
    data: MetricStripProcessedData,
    viewportState: ViewportState,
    totalDuration: number,
    height: number,
  ): void {
    const g = this.breachGraphics;
    const { zoom, offsetX, displayWidth } = viewportState;

    const visibleStartTime = offsetX / zoom;
    const visibleEndTime = (offsetX + displayWidth) / zoom;
    const limitY = this.percentToY(1.0, height);

    for (let i = 0; i < data.points.length; i++) {
      const point = data.points[i]!;
      const segmentEnd = data.points[i + 1]?.timestamp ?? totalDuration;

      if (segmentEnd < visibleStartTime) {
        continue;
      }
      if (point.timestamp > visibleEndTime) {
        break;
      }

      const maxPercent = this.getMaxPercentAtPoint(point);

      // Only render if breaching 100%
      if (maxPercent > 1.0) {
        const x1 = Math.max(0, point.timestamp * zoom - offsetX);
        const x2 = Math.min(displayWidth, segmentEnd * zoom - offsetX);
        const y = this.percentToY(maxPercent, height);
        const rectHeight = limitY - y;

        if (rectHeight > 0 && x2 > x1) {
          g.rect(x1, y, x2 - x1, rectHeight);
          g.fill({ color: this.colors.breachArea, alpha: BREACH_AREA_OPACITY });
        }
      }
    }
  }

  // ============================================================================
  // HELPERS
  // ============================================================================

  /**
   * Get the maximum percentage across all metrics at a data point.
   * Includes both individual metric values and tier3Max.
   */
  private getMaxPercentAtPoint(point: MetricStripDataPoint): number {
    let max = 0;
    for (const percent of point.values.values()) {
      if (percent > max) {
        max = percent;
      }
    }
    return Math.max(max, point.tier3Max);
  }

  /**
   * Convert percentage (0-1.2+) to Y coordinate.
   * 0% is at bottom, effectiveYMax at top.
   */
  private percentToY(percent: number, height: number): number {
    const clampedPercent = Math.max(0, Math.min(this.effectiveYMax, percent));
    return height * (1 - clampedPercent / this.effectiveYMax);
  }
}
