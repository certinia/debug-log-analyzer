/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * MetricStripOrchestrator
 *
 * Orchestrates all metric strip functionality for the FlameChart.
 * Composes MetricTierClassifier, MetricStripRenderer, and MetricStripTooltipRenderer.
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

import { destroyTimelineApp } from '../rendering/pixiApp.js';
import { formatTimeRange } from '../../../../core/utility/Util.js';
import type {
  HeatStripTimeSeries,
  TimelineMarker,
  ViewportState,
} from '../../types/flamechart.types.js';
import { noDataSpanAt } from '../markers/MarkerProcessor.js';
import { MeshAxisRenderer } from '../time-axis/MeshAxisRenderer.js';
import { wheelZoomFactor } from '../ViewportUtils.js';
import { MetricStripRenderer } from './MetricStripRenderer.js';
import { MetricStripTooltipRenderer } from './MetricStripTooltipRenderer.js';
import { MetricTierClassifier } from './MetricTierClassifier.js';
import { isOverChevron } from './strip-pointer.js';
import {
  getMetricStripColors,
  METRIC_STRIP_COLLAPSED_HEIGHT,
  METRIC_STRIP_GAP,
  METRIC_STRIP_HEIGHT,
  METRIC_STRIP_TIME_GRID_COLOR,
  METRIC_STRIP_TIME_GRID_OPACITY,
  METRIC_STRIP_TOGGLE_WIDTH,
} from './metric-strip-colors.js';

// Re-export for convenience
export { METRIC_STRIP_COLLAPSED_HEIGHT, METRIC_STRIP_GAP, METRIC_STRIP_HEIGHT };

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
   * Called when metric strip needs a re-render (full render including culling).
   */
  requestRender: () => void;

  /**
   * Called when only cursor-related rendering is needed (~1ms vs ~10ms).
   * Use for cursor moves that don't change viewport.
   */
  requestCursorRender: () => void;

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

  /**
   * Called when the metric strip height changes (collapse/expand).
   * FlameChart should recalculate layout.
   *
   * @param newHeight - New height in pixels
   */
  onHeightChange: (newHeight: number) => void;
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
  private classifier: MetricTierClassifier | null = null;
  private renderer: MetricStripRenderer | null = null;
  private tooltipRenderer: MetricStripTooltipRenderer | null = null;
  private axisRenderer: MeshAxisRenderer | null = null;

  // ============================================================================
  // CURSOR LINE RENDERING
  // ============================================================================
  private cursorLineGraphics: PIXI.Graphics | null = null;

  // ============================================================================
  // STATE
  // ============================================================================
  private cursorTimeNs: number | null = null;
  /** Whether the strip holds the pointer, its gaps included. */
  private isHoverEngaged = false;
  /** The boxes the pointer is heard in: the strip, and the gap either side of it. */
  private pointerTargets: HTMLElement[] = [];
  private totalDuration = 0;
  private callbacks: MetricStripOrchestratorCallbacks;
  /** Last viewport state received during render (for wheel handler). */
  private lastViewportState: ViewportState | null = null;
  /** Whether the metric strip is collapsed. */
  private isCollapsed = true;

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
   * @param gapDivs - The gap boxes either side of the strip that its hover survives into
   */
  public async init(
    metricStripDiv: HTMLElement,
    width: number,
    totalDuration: number,
    gapDivs: (HTMLElement | null)[] = [],
  ): Promise<void> {
    this.htmlContainer = metricStripDiv;
    this.totalDuration = totalDuration;

    // Create PIXI Application for metric strip (starts collapsed)
    this.app = new PIXI.Application();
    await this.app.init({
      width,
      height: METRIC_STRIP_COLLAPSED_HEIGHT,
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
    this.classifier = new MetricTierClassifier();

    // Initialize axis renderer for grid lines (rendered first, behind other content)
    this.axisRenderer = new MeshAxisRenderer(this.container, {
      height: METRIC_STRIP_COLLAPSED_HEIGHT,
      lineColor: METRIC_STRIP_TIME_GRID_COLOR,
      textColor: '#808080',
      fontSize: 11,
      minLabelSpacing: 120,
      showLabels: false,
      gridAlpha: METRIC_STRIP_TIME_GRID_OPACITY,
    });

    // Initialize renderer (starts collapsed)
    this.renderer = new MetricStripRenderer();
    this.renderer.setHeight(METRIC_STRIP_COLLAPSED_HEIGHT);
    this.renderer.setCollapsed(true);

    // Add renderer graphics to main container (in render order)
    for (const graphics of this.renderer.getGraphics()) {
      this.container.addChild(graphics);
    }

    // Initialize cursor line graphics (on top of everything)
    this.cursorLineGraphics = new PIXI.Graphics();
    this.container.addChild(this.cursorLineGraphics);

    // Initialize tooltip renderer
    this.tooltipRenderer = new MetricStripTooltipRenderer(metricStripDiv);

    this.pointerTargets = [metricStripDiv, ...gapDivs].filter(
      (div): div is HTMLElement => div !== null,
    );

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
      canvas.removeEventListener('click', this.handleClick);
      canvas.removeEventListener('wheel', this.handleWheel);
      canvas.removeEventListener('dblclick', this.handleDoubleClick);
    }

    for (const target of this.pointerTargets) {
      target.removeEventListener('mousemove', this.handleMouseMove);
      target.removeEventListener('mouseleave', this.handleTargetLeave);
    }
    this.pointerTargets = [];

    if (this.tooltipRenderer) {
      this.tooltipRenderer.destroy();
      this.tooltipRenderer = null;
    }

    if (this.renderer) {
      this.renderer.destroy();
      this.renderer = null;
    }

    if (this.axisRenderer) {
      this.axisRenderer.destroy();
      this.axisRenderer = null;
    }

    if (this.cursorLineGraphics) {
      this.cursorLineGraphics.destroy();
      this.cursorLineGraphics = null;
    }

    this.classifier = null;
    this.container = null;

    if (this.app) {
      destroyTimelineApp(this.app);
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
      this.app.renderer.resize(newWidth, this.getHeight());
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
    if (!this.classifier) {
      return;
    }

    if (timeSeries) {
      this.classifier.processData(timeSeries);
    }

    this.callbacks.requestRender();
  }

  /**
   * Set the toggle chevron colors after a host theme change.
   *
   * @param color - Resting icon color (0xRRGGBB)
   * @param hoverColor - Icon color while the toggle is hovered (0xRRGGBB)
   */
  public setToggleIconColors(color: number, hoverColor: number): void {
    this.renderer?.setToggleIconColors(color, hoverColor);
    this.callbacks.requestRender();
  }

  /**
   * Check if there's data to render.
   */
  public hasData(): boolean {
    return this.classifier?.hasData() ?? false;
  }

  /**
   * Check if the metric strip should be visible.
   * Returns true if there's data to display.
   */
  public getIsVisible(): boolean {
    return this.hasData();
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
    this.callbacks.requestCursorRender();
  }

  /**
   * Whether the strip holds the pointer's hover, its gaps included.
   *
   * A hidden strip holds nothing: it can be hidden without a pointer move, so no mouse leave
   * is guaranteed to have released it.
   */
  public holdsHover(): boolean {
    return this.isHoverEngaged && this.getIsVisible();
  }

  /**
   * Get the PIXI Application.
   */
  public getApp(): PIXI.Application | null {
    return this.app;
  }

  /**
   * Get the metric strip height based on collapse state.
   *
   * @returns Height in pixels (METRIC_STRIP_COLLAPSED_HEIGHT or METRIC_STRIP_HEIGHT)
   */
  public getHeight(): number {
    return this.isCollapsed ? METRIC_STRIP_COLLAPSED_HEIGHT : METRIC_STRIP_HEIGHT;
  }

  /**
   * Check if the metric strip is collapsed.
   *
   * @returns True if collapsed (compact heat-style view), false if expanded (step chart)
   */
  public getIsCollapsed(): boolean {
    return this.isCollapsed;
  }

  /**
   * Toggle the collapsed state of the metric strip.
   * Updates PIXI renderer size and notifies FlameChart via onHeightChange callback.
   */
  public toggleCollapsed(): void {
    this.isCollapsed = !this.isCollapsed;

    // Resize the PIXI application to match new height
    const newHeight = this.getHeight();
    if (this.app) {
      this.app.renderer.resize(this.app.renderer.width, newHeight);
    }

    // Update renderer height and collapsed state
    this.renderer?.setHeight(newHeight);
    this.renderer?.setCollapsed(this.isCollapsed);

    // The host sizes the container for the new height and draws as part of that, so asking it
    // to draw again would be a second full render for one click.
    this.callbacks.onHeightChange(newHeight);
  }

  /**
   * Set the collapsed state of the metric strip.
   *
   * @param collapsed - Whether the metric strip should be collapsed
   */
  public setCollapsed(collapsed: boolean): void {
    if (this.isCollapsed !== collapsed) {
      this.toggleCollapsed();
    }
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
    if (!this.app || !this.renderer || !this.classifier) {
      return;
    }

    // Cache viewport state for wheel handler
    this.lastViewportState = context.viewportState;

    // Render time grid lines using shared axis renderer
    if (this.axisRenderer) {
      this.axisRenderer.render(context.viewportState, this.getHeight());
    }

    const data = this.classifier.getData();

    // Set dynamic Y-max based on data
    const effectiveYMax = this.classifier.getEffectiveYMax();
    this.renderer.setEffectiveYMax(effectiveYMax);

    // Render the step chart with markers
    this.renderer.render(
      data ?? { points: [], classifiedMetrics: [], globalMaxPercent: 0, hasData: false, gaps: [] },
      context.viewportState,
      context.totalDuration,
      context.markers,
    );

    // In collapsed mode, render heat-style visualization with actual data
    if (this.isCollapsed && data?.hasData) {
      this.renderer.renderCollapsedWithData(
        context.viewportState,
        (timeNs) => this.classifier?.getDataPointAtTime(timeNs) ?? null,
        context.totalDuration,
      );
    }

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

    const colors = getMetricStripColors();
    const x = cursorTimeNs * viewportState.zoom - viewportState.offsetX;

    // Only draw if within visible area (use dynamic height for collapsed/expanded state)
    if (x >= 0 && x <= viewportState.displayWidth) {
      this.cursorLineGraphics.rect(x - 0.5, 0, 1, this.getHeight());
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

    canvas.addEventListener('click', this.handleClick);
    canvas.addEventListener('wheel', this.handleWheel, { passive: false });
    canvas.addEventListener('dblclick', this.handleDoubleClick);

    // Moves come from the strip and the gaps either side, so the hover survives leaving a
    // 15px canvas without hearing every move over the chart.
    for (const target of this.pointerTargets) {
      target.addEventListener('mousemove', this.handleMouseMove);
      target.addEventListener('mouseleave', this.handleTargetLeave);
    }
  }

  /**
   * Leaving one box is not leaving the band: the strip and its gaps are separate elements,
   * so crossing between them fires a leave the hover has to survive.
   */
  private handleTargetLeave = (event: MouseEvent): void => {
    const to = event.relatedTarget;
    if (to instanceof Node && this.pointerTargets.some((target) => target.contains(to))) {
      return;
    }
    this.releaseHover();
  };

  /**
   * Show one cursor across every box the hover reaches.
   *
   * The gaps hold the hover as much as the strip does, so a cursor set on the canvas alone
   * reverts to an arrow the moment the pointer strays into one.
   */
  private setPointerCursor(cursor: string): void {
    for (const target of this.pointerTargets) {
      target.style.cursor = cursor;
    }
    if (this.app?.canvas) {
      (this.app.canvas as HTMLCanvasElement).style.cursor = cursor;
    }
  }

  /** Give up the hover: no cursor line, no tooltip, no crosshair. */
  private releaseHover(): void {
    if (!this.isHoverEngaged) {
      return;
    }
    this.isHoverEngaged = false;
    this.cursorTimeNs = null;
    this.callbacks.onCursorMove(null);
    this.tooltipRenderer?.hide();
    this.renderer?.setToggleHovered(false);
    this.setPointerCursor('');
    this.callbacks.requestCursorRender();
  }

  private handleMouseMove = (event: MouseEvent): void => {
    if (!this.app?.canvas || !this.classifier || !this.lastViewportState) {
      return;
    }

    if (!this.getIsVisible()) {
      return;
    }

    // The hover starts on the strip and survives into the gap either side. Each of the three
    // boxes has its own listener, so the box that heard the move is the whole test.
    const onStrip = event.currentTarget === this.htmlContainer;
    if (!onStrip && !this.isHoverEngaged) {
      return;
    }
    this.isHoverEngaged = true;

    // The gaps share the strip's left edge and the canvas fills it, so X needs no rect.
    const offsetX = event.offsetX;

    // The arrow, for the tooltip and the glyph highlight. The column around it stays a
    // forgiving click target, so the cursor follows the column, not the arrow.
    const isOverToggle = onStrip && isOverChevron(offsetX, event.offsetY, this.isCollapsed);
    this.renderer?.setToggleHovered(isOverToggle);

    // Crosshair over the data: a click centres it and the wheel zooms it. The toggle column
    // does neither, so it reads as a pointer over its whole width.
    this.setPointerCursor(offsetX < METRIC_STRIP_TOGGLE_WIDTH ? 'pointer' : 'crosshair');

    // Update cursor position using stored viewport state
    const clampedTimeNs = this.screenXToTime(offsetX);
    if (clampedTimeNs === null) {
      return;
    }

    this.cursorTimeNs = clampedTimeNs;
    this.callbacks.onCursorMove(clampedTimeNs);

    // Don't show tooltip when hovering toggle
    if (isOverToggle) {
      this.tooltipRenderer?.hide();
    } else {
      // Update tooltip - position below the metric strip
      const dataPoint = this.classifier.getDataPointAtTime(clampedTimeNs);
      if (dataPoint) {
        const gap = noDataSpanAt(this.classifier.getData()?.gaps, clampedTimeNs);
        this.tooltipRenderer?.setNoDataLabel(
          gap ? `${gap.summary} · ${formatTimeRange(gap.startTime, gap.endTime)}` : null,
        );
        this.tooltipRenderer?.show(
          offsetX,
          event.offsetY,
          dataPoint.point,
          this.classifier.getClassifiedMetrics(),
          this.getHeight(),
        );
      } else {
        this.tooltipRenderer?.hide();
      }
    }

    this.callbacks.requestCursorRender();
  };

  private handleClick = (event: MouseEvent): void => {
    if (!this.app?.canvas || !this.lastViewportState) {
      return;
    }

    // Click on toggle area (left edge) or Shift+click anywhere toggles collapsed state
    if (event.offsetX < METRIC_STRIP_TOGGLE_WIDTH || event.shiftKey) {
      this.toggleCollapsed();
      return;
    }

    // Process pan immediately using stored viewport state
    const clickTimeNs =
      (event.offsetX + this.lastViewportState.offsetX) / this.lastViewportState.zoom;

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

    // Vertical scroll → zoom at cursor position (shared with the main flame
    // chart and minimap wheel handlers for consistent feel).
    const zoomFactor = wheelZoomFactor(event.deltaY, event.deltaMode);
    const timeNs = this.screenXToTime(event.offsetX);
    if (timeNs !== null) {
      this.callbacks.onZoom?.(zoomFactor, timeNs);
      this.callbacks.requestRender();
    }
  };

  private handleDoubleClick = (event: MouseEvent): void => {
    if (!this.app?.canvas) {
      return;
    }

    // Ignore double-clicks on toggle area (left edge)
    if (event.offsetX < METRIC_STRIP_TOGGLE_WIDTH) {
      return;
    }

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
