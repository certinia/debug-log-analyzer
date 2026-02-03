/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * MeshMetricStripRenderer
 *
 * Performance-optimized renderer for the metric strip using PixiJS Mesh.
 * Uses mesh-based rendering for filled rectangles (danger zone, area fills, breach areas)
 * while keeping Graphics for line rendering (step charts, limit line).
 *
 * Performance optimizations:
 * - Single Mesh draw call for all rectangles
 * - Direct buffer updates (no scene graph overhead)
 * - Clip-space coordinates (no uniform binding overhead)
 * - Lines still use Graphics (thin lines don't benefit from mesh batching)
 *
 * Render Order (back to front):
 * 1. Marker backgrounds (mesh)
 * 2. Vertical time grid lines (graphics)
 * 3. Danger zone band (mesh)
 * 4. Area fills under lines (mesh)
 * 5. Step chart lines (graphics)
 * 6. 100% limit line (graphics)
 * 7. Breach areas (mesh)
 */

import { Container, Geometry, Graphics, Mesh, Shader } from 'pixi.js';
import type {
  MetricStripClassifiedMetric,
  MetricStripDataPoint,
  MetricStripProcessedData,
  TimelineMarker,
  ViewportState,
} from '../../types/flamechart.types.js';
import { RectangleGeometry } from '../RectangleGeometry.js';
import { createRectangleShader } from '../RectangleShader.js';
import {
  BREACH_AREA_OPACITY,
  DANGER_ZONE_OPACITY,
  getMetricStripColors,
  METRIC_STRIP_HEIGHT,
  METRIC_STRIP_LINE_WIDTHS,
  METRIC_STRIP_MARKER_COLORS_BLENDED,
  METRIC_STRIP_MARKER_OPACITY,
  METRIC_STRIP_THRESHOLDS,
  METRIC_STRIP_Y_MAX_PERCENT,
  type MetricStripColors,
} from './metric-strip-colors.js';

/**
 * Viewport transform for metric strip (screen space).
 */
interface MetricStripTransform {
  displayWidth: number;
  displayHeight: number;
}

export class MeshMetricStripRenderer {
  // ============================================================================
  // MESH RESOURCES
  // ============================================================================
  private container: Container;
  private geometry: RectangleGeometry;
  private shader: Shader;
  private mesh: Mesh<Geometry, Shader>;

  // ============================================================================
  // GRAPHICS (for lines)
  // ============================================================================
  private lineGraphics: Graphics;
  private limitLineGraphics: Graphics;

  // ============================================================================
  // STATE
  // ============================================================================
  private colors: MetricStripColors;
  private isDarkTheme = true;
  private height = METRIC_STRIP_HEIGHT;
  private effectiveYMax = METRIC_STRIP_Y_MAX_PERCENT;
  private isCollapsed = false;

  constructor() {
    // Create container for all graphics
    this.container = new Container();

    // Create geometry and shader for rectangles
    this.geometry = new RectangleGeometry();
    this.shader = createRectangleShader();

    // Create mesh for rendering rectangles
    this.mesh = new Mesh<Geometry, Shader>({
      geometry: this.geometry.getGeometry(),
      shader: this.shader,
    });
    this.mesh.label = 'MeshMetricStripRenderer';
    this.container.addChild(this.mesh);

    // Create graphics for lines
    this.lineGraphics = new Graphics();
    this.limitLineGraphics = new Graphics();

    // Add graphics in render order (mesh is first/bottom, then chart lines)
    this.container.addChild(this.lineGraphics);
    this.container.addChild(this.limitLineGraphics);

    this.colors = getMetricStripColors(true);
  }

  /**
   * Get the container with all graphics objects.
   */
  public getContainer(): Container {
    return this.container;
  }

  /**
   * Get all graphics objects for adding to a container.
   * Returns mesh container plus individual graphics in correct render order.
   */
  public getGraphics(): (Container | Graphics)[] {
    return [this.container];
  }

  /**
   * Set the theme for color selection.
   */
  public setTheme(isDark: boolean): void {
    this.isDarkTheme = isDark;
    this.colors = getMetricStripColors(isDark);
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
   * Render the metric strip visualization.
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

    // Note: Time grid lines are now rendered by MeshAxisRenderer in MetricStripOrchestrator

    // Count rectangles needed for mesh rendering
    let rectCount = 0;
    if (markers && markers.length > 0) {
      rectCount += markers.length; // Markers (always rendered, even in collapsed mode)
    }
    if (!this.isCollapsed) {
      rectCount += 1; // Danger zone
      if (data.hasData) {
        const visibleMetrics = data.classifiedMetrics.filter((m) => m.tier === 1 || m.tier === 2);
        rectCount += visibleMetrics.length * data.points.length; // Area fills estimate
        rectCount += data.points.length; // Breach areas estimate
      }
    }

    // Ensure buffer capacity
    this.geometry.ensureCapacity(rectCount);

    // Create transform for clip-space conversion
    const transform: MetricStripTransform = {
      displayWidth,
      displayHeight: height,
    };

    let rectIndex = 0;

    // Always render markers as mesh rectangles (background layer, visible in both modes)
    if (markers && markers.length > 0) {
      rectIndex = this.renderMarkersToMesh(
        markers,
        viewportState,
        totalDuration,
        transform,
        rectIndex,
      );
    }

    // In collapsed mode, only render markers (already done above)
    if (this.isCollapsed) {
      this.renderCollapsedView(displayWidth, height);
      // Set draw count for mesh (markers only)
      this.geometry.setDrawCount(rectIndex);
      this.mesh.visible = rectIndex > 0;
      return;
    }

    // Full rendering mode
    // Render danger zone as mesh rectangle
    rectIndex = this.renderDangerZoneToMesh(displayWidth, height, transform, rectIndex);

    if (data.hasData) {
      // Render area fills as mesh rectangles
      rectIndex = this.renderAreaFillsToMesh(
        data,
        viewportState,
        totalDuration,
        height,
        transform,
        rectIndex,
      );

      // Render step chart lines (graphics)
      this.renderStepChartLines(data, viewportState, totalDuration, height);

      // Render limit line (graphics)
      this.renderLimitLine(displayWidth, height);

      // Render breach areas as mesh rectangles
      rectIndex = this.renderBreachAreasToMesh(
        data,
        viewportState,
        totalDuration,
        height,
        transform,
        rectIndex,
      );
    }

    // Set draw count for mesh
    this.geometry.setDrawCount(rectIndex);
    this.mesh.visible = rectIndex > 0;
  }

  /**
   * Clear all graphics.
   */
  public clear(): void {
    this.geometry.setDrawCount(0);
    this.mesh.visible = false;
    this.lineGraphics.clear();
    this.limitLineGraphics.clear();
  }

  /**
   * Destroy all resources.
   */
  public destroy(): void {
    this.geometry.destroy();
    this.mesh.destroy();
    this.lineGraphics.destroy();
    this.limitLineGraphics.destroy();
    this.container.destroy();
  }

  // ============================================================================
  // PRIVATE: MESH RENDERING
  // ============================================================================

  /**
   * Write a screen-space rectangle to the mesh geometry.
   * Converts screen coordinates to clip space.
   */
  private writeScreenRect(
    rectIndex: number,
    x: number,
    y: number,
    width: number,
    height: number,
    color: number,
    alpha: number,
    transform: MetricStripTransform,
  ): void {
    // Blend color with alpha
    const blendedColor = this.blendColorWithAlpha(color, alpha);

    // Convert screen coordinates to clip space
    // Screen: (0,0) top-left, (width, height) bottom-right
    // Clip: (-1,1) top-left, (1,-1) bottom-right
    const clipX1 = (x / transform.displayWidth) * 2 - 1;
    const clipX2 = ((x + width) / transform.displayWidth) * 2 - 1;
    const clipY1 = 1 - (y / transform.displayHeight) * 2;
    const clipY2 = 1 - ((y + height) / transform.displayHeight) * 2;

    // Write directly to geometry's internal arrays
    // We need to use a custom write since RectangleGeometry expects world coords
    this.writeClipSpaceRect(rectIndex, clipX1, clipY1, clipX2, clipY2, blendedColor);
  }

  /**
   * Write a clip-space rectangle directly to geometry buffers.
   */
  private writeClipSpaceRect(
    rectIndex: number,
    clipX1: number,
    clipY1: number,
    clipX2: number,
    clipY2: number,
    packedColor: number,
  ): void {
    // Access internal buffers - we need to bypass the normal writeRectangle
    // since it does world-to-screen-to-clip conversion
    const positionData = (this.geometry as unknown as { positionData: Float32Array }).positionData;
    const colorData = (this.geometry as unknown as { colorData: Uint32Array }).colorData;

    const positionOffset = rectIndex * 6 * 2; // 6 vertices * 2 floats
    const colorOffset = rectIndex * 6; // 6 vertices

    // Triangle 1: top-left, top-right, bottom-right
    positionData[positionOffset] = clipX1;
    positionData[positionOffset + 1] = clipY1;
    positionData[positionOffset + 2] = clipX2;
    positionData[positionOffset + 3] = clipY1;
    positionData[positionOffset + 4] = clipX2;
    positionData[positionOffset + 5] = clipY2;

    // Triangle 2: top-left, bottom-right, bottom-left
    positionData[positionOffset + 6] = clipX1;
    positionData[positionOffset + 7] = clipY1;
    positionData[positionOffset + 8] = clipX2;
    positionData[positionOffset + 9] = clipY2;
    positionData[positionOffset + 10] = clipX1;
    positionData[positionOffset + 11] = clipY2;

    // Write color for all 6 vertices
    colorData[colorOffset] = packedColor;
    colorData[colorOffset + 1] = packedColor;
    colorData[colorOffset + 2] = packedColor;
    colorData[colorOffset + 3] = packedColor;
    colorData[colorOffset + 4] = packedColor;
    colorData[colorOffset + 5] = packedColor;
  }

  /**
   * Blend color with alpha into packed ABGR format.
   */
  private blendColorWithAlpha(color: number, alpha: number): number {
    const r = (color >> 16) & 0xff;
    const g = (color >> 8) & 0xff;
    const b = color & 0xff;
    const a = Math.round(alpha * 255);
    return (a << 24) | (b << 16) | (g << 8) | r; // ABGR format
  }

  /**
   * Render markers to mesh.
   */
  private renderMarkersToMesh(
    markers: TimelineMarker[],
    viewportState: ViewportState,
    totalDuration: number,
    transform: MetricStripTransform,
    startIndex: number,
  ): number {
    const { zoom, offsetX, displayWidth } = viewportState;
    let rectIndex = startIndex;

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

      const clampedStartX = Math.max(0, startX);
      const clampedEndX = Math.min(displayWidth, endX);
      const width = clampedEndX - clampedStartX;

      if (width > 0) {
        this.writeScreenRect(
          rectIndex,
          clampedStartX,
          0,
          width,
          this.height,
          color,
          METRIC_STRIP_MARKER_OPACITY,
          transform,
        );
        rectIndex++;
      }
    }

    return rectIndex;
  }

  /**
   * Render danger zone to mesh.
   */
  private renderDangerZoneToMesh(
    displayWidth: number,
    height: number,
    transform: MetricStripTransform,
    startIndex: number,
  ): number {
    const y1 = this.percentToY(METRIC_STRIP_THRESHOLDS.limit, height);
    const y2 = this.percentToY(METRIC_STRIP_THRESHOLDS.dangerStart, height);
    const bandHeight = y2 - y1;

    this.writeScreenRect(
      startIndex,
      0,
      y1,
      displayWidth,
      bandHeight,
      this.colors.dangerZone,
      DANGER_ZONE_OPACITY,
      transform,
    );
    return startIndex + 1;
  }

  /**
   * Render area fills to mesh.
   */
  private renderAreaFillsToMesh(
    data: MetricStripProcessedData,
    viewportState: ViewportState,
    totalDuration: number,
    height: number,
    transform: MetricStripTransform,
    startIndex: number,
  ): number {
    const { zoom, offsetX, displayWidth } = viewportState;
    const visibleMetrics = data.classifiedMetrics.filter((m) => m.tier === 1 || m.tier === 2);
    let rectIndex = startIndex;

    for (const metric of visibleMetrics) {
      for (let i = 0; i < data.points.length; i++) {
        const point = data.points[i]!;
        const nextPoint = data.points[i + 1];
        const endTime = nextPoint?.timestamp ?? totalDuration;

        const startX = point.timestamp * zoom - offsetX;
        const endX = endTime * zoom - offsetX;

        // Viewport culling
        if (endX < 0 || startX > displayWidth) {
          continue;
        }

        const percent = point.values.get(metric.metricId) ?? 0;
        if (percent <= 0) {
          continue;
        }

        const clampedStartX = Math.max(0, startX);
        const clampedEndX = Math.min(displayWidth, endX);
        const width = clampedEndX - clampedStartX;

        if (width > 0) {
          const y = this.percentToY(percent, height);
          const fillHeight = height - y;
          this.writeScreenRect(
            rectIndex,
            clampedStartX,
            y,
            width,
            fillHeight,
            metric.color,
            this.colors.areaFillOpacity,
            transform,
          );
          rectIndex++;
        }
      }
    }

    return rectIndex;
  }

  /**
   * Render breach areas to mesh.
   */
  private renderBreachAreasToMesh(
    data: MetricStripProcessedData,
    viewportState: ViewportState,
    totalDuration: number,
    height: number,
    transform: MetricStripTransform,
    startIndex: number,
  ): number {
    const { zoom, offsetX, displayWidth } = viewportState;
    let rectIndex = startIndex;

    // Find max percent at each point
    for (let i = 0; i < data.points.length; i++) {
      const point = data.points[i]!;
      const nextPoint = data.points[i + 1];
      const endTime = nextPoint?.timestamp ?? totalDuration;

      // Find max percent from all visible metrics
      let maxPercent = 0;
      for (const metric of data.classifiedMetrics) {
        if (metric.tier === 1 || metric.tier === 2) {
          const percent = point.values.get(metric.metricId) ?? 0;
          maxPercent = Math.max(maxPercent, percent);
        }
      }
      maxPercent = Math.max(maxPercent, point.tier3Max);

      if (maxPercent <= METRIC_STRIP_THRESHOLDS.limit) {
        continue;
      }

      const startX = point.timestamp * zoom - offsetX;
      const endX = endTime * zoom - offsetX;

      // Viewport culling
      if (endX < 0 || startX > displayWidth) {
        continue;
      }

      const clampedStartX = Math.max(0, startX);
      const clampedEndX = Math.min(displayWidth, endX);
      const width = clampedEndX - clampedStartX;

      if (width > 0) {
        const topY = this.percentToY(maxPercent, height);
        const bottomY = this.percentToY(METRIC_STRIP_THRESHOLDS.limit, height);
        const fillHeight = bottomY - topY;

        if (fillHeight > 0) {
          this.writeScreenRect(
            rectIndex,
            clampedStartX,
            topY,
            width,
            fillHeight,
            this.colors.breachArea,
            BREACH_AREA_OPACITY,
            transform,
          );
          rectIndex++;
        }
      }
    }

    return rectIndex;
  }

  // ============================================================================
  // PRIVATE: GRAPHICS RENDERING (lines)
  // ============================================================================

  /**
   * Render step chart lines using Graphics.
   */
  private renderStepChartLines(
    data: MetricStripProcessedData,
    viewportState: ViewportState,
    totalDuration: number,
    height: number,
  ): void {
    const g = this.lineGraphics;
    const { zoom, offsetX, displayWidth } = viewportState;

    // Get visible time range
    const visibleStartTime = offsetX / zoom;
    const visibleEndTime = (offsetX + displayWidth) / zoom;

    // Render lines for Tier 1 and Tier 2 metrics
    const visibleMetrics = data.classifiedMetrics.filter((m) => m.tier === 1 || m.tier === 2);

    for (const metric of visibleMetrics) {
      this.renderMetricLine(
        g,
        data.points,
        metric,
        visibleStartTime,
        visibleEndTime,
        viewportState,
        totalDuration,
        height,
      );
    }

    // Render Tier 3 aggregated line if there are Tier 3 metrics with data
    const tier3Metrics = data.classifiedMetrics.filter((m) => m.tier === 3);
    if (tier3Metrics.length > 0) {
      this.renderTier3Line(
        g,
        data.points,
        visibleStartTime,
        visibleEndTime,
        viewportState,
        totalDuration,
        height,
      );
    }
  }

  /**
   * Render a single metric line.
   */
  private renderMetricLine(
    g: Graphics,
    points: MetricStripDataPoint[],
    metric: MetricStripClassifiedMetric,
    visibleStartTime: number,
    visibleEndTime: number,
    viewportState: ViewportState,
    totalDuration: number,
    height: number,
  ): void {
    const { zoom, offsetX, displayWidth } = viewportState;
    const lineWidth = METRIC_STRIP_LINE_WIDTHS.primary;

    let isFirstPoint = true;
    let lastX = 0;
    let lastY = height;

    for (let i = 0; i < points.length; i++) {
      const point = points[i]!;
      const nextPoint = points[i + 1];
      const endTime = nextPoint?.timestamp ?? totalDuration;

      // Skip if completely outside visible range
      if (endTime < visibleStartTime || point.timestamp > visibleEndTime) {
        continue;
      }

      const percent = point.values.get(metric.metricId) ?? 0;
      const y = this.percentToY(percent, height);

      const startX = Math.max(0, point.timestamp * zoom - offsetX);
      const endX = Math.min(displayWidth, endTime * zoom - offsetX);

      if (isFirstPoint) {
        g.moveTo(startX, y);
        isFirstPoint = false;
      } else {
        // Draw vertical line from last Y to current Y
        g.lineTo(lastX, y);
      }

      // Draw horizontal line to end of this segment
      g.lineTo(endX, y);

      lastX = endX;
      lastY = y;
    }

    if (!isFirstPoint) {
      g.stroke({ width: lineWidth, color: metric.color });
    }
  }

  /**
   * Render the Tier 3 aggregated line (dashed).
   */
  private renderTier3Line(
    g: Graphics,
    points: MetricStripDataPoint[],
    visibleStartTime: number,
    visibleEndTime: number,
    viewportState: ViewportState,
    totalDuration: number,
    height: number,
  ): void {
    const { zoom, offsetX, displayWidth } = viewportState;
    const lineWidth = METRIC_STRIP_LINE_WIDTHS.tier3;
    const dashLength = 4;
    const gapLength = 4;

    for (let i = 0; i < points.length; i++) {
      const point = points[i]!;
      const nextPoint = points[i + 1];
      const endTime = nextPoint?.timestamp ?? totalDuration;

      if (endTime < visibleStartTime || point.timestamp > visibleEndTime) {
        continue;
      }

      const percent = point.tier3Max;
      if (percent <= 0) {
        continue;
      }

      const y = this.percentToY(percent, height);
      const startX = Math.max(0, point.timestamp * zoom - offsetX);
      const endX = Math.min(displayWidth, endTime * zoom - offsetX);

      // Draw dashed horizontal line
      let x = startX;
      while (x < endX) {
        const dashEnd = Math.min(x + dashLength, endX);
        g.moveTo(x, y);
        g.lineTo(dashEnd, y);
        x = dashEnd + gapLength;
      }
    }

    g.stroke({ width: lineWidth, color: this.colors.tier3 });
  }

  /**
   * Render the 100% limit line.
   */
  private renderLimitLine(displayWidth: number, height: number): void {
    const g = this.limitLineGraphics;
    const y = this.percentToY(METRIC_STRIP_THRESHOLDS.limit, height);
    const dashLength = 6;
    const gapLength = 4;

    // Draw dashed line
    let x = 0;
    while (x < displayWidth) {
      const dashEnd = Math.min(x + dashLength, displayWidth);
      g.moveTo(x, y);
      g.lineTo(dashEnd, y);
      x = dashEnd + gapLength;
    }

    g.stroke({ width: METRIC_STRIP_LINE_WIDTHS.limit, color: this.colors.limitLine });
  }

  /**
   * Render the collapsed view.
   */
  private renderCollapsedView(displayWidth: number, height: number): void {
    const y = height / 2;
    const g = this.limitLineGraphics;
    g.moveTo(0, y);
    g.lineTo(displayWidth, y);
    g.stroke({ width: 1, color: this.colors.limitLine, alpha: 0.5 });
  }

  /**
   * Convert percentage to Y coordinate.
   */
  private percentToY(percent: number, height: number): number {
    const clampedPercent = Math.min(percent, this.effectiveYMax);
    return height * (1 - clampedPercent / this.effectiveYMax);
  }
}
