/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * MeasurementOrchestrator
 *
 * Orchestrates measurement (Shift+drag) and area zoom (Alt+drag) functionality.
 * Owns measurement state, renderers, and resize handling.
 *
 * Responsibilities:
 * - Measurement lifecycle (start, update, end, clear)
 * - Area zoom lifecycle (start, update, end)
 * - Measurement edge resize (drag existing edge)
 * - Coordinate transform (screenX to time)
 *
 * Communication pattern:
 * - Uses callbacks to notify FlameChart of viewport changes
 * - Receives ViewportState as read-only input
 * - Never mutates viewport directly
 */

import * as PIXI from 'pixi.js';
import type { ViewportState } from '../../types/flamechart.types.js';
import { AreaZoomRenderer } from '../measurement/AreaZoomRenderer.js';
import { MeasurementState, type MeasurementSnapshot } from '../measurement/MeasurementState.js';
import { MeasureRangeRenderer } from '../measurement/MeasureRangeRenderer.js';
import type { TimelineViewport } from '../TimelineViewport.js';

// Re-export MeasurementSnapshot for convenience
export type { MeasurementSnapshot };

/**
 * Callbacks for measurement orchestrator events.
 */
export interface MeasurementOrchestratorCallbacks {
  /**
   * Called when the viewport should zoom to a specific time range.
   * Used for area zoom and zoom-to-measurement.
   *
   * @param startTime - Start time in nanoseconds
   * @param duration - Duration in nanoseconds
   * @param middleDepth - Depth for vertical centering
   */
  onZoomToRange: (startTime: number, duration: number, middleDepth: number) => void;

  /**
   * Called when measurement state changes.
   * Used for external state tracking (e.g., tooltip updates).
   *
   * @param measurement - Current measurement state, or null if cleared
   */
  onMeasurementChange: (measurement: MeasurementSnapshot | null) => void;

  /**
   * Called when a re-render is needed.
   */
  requestRender: () => void;

  /**
   * Called when search should be cleared.
   * Measurement and search highlights conflict visually.
   */
  onClearSearch: () => void;
}

/**
 * Context for rendering measurement overlays.
 */
export interface MeasurementRenderContext {
  /** Current viewport state */
  viewportState: ViewportState;
}

export class MeasurementOrchestrator {
  // ============================================================================
  // MEASUREMENT COMPONENTS
  // ============================================================================
  private measurementState: MeasurementState | null = null;
  private measurementRenderer: MeasureRangeRenderer | null = null;

  // ============================================================================
  // AREA ZOOM COMPONENTS
  // ============================================================================
  private areaZoomState: MeasurementState | null = null;
  private areaZoomRenderer: AreaZoomRenderer | null = null;

  // ============================================================================
  // RESIZE STATE
  // ============================================================================
  private resizeEdge: 'left' | 'right' | null = null;
  private resizeAnchorTime: number | null = null;

  // ============================================================================
  // EXTERNAL REFERENCES (not owned)
  // ============================================================================
  private viewport: TimelineViewport | null = null;
  private totalDuration: number = 0;
  private maxDepth: number = 0;

  private callbacks: MeasurementOrchestratorCallbacks;

  constructor(callbacks: MeasurementOrchestratorCallbacks) {
    this.callbacks = callbacks;
  }

  // ============================================================================
  // LIFECYCLE
  // ============================================================================

  /**
   * Initialize the measurement system.
   *
   * @param worldContainer - PixiJS container for renderers
   * @param htmlContainer - HTML container for labels
   * @param viewport - Main timeline viewport (for reading state only)
   * @param totalDuration - Total timeline duration in nanoseconds
   * @param maxDepth - Maximum depth in the timeline
   */
  public init(
    worldContainer: PIXI.Container,
    htmlContainer: HTMLElement,
    viewport: TimelineViewport,
    totalDuration: number,
    maxDepth: number,
    measureColors?: {
      selectionBackground: number;
      selectionHighlightBorder: number;
      focusBorder: number;
    },
  ): void {
    this.viewport = viewport;
    this.totalDuration = totalDuration;
    this.maxDepth = maxDepth;

    // Initialize measurement system
    this.measurementState = new MeasurementState();
    this.measurementRenderer = new MeasureRangeRenderer(
      worldContainer,
      htmlContainer,
      () => this.zoomToMeasurement(),
      measureColors,
    );

    // Initialize area zoom system
    this.areaZoomState = new MeasurementState();
    this.areaZoomRenderer = new AreaZoomRenderer(worldContainer, htmlContainer);
  }

  /**
   * Clean up all measurement resources.
   */
  public destroy(): void {
    if (this.measurementRenderer) {
      this.measurementRenderer.destroy();
      this.measurementRenderer = null;
    }
    this.measurementState = null;

    if (this.areaZoomRenderer) {
      this.areaZoomRenderer.destroy();
      this.areaZoomRenderer = null;
    }
    this.areaZoomState = null;

    this.resizeEdge = null;
    this.resizeAnchorTime = null;
    this.viewport = null;
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  /**
   * Check if there is an active or finished measurement.
   */
  public hasMeasurement(): boolean {
    return this.measurementState?.hasMeasurement() ?? false;
  }

  /**
   * Get the current measurement state.
   */
  public getMeasurementSnapshot(): MeasurementSnapshot | null {
    return this.measurementState?.getState() ?? null;
  }

  /**
   * Clear the current measurement.
   */
  public clearMeasurement(): void {
    if (!this.measurementState?.hasMeasurement()) {
      return;
    }

    this.measurementState.clear();
    this.measurementRenderer?.clear();

    this.callbacks.onMeasurementChange(null);
    this.callbacks.requestRender();
  }

  /**
   * Zoom to fit the current measurement range.
   */
  public zoomToMeasurement(): void {
    if (!this.measurementState?.hasMeasurement()) {
      return;
    }

    const measurement = this.measurementState.getState();
    if (!measurement) {
      return;
    }

    const middleDepth = Math.floor(this.maxDepth / 2);
    this.callbacks.onZoomToRange(
      measurement.startTime,
      measurement.endTime - measurement.startTime,
      middleDepth,
    );
  }

  /**
   * Check if screenX is near a measurement resize edge.
   *
   * @param screenX - Screen X coordinate
   * @returns 'left' or 'right' if near an edge, null otherwise
   */
  public getMeasurementResizeEdge(screenX: number): 'left' | 'right' | null {
    if (!this.measurementState?.hasMeasurement() || !this.viewport) {
      return null;
    }

    const measurement = this.measurementState.getState();
    if (!measurement || measurement.isActive) {
      // Only finished measurements can be resized
      return null;
    }

    const viewportState = this.viewport.getState();
    const screenStartX = measurement.startTime * viewportState.zoom - viewportState.offsetX;
    const screenEndX = measurement.endTime * viewportState.zoom - viewportState.offsetX;

    const threshold = 8; // px
    if (Math.abs(screenX - screenStartX) <= threshold) {
      return 'left';
    }
    if (Math.abs(screenX - screenEndX) <= threshold) {
      return 'right';
    }
    return null;
  }

  /**
   * Check if a click is inside the measurement area.
   *
   * @param screenX - Screen X coordinate
   * @returns true if inside measurement
   */
  public isInsideMeasurement(screenX: number): boolean {
    if (!this.measurementState?.hasMeasurement() || !this.viewport) {
      return false;
    }

    const measurement = this.measurementState.getState();
    if (!measurement) {
      return false;
    }

    const clickTime = this.screenXToTime(screenX);
    return clickTime >= measurement.startTime && clickTime <= measurement.endTime;
  }

  // ============================================================================
  // MEASUREMENT HANDLERS
  // ============================================================================

  /**
   * Handle measurement start (Shift+drag began).
   *
   * @param screenX - Screen X coordinate
   */
  public handleMeasureStart(screenX: number): void {
    if (!this.measurementState) {
      return;
    }

    // DON'T clear selection - measurement and selection can coexist
    // DON'T clear search - search and measurement can coexist

    // Start measurement - clamp to timeline bounds
    const timeNs = this.screenXToTime(screenX);
    const clampedTime = Math.max(0, Math.min(this.totalDuration, timeNs));
    this.measurementState.start(clampedTime);

    this.callbacks.onMeasurementChange(this.measurementState.getState());
    this.callbacks.requestRender();
  }

  /**
   * Handle measurement update (Shift+drag continuing).
   *
   * @param screenX - Screen X coordinate
   */
  public handleMeasureUpdate(screenX: number): void {
    if (!this.measurementState) {
      return;
    }

    const timeNs = this.screenXToTime(screenX);
    const clampedTime = Math.max(0, Math.min(this.totalDuration, timeNs));
    this.measurementState.update(clampedTime);

    this.callbacks.onMeasurementChange(this.measurementState.getState());
    this.callbacks.requestRender();
  }

  /**
   * Handle measurement end (mouse released).
   */
  public handleMeasureEnd(): void {
    if (!this.measurementState) {
      return;
    }

    this.measurementState.finish();

    this.callbacks.onMeasurementChange(this.measurementState.getState());
    this.callbacks.requestRender();
  }

  // ============================================================================
  // AREA ZOOM HANDLERS
  // ============================================================================

  /**
   * Handle area zoom start (Alt+drag began).
   *
   * @param screenX - Screen X coordinate
   */
  public handleAreaZoomStart(screenX: number): void {
    if (!this.areaZoomState) {
      return;
    }

    // Clear measurement when starting area zoom
    this.clearMeasurement();

    // Start area zoom - clamp to timeline bounds
    const timeNs = this.screenXToTime(screenX);
    const clampedTime = Math.max(0, Math.min(this.totalDuration, timeNs));
    this.areaZoomState.start(clampedTime);

    this.callbacks.requestRender();
  }

  /**
   * Handle area zoom update (Alt+drag continuing).
   *
   * @param screenX - Screen X coordinate
   */
  public handleAreaZoomUpdate(screenX: number): void {
    if (!this.areaZoomState) {
      return;
    }

    const timeNs = this.screenXToTime(screenX);
    const clampedTime = Math.max(0, Math.min(this.totalDuration, timeNs));
    this.areaZoomState.update(clampedTime);

    this.callbacks.requestRender();
  }

  /**
   * Handle area zoom end (mouse released).
   */
  public handleAreaZoomEnd(): void {
    if (!this.areaZoomState) {
      this.clearAreaZoom();
      return;
    }

    const state = this.areaZoomState.getState();
    if (state && state.endTime - state.startTime > 0) {
      const middleDepth = Math.floor(this.maxDepth / 2);
      this.callbacks.onZoomToRange(state.startTime, state.endTime - state.startTime, middleDepth);
    }

    this.clearAreaZoom();
  }

  /**
   * Clear the area zoom overlay.
   */
  public clearAreaZoom(): void {
    if (!this.areaZoomState) {
      return;
    }

    this.areaZoomState.clear();
    this.areaZoomRenderer?.clear();

    this.callbacks.requestRender();
  }

  // ============================================================================
  // RESIZE HANDLERS
  // ============================================================================

  /**
   * Handle resize start (click on measurement edge).
   *
   * @param _screenX - Screen X coordinate (unused)
   * @param edge - Which edge is being resized
   */
  public handleResizeStart(_screenX: number, edge: 'left' | 'right'): void {
    if (!this.measurementState) {
      return;
    }

    const measurement = this.measurementState.getState();
    if (!measurement) {
      return;
    }

    this.resizeEdge = edge;
    // Store the anchor (the edge NOT being dragged)
    this.resizeAnchorTime = edge === 'left' ? measurement.endTime : measurement.startTime;

    this.callbacks.requestRender();
  }

  /**
   * Handle resize update (dragging measurement edge).
   *
   * @param screenX - Screen X coordinate
   */
  public handleResizeUpdate(screenX: number): void {
    if (!this.measurementState || this.resizeAnchorTime === null) {
      return;
    }

    const timeNs = this.screenXToTime(screenX);
    const clampedTime = Math.max(0, Math.min(this.totalDuration, timeNs));

    // Update measurement using anchor
    this.measurementState.setEdges(clampedTime, this.resizeAnchorTime);

    this.callbacks.onMeasurementChange(this.measurementState.getState());
    this.callbacks.requestRender();
  }

  /**
   * Handle resize end (mouse released after dragging edge).
   */
  public handleResizeEnd(): void {
    this.resizeEdge = null;
    this.resizeAnchorTime = null;

    this.callbacks.onMeasurementChange(this.measurementState?.getState() ?? null);
    this.callbacks.requestRender();
  }

  // ============================================================================
  // RENDER
  // ============================================================================

  /**
   * Render measurement and area zoom overlays.
   *
   * @param context - Render context with viewport state
   */
  public render(context: MeasurementRenderContext): void {
    // Render measurement overlay
    if (this.measurementRenderer && this.measurementState) {
      this.measurementRenderer.render(context.viewportState, this.measurementState.getState());
    }

    // Render area zoom overlay
    if (this.areaZoomRenderer && this.areaZoomState) {
      this.areaZoomRenderer.render(context.viewportState, this.areaZoomState.getState());
    }
  }

  /**
   * Update measurement colors (e.g., after theme change).
   *
   * @param selectionBackground - Fill color (0xRRGGBB)
   * @param borderColor - Border color (0xRRGGBB)
   */
  public setColors(selectionBackground: number, borderColor: number): void {
    this.measurementRenderer?.setColors(selectionBackground, borderColor);
  }

  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================

  /**
   * Convert screen X coordinate to timeline time in nanoseconds.
   */
  private screenXToTime(screenX: number): number {
    if (!this.viewport) {
      return 0;
    }
    const viewportState = this.viewport.getState();
    return (screenX + viewportState.offsetX) / viewportState.zoom;
  }
}
