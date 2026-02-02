/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * MinimapRenderer
 *
 * PIXI.js renderer for the timeline minimap visualization.
 * Renders skyline area chart, viewport lens, 2D curtain effect, markers, and cursor mirror.
 *
 * Visual design:
 * - Skyline (area chart): Filled polygon where Y=depth and opacity=log(density)
 * - 2D Curtain effect: Semi-transparent overlay outside the viewport lens (X and Y)
 * - Lens borders: Rectangular window with draggable edges
 * - Marker bands: Colored vertical bands from main timeline
 * - Cursor line: Vertical guide mirroring cursor from other view
 *
 * Performance architecture:
 * - Static layers (background, skyline, markers, axis): Cached as RenderTexture
 * - Dynamic layers (curtain, lens, cursor): Redrawn every frame
 * - Static content only invalidated on resize, data change, or theme change
 *
 * Performance requirements:
 * - Reuse Graphics objects (clear() instead of destroy/recreate)
 * - <2ms full render during pan/zoom (dynamic layers only)
 */

import * as PIXI from 'pixi.js';
import { formatDuration, formatTimeRange } from '../../../../core/utility/Util.js';
import type {
  HeatStripTimeSeries,
  MarkerType,
  TimelineMarker,
} from '../../types/flamechart.types.js';
import { MARKER_ALPHA, MARKER_COLORS } from '../../types/flamechart.types.js';
import { blendWithBackground } from '../BucketColorResolver.js';
import { createRectangleShader } from '../RectangleShader.js';
import { HEAT_STRIP_HEIGHT, HeatStripRenderer } from './HeatStripRenderer.js';
import { MinimapAxisRenderer } from './MinimapAxisRenderer.js';
import { MinimapBarGeometry } from './MinimapBarGeometry.js';
import type { MinimapDensityData } from './MinimapDensityQuery.js';
import type { MinimapManager, MinimapSelection } from './MinimapManager.js';

// Re-export heat strip height for use by other components
export { HEAT_STRIP_HEIGHT };

/**
 * Opacity constants for density visualization (logarithmic scale).
 */
const MIN_OPACITY = 0.5;
const MAX_OPACITY = 1.0;
const SATURATION_COUNT = 100;

/**
 * Pre-blended opaque marker colors (MARKER_COLORS blended at MARKER_ALPHA opacity).
 * Computed once at module load time for performance.
 */
const MINIMAP_MARKER_COLORS_BLENDED: Record<MarkerType, number> = {
  error: blendWithBackground(MARKER_COLORS.error, MARKER_ALPHA),
  skip: blendWithBackground(MARKER_COLORS.skip, MARKER_ALPHA),
  unexpected: blendWithBackground(MARKER_COLORS.unexpected, MARKER_ALPHA),
};

/**
 * Curtain overlay opacity (outside viewport lens).
 */
const CURTAIN_OPACITY = 0.5;

/**
 * Edge handle width in pixels.
 */
const EDGE_HANDLE_WIDTH = 2;

/**
 * Cursor line width and color.
 */
const CURSOR_LINE_WIDTH = 1;
const CURSOR_LINE_COLOR = 0xffffff;
const CURSOR_LINE_OPACITY = 0.6;

/**
 * Default colors extracted from CSS variables (VS Code theme compatible).
 */
interface MinimapColors {
  /** Curtain overlay color. */
  curtain: number;
  /** Lens border color. */
  lensBorder: number;
  /** Edge handle color (on hover/drag). */
  edgeHandle: number;
}

export class MinimapRenderer {
  /** Container for all minimap graphics. */
  private container: PIXI.Container;

  // ============================================================================
  // STATIC CONTENT (cached as RenderTexture, redrawn only on invalidation)
  // ============================================================================

  /** Container for static content (rendered to texture). */
  private staticContainer: PIXI.Container;

  /** Background rectangle. */
  private backgroundGraphics: PIXI.Graphics;

  /** Skyline mesh-based geometry for efficient bar rendering. */
  private skylineBarGeometry: MinimapBarGeometry;

  /** Skyline mesh instance using the bar geometry. */
  private skylineMesh: PIXI.Mesh<PIXI.Geometry, PIXI.Shader>;

  /** Marker bands from main timeline. */
  private markerGraphics: PIXI.Graphics;

  /** Time axis renderer (static). */
  private axisRenderer: MinimapAxisRenderer;

  /** Heat strip renderer (static). */
  private heatStripRenderer: HeatStripRenderer;

  /** Cached render texture for static content. */
  private staticTexture: PIXI.RenderTexture | null = null;

  /** Sprite displaying the cached static texture. */
  private staticSprite: PIXI.Sprite | null = null;

  /** Flag indicating static content needs redraw. */
  private staticDirty = true;

  /** Cached display width for invalidation detection. */
  private cachedDisplayWidth = 0;

  /** Cached display height for invalidation detection. */
  private cachedDisplayHeight = 0;

  // ============================================================================
  // DYNAMIC CONTENT (redrawn every frame)
  // ============================================================================

  /** Container for dynamic content (curtain, lens, cursor). */
  private dynamicContainer: PIXI.Container;

  /** 2D Curtain overlay (dimmed area outside lens in X and Y). */
  private curtainGraphics: PIXI.Graphics;

  /** Viewport lens borders. */
  private lensGraphics: PIXI.Graphics;

  /** Cursor mirror line. */
  private cursorLineGraphics: PIXI.Graphics;

  // ============================================================================
  // HTML LABEL (styled like MeasureRangeRenderer tooltip)
  // ============================================================================

  /** HTML container for label positioning. */
  private htmlContainer: HTMLElement;

  /** HTML label element for lens time info. */
  private labelElement: HTMLDivElement;

  /** HTML tooltip element for heat strip hover. */
  private heatStripTooltipElement: HTMLDivElement;

  // ============================================================================
  // OTHER STATE
  // ============================================================================

  /** Cached colors from CSS variables. */
  private colors: MinimapColors;

  /** Reference to PIXI renderer for texture rendering. */
  private renderer: PIXI.Renderer | null = null;

  /**
   * @param parentContainer - PIXI container to add minimap graphics to
   * @param htmlContainer - HTML element for positioning the lens label
   */
  constructor(parentContainer: PIXI.Container, htmlContainer: HTMLElement) {
    // Store HTML container for label positioning
    this.htmlContainer = htmlContainer;

    // Create main container at top of stage
    this.container = new PIXI.Container();
    this.container.position.set(0, 0);
    parentContainer.addChild(this.container);

    // ============================================================================
    // STATIC CONTENT SETUP
    // ============================================================================

    // Container for static content (will be rendered to texture)
    this.staticContainer = new PIXI.Container();

    // Static graphics layers
    this.backgroundGraphics = new PIXI.Graphics();
    this.markerGraphics = new PIXI.Graphics();

    // Create mesh-based skyline geometry for efficient bar rendering
    this.skylineBarGeometry = new MinimapBarGeometry();
    const skylineShader = createRectangleShader();
    this.skylineMesh = new PIXI.Mesh({
      geometry: this.skylineBarGeometry.getGeometry(),
      shader: skylineShader,
    });

    // Create axis renderer (doesn't add to parent - we control layer order)
    this.axisRenderer = new MinimapAxisRenderer();

    // Create heat strip renderer for metric visualization
    this.heatStripRenderer = new HeatStripRenderer();

    // Add static layers in correct order (back to front):
    // 1. Background
    // 2. Markers
    // 3. Axis (tick lines and labels - labels are in strip above chart area)
    // 4. Skyline (mesh-based for performance)
    // 5. Heat strip (at bottom of minimap)
    this.staticContainer.addChild(this.backgroundGraphics);
    this.staticContainer.addChild(this.markerGraphics);
    this.staticContainer.addChild(this.axisRenderer.getTickGraphics());
    this.staticContainer.addChild(this.axisRenderer.getLabelsContainer());
    this.staticContainer.addChild(this.skylineMesh);
    this.staticContainer.addChild(this.heatStripRenderer.getGraphics());

    // ============================================================================
    // DYNAMIC CONTENT SETUP
    // ============================================================================

    // Container for dynamic content
    this.dynamicContainer = new PIXI.Container();

    // Dynamic graphics layers
    this.curtainGraphics = new PIXI.Graphics();
    this.lensGraphics = new PIXI.Graphics();
    this.cursorLineGraphics = new PIXI.Graphics();

    // Add dynamic layers
    this.dynamicContainer.addChild(this.curtainGraphics);
    this.dynamicContainer.addChild(this.lensGraphics);
    this.dynamicContainer.addChild(this.cursorLineGraphics);

    // Add to main container (static sprite will be added when first rendered)
    this.container.addChild(this.dynamicContainer);

    // Extract colors from CSS variables
    this.colors = this.extractColors();

    // Create HTML label for lens time info
    this.labelElement = this.createLabelElement();
    htmlContainer.appendChild(this.labelElement);

    // Create HTML tooltip for heat strip hover
    this.heatStripTooltipElement = this.createHeatStripTooltipElement();
    htmlContainer.appendChild(this.heatStripTooltipElement);
  }

  /**
   * Create the HTML label element with styling matching timeline text labels.
   * Positioned at top of minimap (centered in axis area) to avoid blocking skyline.
   */
  private createLabelElement(): HTMLDivElement {
    const label = document.createElement('div');
    label.className = 'minimap-lens-label';
    label.style.cssText = `
      position: absolute;
      display: none;
      padding: 2px 6px;
      border-radius: 4px;
      background: var(--vscode-editorWidget-background, #252526);
      border: 1px solid var(--vscode-editorWidget-border, #454545);
      color: #e3e3e3;
      font-family: monospace;
      font-size: 10px;
      font-weight: lighter;
      pointer-events: none;
      z-index: 100;
      white-space: nowrap;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    `;
    return label;
  }

  /**
   * Create the HTML tooltip element for heat strip hover.
   * Shows governor limit percentages on hover.
   */
  private createHeatStripTooltipElement(): HTMLDivElement {
    const tooltip = document.createElement('div');
    tooltip.className = 'heat-strip-tooltip';
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
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
    `;
    return tooltip;
  }

  /**
   * Show the heat strip tooltip with metric data.
   *
   * @param screenX - X position for tooltip placement
   * @param screenY - Y position (tooltip appears above this)
   * @param timeNs - Time in nanoseconds to show data for
   */
  public showHeatStripTooltip(screenX: number, screenY: number, timeNs: number): void {
    const dataPoint = this.heatStripRenderer.getDataPointAtTime(timeNs);
    const metrics = this.heatStripRenderer.getMetrics();
    if (!dataPoint || !metrics) {
      this.hideHeatStripTooltip();
      return;
    }

    // Build tooltip content
    const { point } = dataPoint;
    const rows: string[] = [];

    // Sort metrics by priority (lower = shown first), then by percentage descending
    const sortedMetrics = Array.from(point.metricSnapshots.entries()).sort((a, b) => {
      const metricA = metrics.get(a[0]);
      const metricB = metrics.get(b[0]);
      const priorityA = metricA?.priority ?? 999;
      const priorityB = metricB?.priority ?? 999;
      if (priorityA !== priorityB) {
        return priorityA - priorityB;
      }
      return b[1].percent - a[1].percent;
    });

    // High-priority metrics (priority < 4) always shown, others only if > 0%
    const HIGH_PRIORITY_THRESHOLD = 4;

    for (const [metricId, snapshot] of sortedMetrics) {
      const metric = metrics.get(metricId);
      const isHighPriority = (metric?.priority ?? 999) < HIGH_PRIORITY_THRESHOLD;
      const isNonZero = snapshot.percent > 0;

      // Show high-priority metrics always, others only if > 0%
      if (isHighPriority || isNonZero) {
        const name = metric?.displayName ?? metricId;
        const percentStr = (snapshot.percent * 100).toFixed(1).padStart(5);
        const color = this.getPercentColor(snapshot.percent);
        const unit = metric?.unit ?? '';
        const valueStr = this.formatMetricValue(snapshot.used, snapshot.limit, unit);
        rows.push(
          `<div style="display:grid;grid-template-columns:140px 55px auto;gap:4px;margin:2px 0;">` +
            `<span style="color:var(--vscode-descriptionForeground, #999)">${name}</span>` +
            `<span style="text-align:right;color:${color}">${percentStr}%</span>` +
            `<span style="color:var(--vscode-descriptionForeground, #666)">(${valueStr})</span>` +
            `</div>`,
        );
      }
    }

    if (rows.length === 0) {
      this.hideHeatStripTooltip();
      return;
    }

    // Set content - title comes from first metric's context or default
    this.heatStripTooltipElement.innerHTML =
      `<div style="font-weight:bold;margin-bottom:4px;">Metrics</div>` + rows.join('');
    this.heatStripTooltipElement.style.display = 'block';

    // Position tooltip above the heat strip
    requestAnimationFrame(() => {
      const tooltipWidth = this.heatStripTooltipElement.offsetWidth;
      const tooltipHeight = this.heatStripTooltipElement.offsetHeight;
      const containerWidth = this.htmlContainer.offsetWidth;
      const padding = 4;

      // Center on cursor X, clamp to viewport
      let left = screenX - tooltipWidth / 2;
      left = Math.max(padding, Math.min(containerWidth - tooltipWidth - padding, left));

      // Position above the hover point
      const top = screenY - tooltipHeight - 8;

      this.heatStripTooltipElement.style.left = `${left}px`;
      this.heatStripTooltipElement.style.top = `${Math.max(0, top)}px`;
    });
  }

  /**
   * Hide the heat strip tooltip.
   */
  public hideHeatStripTooltip(): void {
    this.heatStripTooltipElement.style.display = 'none';
  }

  /**
   * Get color for percentage value (traffic light).
   */
  private getPercentColor(percent: number): string {
    if (percent >= 1.0) {
      return '#7c3aed'; // Purple - breached
    } else if (percent >= 0.8) {
      return '#dc2626'; // Red - critical
    } else if (percent >= 0.5) {
      return '#f59e0b'; // Amber - warning
    }
    return '#10b981'; // Green - safe
  }

  /**
   * Format metric value with used/limit and optional unit.
   */
  private formatMetricValue(used: number, limit: number, unit: string): string {
    const usedStr = this.formatNumber(used);
    const limitStr = this.formatNumber(limit);
    if (unit) {
      return `${usedStr} / ${limitStr} ${unit}`;
    }
    return `${usedStr} / ${limitStr}`;
  }

  /**
   * Format a number with thousands separators.
   */
  private formatNumber(value: number): string {
    return value.toLocaleString();
  }

  /**
   * Set the PIXI renderer for texture caching.
   * Must be called before render() to enable static content caching.
   */
  public setRenderer(renderer: PIXI.Renderer): void {
    this.renderer = renderer;
  }

  /**
   * Get the minimap container.
   */
  public getContainer(): PIXI.Container {
    return this.container;
  }

  /**
   * Invalidate static content cache.
   * Call this when minimap data, size, or theme changes.
   */
  public invalidateStatic(): void {
    this.staticDirty = true;
  }

  /**
   * Set heat strip time series data for visualization.
   * Call this when log data is loaded or changes.
   *
   * @param timeSeries - Generic heat strip time series data, or null to clear
   */
  public setHeatStripTimeSeries(timeSeries: HeatStripTimeSeries | null): void {
    if (timeSeries) {
      this.heatStripRenderer.processData(timeSeries);
    }
    this.invalidateStatic();
  }

  /**
   * Get the heat strip renderer for tooltip access.
   */
  public getHeatStripRenderer(): HeatStripRenderer {
    return this.heatStripRenderer;
  }

  /**
   * Render the complete minimap.
   *
   * Uses two-pass rendering for performance:
   * 1. Static pass: Only when invalidated (resize, data change, theme change)
   * 2. Dynamic pass: Every frame (curtain, lens, cursor)
   *
   * @param manager - MinimapManager with state
   * @param densityData - Density data for skyline
   * @param markers - Timeline markers to display
   * @param batchColors - Category colors from theme
   * @param cursorTimeNs - Cursor position in nanoseconds (null to hide cursor line)
   * @param isInteracting - Whether user is hovering or dragging (shows lens label)
   */
  public render(
    manager: MinimapManager,
    densityData: MinimapDensityData,
    markers: TimelineMarker[],
    batchColors: Map<string, { color: number }>,
    cursorTimeNs: number | null,
    isInteracting: boolean,
  ): void {
    const state = manager.getState();
    const selection = manager.getSelection();

    // Check if display size changed (auto-invalidate)
    if (
      state.displayWidth !== this.cachedDisplayWidth ||
      state.height !== this.cachedDisplayHeight
    ) {
      this.staticDirty = true;
      this.cachedDisplayWidth = state.displayWidth;
      this.cachedDisplayHeight = state.height;
    }

    // Render static content to texture if dirty
    if (this.staticDirty) {
      this.renderStaticContent(manager, densityData, markers, batchColors);
      this.staticDirty = false;
    }

    // Always render dynamic content
    this.renderDynamicContent(manager, selection, cursorTimeNs);

    // Update lens label visibility and content
    this.updateLensLabel(manager, selection, isInteracting);
  }

  /**
   * Update lens label visibility and content.
   * Shows compact duration when user is interacting with minimap.
   * Label is positioned at top of minimap (in axis area) to avoid blocking skyline.
   *
   * @param manager - MinimapManager for coordinate calculations
   * @param selection - Current lens selection
   * @param isInteracting - True if hovering or dragging
   */
  private updateLensLabel(
    manager: MinimapManager,
    selection: Readonly<MinimapSelection>,
    isInteracting: boolean,
  ): void {
    if (!isInteracting) {
      this.labelElement.style.display = 'none';
      return;
    }

    // Format content - duration with range: "1.23s (0.5s - 1.73s)"
    const duration = selection.endTime - selection.startTime;
    const durationStr = formatDuration(duration);
    const rangeStr = formatTimeRange(selection.startTime, selection.endTime);

    this.labelElement.textContent = `${durationStr} (${rangeStr})`;
    this.labelElement.style.display = 'block';

    // Calculate lens pixel bounds for horizontal centering
    const lensX1 = manager.timeToMinimapX(selection.startTime);
    const lensX2 = manager.timeToMinimapX(selection.endTime);
    const lensCenterX = (lensX1 + lensX2) / 2;

    // Position after content is rendered (need label dimensions)
    requestAnimationFrame(() => {
      const labelWidth = this.labelElement.offsetWidth;
      const containerWidth = this.htmlContainer.offsetWidth;
      const padding = 4;

      // Horizontal: center on lens, clamp to viewport
      let left = lensCenterX - labelWidth / 2;
      left = Math.max(padding, Math.min(containerWidth - labelWidth - padding, left));

      // Vertical: start at top edge of minimap
      const top = 0;

      this.labelElement.style.left = `${left}px`;
      this.labelElement.style.top = `${top}px`;
    });
  }

  /**
   * Render static content (background, skyline, markers, axis).
   * This is cached as a RenderTexture for performance.
   */
  private renderStaticContent(
    manager: MinimapManager,
    densityData: MinimapDensityData,
    markers: TimelineMarker[],
    batchColors: Map<string, { color: number }>,
  ): void {
    const state = manager.getState();
    const minimapHeight = state.height;
    const displayWidth = state.displayWidth;

    // Clear static graphics
    this.backgroundGraphics.clear();
    this.markerGraphics.clear();

    // Render skyline area chart
    this.renderSkyline(manager, densityData, batchColors, minimapHeight);

    // Render markers
    this.renderMarkers(manager, markers, minimapHeight);

    // Render time axis
    this.axisRenderer.render(manager);

    // Render governor limit heat strip
    this.heatStripRenderer.render(manager, minimapHeight, state.totalDuration);

    // If we have a renderer, cache to texture
    if (this.renderer && displayWidth > 0 && minimapHeight > 0) {
      // Create or resize texture
      if (
        !this.staticTexture ||
        this.staticTexture.width !== displayWidth ||
        this.staticTexture.height !== minimapHeight
      ) {
        if (this.staticTexture) {
          this.staticTexture.destroy(true);
        }
        // Create texture at device pixel ratio for crisp rendering
        const resolution = this.renderer.resolution;
        this.staticTexture = PIXI.RenderTexture.create({
          width: displayWidth,
          height: minimapHeight,
          resolution,
        });

        // Create sprite if needed
        if (!this.staticSprite) {
          this.staticSprite = new PIXI.Sprite(this.staticTexture);
          // Insert sprite at beginning of container (behind dynamic content)
          this.container.addChildAt(this.staticSprite, 0);
        } else {
          this.staticSprite.texture = this.staticTexture;
        }
      }

      // Render static container to texture
      this.renderer.render({
        container: this.staticContainer,
        target: this.staticTexture,
        clear: true,
      });
    }
  }

  /**
   * Render dynamic content (curtain, lens, cursor).
   * Called every frame during pan/zoom.
   */
  private renderDynamicContent(
    manager: MinimapManager,
    selection: Readonly<MinimapSelection>,
    cursorTimeNs: number | null,
  ): void {
    const state = manager.getState();
    const minimapHeight = state.height;

    // Clear dynamic graphics
    this.curtainGraphics.clear();
    this.lensGraphics.clear();
    this.cursorLineGraphics.clear();

    // Render 2D curtain (dimmed overlay outside lens in X and Y)
    this.render2DCurtain(manager, selection, minimapHeight);

    // Render lens borders (viewport indicator)
    this.renderLens(manager, selection, minimapHeight);

    // Render cursor mirror line
    if (cursorTimeNs !== null) {
      this.renderCursorLine(manager, cursorTimeNs, minimapHeight);
    }
  }

  /**
   * Render skyline as vertical bars using mesh-based rendering.
   * Each bucket becomes a single colored bar where:
   * - X-axis = time position
   * - Height = stack depth (normalized)
   * - Color = dominant category
   * - Opacity = event density (logarithmic scale)
   *
   * Uses mesh-based rendering for performance (~100ms → <20ms).
   */
  private renderSkyline(
    manager: MinimapManager,
    densityData: MinimapDensityData,
    batchColors: Map<string, { color: number }>,
    minimapHeight: number,
  ): void {
    const state = manager.getState();
    const { buckets, globalMaxDepth } = densityData;

    // Axis is at TOP - chart area is below it
    // When heat strip has data, chart ends above the heat strip track
    const axisHeight = this.axisRenderer.getHeight();
    const chartBottom = manager.getChartBottom();
    const chartHeight = chartBottom - axisHeight;

    if (globalMaxDepth === 0 || buckets.length === 0 || chartHeight <= 0) {
      this.skylineBarGeometry.setDrawCount(0);
      return;
    }

    // Configure geometry for this render
    this.skylineBarGeometry.setDisplayDimensions(state.displayWidth, minimapHeight);
    this.skylineBarGeometry.ensureCapacity(buckets.length);

    const bucketWidth = state.displayWidth / buckets.length;
    let barIndex = 0;

    for (let i = 0; i < buckets.length; i++) {
      const bucket = buckets[i]!;

      if (bucket.eventCount === 0) {
        continue;
      }

      const x = i * bucketWidth;

      // Calculate height from normalized depth
      const heightRatio = globalMaxDepth > 0 ? bucket.maxDepth / globalMaxDepth : 0;
      const barHeight = heightRatio * chartHeight;

      // Skip zero-height bars
      if (barHeight <= 0) {
        continue;
      }

      // Calculate opacity from event count
      const opacity = this.calculateDensityOpacity(bucket.eventCount);

      // Get color from batch colors
      const colorInfo = batchColors.get(bucket.dominantCategory);
      const color = colorInfo?.color ?? 0x808080;

      // Write bar to geometry buffer
      this.skylineBarGeometry.writeBar(
        barIndex,
        x,
        bucketWidth,
        barHeight,
        chartBottom,
        color,
        opacity,
      );
      barIndex++;
    }

    // Update GPU buffers with final bar count
    this.skylineBarGeometry.setDrawCount(barIndex);
  }

  /**
   * Calculate opacity based on event count using logarithmic scale.
   * 1 event = ~41%, 100+ events = ~70%.
   */
  private calculateDensityOpacity(eventCount: number): number {
    if (eventCount <= 0) {
      return 0;
    }

    const normalized = Math.min(eventCount / SATURATION_COUNT, 1);
    // Logarithmic curve: log10(x * 9 + 1) maps 0-1 to 0-1 with log shape
    const logScale = Math.log10(normalized * 9 + 1);
    return MIN_OPACITY + (MAX_OPACITY - MIN_OPACITY) * logScale;
  }

  /**
   * Render markers as colored vertical bands.
   * Uses pre-blended opaque colors and 1px gaps between adjacent markers.
   */
  private renderMarkers(
    manager: MinimapManager,
    markers: TimelineMarker[],
    minimapHeight: number,
  ): void {
    const state = manager.getState();

    // Axis is at TOP - chart area is below it
    // When heat strip has data, chart ends above the heat strip track
    const axisHeight = this.axisRenderer.getHeight();
    const chartTop = axisHeight;
    const chartBottom = manager.getChartBottom();
    const chartHeight = chartBottom - chartTop;

    // Apply 1px gap for negative space separation between adjacent markers
    // Same approach as TimelineMarkerRenderer: 0.5px inset from each edge
    const gap = 1;
    const halfGap = gap / 2;

    for (let i = 0; i < markers.length; i++) {
      const marker = markers[i]!;

      // Calculate marker bounds
      const startX = manager.timeToMinimapX(marker.startTime);

      // Marker extends to next marker or end of timeline
      const nextMarker = markers[i + 1];
      const endTime = nextMarker?.startTime ?? state.totalDuration;
      const endX = manager.timeToMinimapX(endTime);

      // Get pre-blended opaque marker color
      const color = MINIMAP_MARKER_COLORS_BLENDED[marker.type] ?? 0x808080;

      // Apply gap to create separation between adjacent markers
      const gappedStartX = startX + halfGap;
      const gappedWidth = Math.max(0, endX - startX - gap);

      // Draw marker band (full height of chart area below axis)
      if (gappedWidth > 0) {
        this.markerGraphics.rect(gappedStartX, chartTop, gappedWidth, chartHeight);
        this.markerGraphics.fill({ color, alpha: 1.0 });
      }
    }
  }

  /**
   * Render 2D curtain overlay (dimmed area outside the viewport lens).
   * Dims in both X (time) and Y (depth) directions.
   *
   * IMPORTANT: The curtain covers only the CHART AREA (below the axis).
   * The axis area (Y=0 to Y=axisHeight) is NOT dimmed to keep labels crisp.
   * This prevents the 50% opacity curtain from making axis labels appear dull.
   */
  private render2DCurtain(
    manager: MinimapManager,
    selection: Readonly<MinimapSelection>,
    minimapHeight: number,
  ): void {
    const state = manager.getState();

    // Axis is at TOP - chart area is below it
    // When heat strip has data, curtain ends above the heat strip (it's separate)
    const axisHeight = this.axisRenderer.getHeight();
    const chartTop = axisHeight;
    const chartBottom = manager.getChartBottom();
    const chartHeight = chartBottom - chartTop;

    // Calculate lens X bounds (time)
    const lensX1 = manager.timeToMinimapX(selection.startTime);
    const lensX2 = manager.timeToMinimapX(selection.endTime);

    // Calculate lens Y bounds (depth)
    // depthToMinimapY returns Y in [axisHeight, minimapHeight] with inverted depth
    // depthStart (shallower) → larger Y (closer to bottom of chart)
    // depthEnd (deeper) → smaller Y (closer to top of chart, just below axis)
    const lensY1 = manager.depthToMinimapY(selection.depthEnd); // Top of lens (deeper = closer to axis)
    const lensY2 = manager.depthToMinimapY(selection.depthStart); // Bottom of lens (shallower = closer to bottom)

    // Clamp lens Y to chart area (not into axis area at top)
    const clampedLensY1 = Math.max(chartTop, Math.min(chartBottom, lensY1));
    const clampedLensY2 = Math.max(chartTop, Math.min(chartBottom, lensY2));

    // Draw 4 curtain regions (L-shaped around the lens window)
    // Curtain covers ONLY the chart area (Y=axisHeight to Y=chartBottom)
    // Axis area (Y=0 to Y=axisHeight) is NOT covered to keep labels crisp

    // Left curtain (chart area only, excludes axis)
    if (lensX1 > 0) {
      this.curtainGraphics.rect(0, chartTop, lensX1, chartHeight);
      this.curtainGraphics.fill({ color: this.colors.curtain, alpha: CURTAIN_OPACITY });
    }

    // Right curtain (chart area only, excludes axis)
    if (lensX2 < state.displayWidth) {
      this.curtainGraphics.rect(lensX2, chartTop, state.displayWidth - lensX2, chartHeight);
      this.curtainGraphics.fill({ color: this.colors.curtain, alpha: CURTAIN_OPACITY });
    }

    // Top curtain (between left and right curtains, from top of chart area to top of lens)
    // Note: This now starts at chartTop (axisHeight), not 0
    if (clampedLensY1 > chartTop) {
      this.curtainGraphics.rect(lensX1, chartTop, lensX2 - lensX1, clampedLensY1 - chartTop);
      this.curtainGraphics.fill({ color: this.colors.curtain, alpha: CURTAIN_OPACITY });
    }

    // Bottom curtain (between left and right curtains, below lens to bottom of chart area)
    if (clampedLensY2 < chartBottom) {
      this.curtainGraphics.rect(
        lensX1,
        clampedLensY2,
        lensX2 - lensX1,
        chartBottom - clampedLensY2,
      );
      this.curtainGraphics.fill({ color: this.colors.curtain, alpha: CURTAIN_OPACITY });
    }
  }

  /**
   * Render viewport lens borders (rectangular window).
   */
  private renderLens(
    manager: MinimapManager,
    selection: Readonly<MinimapSelection>,
    minimapHeight: number,
  ): void {
    // Axis is at TOP - chart area is below it
    // When heat strip has data, lens ends above the heat strip (it's separate)
    const axisHeight = this.axisRenderer.getHeight();
    const chartTop = axisHeight;
    const chartBottom = manager.getChartBottom();

    // Calculate lens bounds
    const lensX1 = manager.timeToMinimapX(selection.startTime);
    const lensX2 = manager.timeToMinimapX(selection.endTime);

    // depthToMinimapY returns Y in [axisHeight, minimapHeight] with inverted depth
    // depthStart (shallower) → larger Y, depthEnd (deeper) → smaller Y
    const lensY1 = manager.depthToMinimapY(selection.depthEnd); // Top of lens
    const lensY2 = manager.depthToMinimapY(selection.depthStart); // Bottom of lens

    // Clamp lens Y to chart area (not into axis at top)
    const clampedLensY1 = Math.max(chartTop, Math.min(chartBottom, lensY1));
    const clampedLensY2 = Math.max(chartTop, Math.min(chartBottom, lensY2));

    const lensWidth = lensX2 - lensX1;
    const lensHeight = clampedLensY2 - clampedLensY1;

    // Left edge handle
    this.lensGraphics.rect(
      lensX1 - EDGE_HANDLE_WIDTH / 2,
      clampedLensY1,
      EDGE_HANDLE_WIDTH,
      lensHeight,
    );
    this.lensGraphics.fill({ color: this.colors.lensBorder, alpha: 0.8 });

    // Right edge handle
    this.lensGraphics.rect(
      lensX2 - EDGE_HANDLE_WIDTH / 2,
      clampedLensY1,
      EDGE_HANDLE_WIDTH,
      lensHeight,
    );
    this.lensGraphics.fill({ color: this.colors.lensBorder, alpha: 0.8 });

    // Top border
    this.lensGraphics.rect(lensX1, clampedLensY1, lensWidth, 1);
    this.lensGraphics.fill({ color: this.colors.lensBorder, alpha: 0.5 });

    // Bottom border
    this.lensGraphics.rect(lensX1, clampedLensY2 - 1, lensWidth, 1);
    this.lensGraphics.fill({ color: this.colors.lensBorder, alpha: 0.5 });
  }

  /**
   * Render cursor mirror line.
   */
  private renderCursorLine(
    manager: MinimapManager,
    cursorTimeNs: number,
    minimapHeight: number,
  ): void {
    const x = manager.timeToMinimapX(cursorTimeNs);

    // Axis is at TOP - cursor spans chart area below it
    const axisHeight = this.axisRenderer.getHeight();
    const chartTop = axisHeight;
    const chartHeight = minimapHeight - axisHeight;

    this.cursorLineGraphics.rect(
      x - CURSOR_LINE_WIDTH / 2,
      chartTop,
      CURSOR_LINE_WIDTH,
      chartHeight,
    );
    this.cursorLineGraphics.fill({ color: CURSOR_LINE_COLOR, alpha: CURSOR_LINE_OPACITY });
  }

  /**
   * Extract colors from CSS variables.
   */
  private extractColors(): MinimapColors {
    const computedStyle = getComputedStyle(document.documentElement);

    // Curtain - slightly lighter than background for visibility
    const curtainStr =
      computedStyle.getPropertyValue('--vscode-editorWidget-background').trim() || '#252526';

    // Lens border - use focus/selection color
    const borderStr = computedStyle.getPropertyValue('--vscode-focusBorder').trim() || '#007fd4';

    return {
      curtain: this.parseColorToHex(curtainStr),
      lensBorder: this.parseColorToHex(borderStr),
      edgeHandle: this.parseColorToHex(borderStr),
    };
  }

  /**
   * Parse CSS color string to numeric hex (RGB only).
   */
  private parseColorToHex(cssColor: string): number {
    if (!cssColor) {
      return 0x1e1e1e; // Default dark
    }

    if (cssColor.startsWith('#')) {
      const hex = cssColor.slice(1);
      if (hex.length === 6) {
        return parseInt(hex, 16);
      }
      if (hex.length === 3) {
        const r = hex[0]!;
        const g = hex[1]!;
        const b = hex[2]!;
        return parseInt(r + r + g + g + b + b, 16);
      }
    }

    // rgba() fallback
    const rgba = cssColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)/);
    if (rgba) {
      const r = parseInt(rgba[1]!, 10);
      const g = parseInt(rgba[2]!, 10);
      const b = parseInt(rgba[3]!, 10);
      return (r << 16) | (g << 8) | b;
    }

    return 0x1e1e1e; // Default dark
  }

  /**
   * Refresh colors from CSS variables (e.g., after VS Code theme change).
   * Also invalidates static content to trigger re-render with new colors.
   */
  public refreshColors(): void {
    this.colors = this.extractColors();

    // Refresh axis renderer colors
    this.axisRenderer.refreshColors();

    this.invalidateStatic();
  }

  /**
   * Clear all graphics.
   */
  public clear(): void {
    this.backgroundGraphics.clear();
    this.markerGraphics.clear();
    this.curtainGraphics.clear();
    this.lensGraphics.clear();
    this.cursorLineGraphics.clear();
    this.axisRenderer.clear();
    // Clear skyline mesh by setting draw count to 0
    this.skylineBarGeometry.setDrawCount(0);
  }

  /**
   * Destroy renderer and cleanup resources.
   */
  public destroy(): void {
    // Destroy static content
    this.backgroundGraphics.destroy();
    this.skylineMesh.destroy();
    this.skylineBarGeometry.destroy();
    this.markerGraphics.destroy();
    this.axisRenderer.destroy();
    this.heatStripRenderer.destroy();
    this.staticContainer.destroy();

    if (this.staticTexture) {
      this.staticTexture.destroy(true);
      this.staticTexture = null;
    }

    if (this.staticSprite) {
      this.staticSprite.destroy();
      this.staticSprite = null;
    }

    // Destroy dynamic content
    this.curtainGraphics.destroy();
    this.lensGraphics.destroy();
    this.cursorLineGraphics.destroy();
    this.dynamicContainer.destroy();

    // Remove HTML labels
    this.labelElement.remove();
    this.heatStripTooltipElement.remove();

    // Destroy main container
    this.container.destroy();
  }
}
