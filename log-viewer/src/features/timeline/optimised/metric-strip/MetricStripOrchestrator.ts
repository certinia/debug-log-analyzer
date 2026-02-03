/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * MetricStripOrchestrator
 *
 * Orchestrates all metric strip functionality for the FlameChart.
 * Composes MetricStripManager, MetricStripRenderer, and MetricStripTooltipRenderer.
 *
 * Responsibilities:
 * - Metric strip lifecycle (init, destroy, resize)
 * - Hover interactions (show/hide tooltip)
 * - Click interactions (zoom to region)
 * - Cursor line synchronization with main timeline
 * - Viewport sync (X-axis locked to main timeline)
 *
 * Communication pattern:
 * - Uses callbacks to notify FlameChart of changes
 * - Receives ViewportState as read-only input
 * - Never mutates viewport directly
 */

import * as PIXI from 'pixi.js';
import type {
  HeatStripTimeSeries,
  TimelineMarker,
  ViewportState,
} from '../../types/flamechart.types.js';
import { MetricStripManager } from './MetricStripManager.js';
import { MetricStripRenderer } from './MetricStripRenderer.js';
import { MetricStripTooltipRenderer } from './MetricStripTooltipRenderer.js';
import {
  getMetricStripColors,
  METRIC_STRIP_GAP,
  METRIC_STRIP_HEIGHT,
} from './metric-strip-colors.js';

// Re-export for convenience
export { METRIC_STRIP_GAP, METRIC_STRIP_HEIGHT };

/**
 * Callbacks for metric strip orchestrator events.
 */
export interface MetricStripOrchestratorCallbacks {
  /**
   * Called when user clicks on the metric strip to zoom to a region.
   * FlameChart should update the main viewport.
   *
   * @param centerTimeNs - Center time of the zoom region
   * @param durationNs - Duration of the zoom region
   */
  onZoomToRegion: (centerTimeNs: number, durationNs: number) => void;

  /**
   * Called when the cursor position changes.
   * FlameChart should update cursor line rendering.
   *
   * @param timeNs - Cursor time in nanoseconds, or null to hide
   */
  onCursorMove: (timeNs: number | null) => void;

  /**
   * Called when metric strip needs a re-render.
   */
  requestRender: () => void;

  /**
   * Called when wheel zoom is applied at a cursor position.
   *
   * @param factor - Zoom factor (< 1 = zoom out, > 1 = zoom in)
   * @param anchorTimeNs - Time position to anchor the zoom
   */
  onZoom?: (factor: number, anchorTimeNs: number) => void;

  /**
   * Called when horizontal pan is requested via wheel.
   *
   * @param deltaPixels - Horizontal pan delta in pixels
   */
  onHorizontalPan?: (deltaPixels: number) => void;

  /**
   * Called when view should be reset to full timeline.
   */
  onResetView?: () => void;

  /**
   * Called when vertical (depth) pan is requested.
   *
   * @param deltaY - Vertical pan delta in pixels
   */
  onDepthPan?: (deltaY: number) => void;
}

/**
 * Context for rendering the metric strip.
 */
export interface MetricStripRenderContext {
  /** Current viewport state from main timeline */
  viewportState: ViewportState;
  /** Total timeline duration in nanoseconds */
  totalDuration: number;
  /** Current cursor position in nanoseconds (null to hide) */
  cursorTimeNs: number | null;
  /** Timeline markers for background rendering (error/skip/unexpected regions) */
  markers?: TimelineMarker[];
}

export class MetricStripOrchestrator {
  // ============================================================================
  // PIXI RESOURCES
  // ============================================================================
  private app: PIXI.Application | null = null;
  private container: PIXI.Container | null = null;
  private htmlContainer: HTMLElement | null = null;

  // ============================================================================
  // METRIC STRIP COMPONENTS
  // ============================================================================
  private manager: MetricStripManager | null = null;
  private renderer: MetricStripRenderer | null = null;
  private tooltipRenderer: MetricStripTooltipRenderer | null = null;

  // ============================================================================
  // CURSOR LINE RENDERING
  // ============================================================================
  private cursorLineGraphics: PIXI.Graphics | null = null;

  // ============================================================================
  // STATE
  // ============================================================================
  private cursorTimeNs: number | null = null;
  private isMouseInMetricStrip = false;
  private mouseX = 0;
  private mouseY = 0;
  private isDarkTheme = true;
  private totalDuration = 0;
  private callbacks: MetricStripOrchestratorCallbacks;
  /** Last viewport state received during render (for wheel handler). */
  private lastViewportState: ViewportState | null = null;

  constructor(callbacks: MetricStripOrchestratorCallbacks) {
    this.callbacks = callbacks;
  }

  // ============================================================================
  // LIFECYCLE
  // ============================================================================

  /**
   * Initialize the metric strip system.
   *
   * @param metricStripDiv - HTML element to render metric strip into
   * @param width - Canvas width
   * @param totalDuration - Total timeline duration in nanoseconds
   */
  public async init(
    metricStripDiv: HTMLElement,
    width: number,
    totalDuration: number,
  ): Promise<void> {
    this.htmlContainer = metricStripDiv;
    this.totalDuration = totalDuration;

    // Create PIXI Application for metric strip
    this.app = new PIXI.Application();
    await this.app.init({
      width,
      height: METRIC_STRIP_HEIGHT,
      antialias: true, // Smooth lines
      backgroundAlpha: 0,
      resolution: window.devicePixelRatio || 1,
      roundPixels: true,
      autoDensity: true,
      autoStart: false,
    });
    this.app.ticker.stop();
    this.app.stage.eventMode = 'none';
    metricStripDiv.appendChild(this.app.canvas);

    // Create main container
    this.container = new PIXI.Container();
    this.app.stage.addChild(this.container);

    // Initialize manager
    this.manager = new MetricStripManager();
    this.manager.setTheme(this.isDarkTheme);

    // Initialize renderer
    this.renderer = new MetricStripRenderer();
    this.renderer.setTheme(this.isDarkTheme);
    this.renderer.setHeight(METRIC_STRIP_HEIGHT);

    // Add renderer graphics to container
    for (const graphics of this.renderer.getGraphics()) {
      this.container.addChild(graphics);
    }

    // Initialize cursor line graphics (on top of everything)
    this.cursorLineGraphics = new PIXI.Graphics();
    this.container.addChild(this.cursorLineGraphics);

    // Initialize tooltip renderer
    this.tooltipRenderer = new MetricStripTooltipRenderer(metricStripDiv);
    this.tooltipRenderer.setTheme(this.isDarkTheme);

    // Setup interaction handler
    this.setupInteractionHandler();
  }

  /**
   * Clean up all metric strip resources.
   */
  public destroy(): void {
    // Remove event listeners
    if (this.app?.canvas) {
      const canvas = this.app.canvas as HTMLCanvasElement;
      canvas.removeEventListener('mouseenter', this.handleMouseEnter);
      canvas.removeEventListener('mouseleave', this.handleMouseLeave);
      canvas.removeEventListener('mousemove', this.handleMouseMove);
      canvas.removeEventListener('click', this.handleClick);
      canvas.removeEventListener('wheel', this.handleWheel);
      canvas.removeEventListener('dblclick', this.handleDoubleClick);
    }

    if (this.tooltipRenderer) {
      this.tooltipRenderer.destroy();
      this.tooltipRenderer = null;
    }

    if (this.renderer) {
      this.renderer.destroy();
      this.renderer = null;
    }

    if (this.cursorLineGraphics) {
      this.cursorLineGraphics.destroy();
      this.cursorLineGraphics = null;
    }

    this.manager = null;
    this.container = null;

    if (this.app) {
      this.app.destroy(true, { children: true, texture: true });
      this.app = null;
    }

    this.htmlContainer = null;
  }

  /**
   * Handle resize of the metric strip container.
   *
   * @param newWidth - New canvas width
   */
  public resize(newWidth: number): void {
    if (this.app) {
      this.app.renderer.resize(newWidth, METRIC_STRIP_HEIGHT);
    }
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  /**
   * Set time series data for the metric strip.
   *
   * @param timeSeries - Heat strip time series data
   */
  public setTimeSeries(timeSeries: HeatStripTimeSeries | null): void {
    if (!this.manager) {
      return;
    }

    if (timeSeries) {
      this.manager.processData(timeSeries);
    }

    this.callbacks.requestRender();
  }

  /**
   * Check if there's data to render.
   */
  public hasData(): boolean {
    return this.manager?.hasData() ?? false;
  }

  /**
   * Set the theme for the metric strip.
   *
   * @param isDark - Whether dark theme is active
   */
  public setTheme(isDark: boolean): void {
    this.isDarkTheme = isDark;
    this.manager?.setTheme(isDark);
    this.renderer?.setTheme(isDark);
    this.tooltipRenderer?.setTheme(isDark);
    this.callbacks.requestRender();
  }

  /**
   * Get the current cursor time position.
   */
  public getCursorTimeNs(): number | null {
    return this.cursorTimeNs;
  }

  /**
   * Set cursor position from main timeline hover.
   *
   * @param timeNs - Cursor time in nanoseconds, or null to clear
   */
  public setCursorFromMainTimeline(timeNs: number | null): void {
    this.cursorTimeNs = timeNs;
    this.callbacks.requestRender();
  }

  /**
   * Check if mouse is currently in the metric strip area.
   */
  public isMouseInMetricStripArea(): boolean {
    return this.isMouseInMetricStrip;
  }

  /**
   * Get the PIXI Application.
   */
  public getApp(): PIXI.Application | null {
    return this.app;
  }

  /**
   * Get the metric strip height.
   */
  public getHeight(): number {
    return METRIC_STRIP_HEIGHT;
  }

  // ============================================================================
  // RENDER
  // ============================================================================

  /**
   * Render the metric strip.
   *
   * @param context - Render context with viewport state
   */
  public render(context: MetricStripRenderContext): void {
    if (!this.app || !this.renderer || !this.manager) {
      return;
    }

    // Cache viewport state for wheel handler
    this.lastViewportState = context.viewportState;

    const data = this.manager.getData();

    // Set dynamic Y-max based on data
    const effectiveYMax = this.manager.getEffectiveYMax();
    this.renderer.setEffectiveYMax(effectiveYMax);

    // Render the step chart with markers
    this.renderer.render(
      data ?? { points: [], classifiedMetrics: [], globalMaxPercent: 0, hasData: false },
      context.viewportState,
      context.totalDuration,
      context.markers,
    );

    // Render cursor line
    this.renderCursorLine(context.viewportState, context.cursorTimeNs);

    // Render the PIXI app
    this.app.render();
  }

  /**
   * Render the cursor line.
   */
  private renderCursorLine(viewportState: ViewportState, cursorTimeNs: number | null): void {
    if (!this.cursorLineGraphics) {
      return;
    }

    this.cursorLineGraphics.clear();

    if (cursorTimeNs === null) {
      return;
    }

    const colors = getMetricStripColors(this.isDarkTheme);
    const x = cursorTimeNs * viewportState.zoom - viewportState.offsetX;

    // Only draw if within visible area
    if (x >= 0 && x <= viewportState.displayWidth) {
      this.cursorLineGraphics.rect(x - 0.5, 0, 1, METRIC_STRIP_HEIGHT);
      this.cursorLineGraphics.fill({ color: colors.labelText, alpha: 0.6 });
    }
  }

  // ============================================================================
  // INTERACTION HANDLING
  // ============================================================================

  /**
   * Setup interaction handler for mouse events.
   */
  private setupInteractionHandler(): void {
    if (!this.app?.canvas) {
      return;
    }

    const canvas = this.app.canvas as HTMLCanvasElement;

    // Bind event handlers to preserve `this` context
    this.handleMouseEnter = this.handleMouseEnter.bind(this);
    this.handleMouseLeave = this.handleMouseLeave.bind(this);
    this.handleMouseMove = this.handleMouseMove.bind(this);
    this.handleClick = this.handleClick.bind(this);
    this.handleWheel = this.handleWheel.bind(this);
    this.handleDoubleClick = this.handleDoubleClick.bind(this);

    canvas.addEventListener('mouseenter', this.handleMouseEnter);
    canvas.addEventListener('mouseleave', this.handleMouseLeave);
    canvas.addEventListener('mousemove', this.handleMouseMove);
    canvas.addEventListener('click', this.handleClick);
    canvas.addEventListener('wheel', this.handleWheel, { passive: false });
    canvas.addEventListener('dblclick', this.handleDoubleClick);
  }

  private handleMouseEnter = (): void => {
    this.isMouseInMetricStrip = true;
  };

  private handleMouseLeave = (): void => {
    this.isMouseInMetricStrip = false;
    this.cursorTimeNs = null;
    this.callbacks.onCursorMove(null);
    this.tooltipRenderer?.hide();
    this.callbacks.requestRender();
  };

  private handleMouseMove = (event: MouseEvent): void => {
    if (!this.app?.canvas || !this.manager || !this.lastViewportState) {
      return;
    }

    const canvas = this.app.canvas as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    this.mouseX = event.clientX - rect.left;
    this.mouseY = event.clientY - rect.top;

    // Update cursor position using stored viewport state
    const timeNs = (this.mouseX + this.lastViewportState.offsetX) / this.lastViewportState.zoom;
    const clampedTimeNs = Math.max(0, Math.min(this.totalDuration, timeNs));

    this.cursorTimeNs = clampedTimeNs;
    this.callbacks.onCursorMove(clampedTimeNs);

    // Update tooltip
    const dataPoint = this.manager.getDataPointAtTime(clampedTimeNs);
    if (dataPoint) {
      this.tooltipRenderer?.show(
        this.mouseX,
        this.mouseY,
        dataPoint.point,
        this.manager.getClassifiedMetrics(),
      );
    } else {
      this.tooltipRenderer?.hide();
    }

    this.callbacks.requestRender();
  };

  private handleClick = (event: MouseEvent): void => {
    if (!this.app?.canvas || !this.lastViewportState) {
      return;
    }

    const canvas = this.app.canvas as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    const clickX = event.clientX - rect.left;

    // Process pan immediately using stored viewport state
    const clickTimeNs = (clickX + this.lastViewportState.offsetX) / this.lastViewportState.zoom;

    // Keep current zoom level, just center on clicked time
    const visibleDuration = this.lastViewportState.displayWidth / this.lastViewportState.zoom;

    this.callbacks.onZoomToRegion(clickTimeNs, visibleDuration);
  };

  private handleWheel = (event: WheelEvent): void => {
    event.preventDefault();

    // Horizontal scroll → pan
    if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
      this.callbacks.onHorizontalPan?.(event.deltaX);
      this.callbacks.requestRender();
      return;
    }

    // Vertical scroll → zoom at cursor position
    // Normalize wheel delta (match TimelineInteractionHandler behavior)
    let normalizedDelta = -event.deltaY;
    if (event.deltaMode === 1) {
      normalizedDelta *= 15; // Lines mode
    }
    const zoomFactor = 1 + normalizedDelta * 0.001;
    const timeNs = this.screenXToTime(event.offsetX);
    if (timeNs !== null) {
      this.callbacks.onZoom?.(zoomFactor, timeNs);
      this.callbacks.requestRender();
    }
  };

  private handleDoubleClick = (): void => {
    this.callbacks.onResetView?.();
  };

  /**
   * Convert screen X coordinate to time using cached viewport state.
   * Returns null if no viewport state is available.
   */
  private screenXToTime(screenX: number): number | null {
    if (!this.lastViewportState) {
      return null;
    }
    // Convert screen X to time using viewport zoom and offset
    const timeNs = (screenX + this.lastViewportState.offsetX) / this.lastViewportState.zoom;
    return Math.max(0, Math.min(this.totalDuration, timeNs));
  }
}
