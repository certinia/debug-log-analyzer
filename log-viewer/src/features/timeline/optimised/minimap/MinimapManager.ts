/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * MinimapManager
 *
 * State management and coordinate transforms for the timeline minimap.
 * The minimap shows a condensed overview of the entire timeline with a viewport
 * lens indicating the currently visible region in the main flame chart.
 *
 * Responsibilities:
 * - Maintain minimap dimensions and scale
 * - Coordinate conversions between minimap and timeline
 * - Selection state management (viewport lens position)
 * - Drag mode detection for interaction handling
 */

import type { ViewportState } from '../../types/flamechart.types.js';

/**
 * Minimap configuration state.
 */
export interface MinimapState {
  /** Height of the minimap in pixels (10% of canvas height). */
  height: number;

  /** Total timeline duration in nanoseconds. */
  totalDuration: number;

  /** Maximum call stack depth across the timeline. */
  maxDepth: number;

  /** Pixels per nanosecond (entire timeline fits in displayWidth). */
  scale: number;

  /** Canvas width in pixels. */
  displayWidth: number;

  /** Canvas height in pixels (used for % height calculation). */
  displayHeight: number;
}

/**
 * Viewport lens selection state.
 * Represents the highlighted window showing the main timeline's visible range.
 */
export interface MinimapSelection {
  /** Selection start time in nanoseconds. */
  startTime: number;

  /** Selection end time in nanoseconds. */
  endTime: number;

  /** Visible depth start (topmost visible row in main view). */
  depthStart: number;

  /** Visible depth end (bottommost visible row in main view). */
  depthEnd: number;

  /** Whether user is currently dragging. */
  isDragging: boolean;

  /** Current drag operation mode. */
  dragMode: MinimapDragMode | null;
}

/**
 * Drag mode for minimap interactions.
 */
export type MinimapDragMode = 'create' | 'move' | 'resize-left' | 'resize-right';

/**
 * Edge detection threshold in pixels.
 * Used to detect if cursor is near a lens edge for resize.
 */
const EDGE_THRESHOLD = 8;

/**
 * Minimap height as percentage of canvas height.
 */
const MINIMAP_HEIGHT_PERCENT = 0.1;

/**
 * Minimum minimap height in pixels.
 */
const MINIMAP_MIN_HEIGHT = 60;

/**
 * Maximum minimap height in pixels.
 */
const MINIMAP_MAX_HEIGHT = 120;

/**
 * Gap between minimap and main timeline in pixels.
 * Provides visual separation between the two regions.
 */
export const MINIMAP_GAP = 4;

/**
 * Height of time axis at TOP of minimap in pixels.
 * Must match MinimapAxisRenderer's axisHeight.
 */
const AXIS_HEIGHT = 16;

/**
 * Calculate minimap height based on canvas height.
 * Returns 10% of canvas height, clamped between min and max.
 *
 * @param canvasHeight - Total canvas height in pixels
 * @returns Minimap height in pixels
 */
export function calculateMinimapHeight(canvasHeight: number): number {
  const percentHeight = Math.round(canvasHeight * MINIMAP_HEIGHT_PERCENT);
  return Math.max(MINIMAP_MIN_HEIGHT, Math.min(MINIMAP_MAX_HEIGHT, percentHeight));
}

/**
 * Legacy constant for backwards compatibility.
 * @deprecated Use calculateMinimapHeight() instead for dynamic sizing.
 */
export const MINIMAP_HEIGHT = 80;

export class MinimapManager {
  private state: MinimapState;
  private selection: MinimapSelection;

  constructor(
    totalDuration: number,
    maxDepth: number,
    displayWidth: number,
    displayHeight: number,
  ) {
    // Calculate scale so entire timeline fits in displayWidth
    const scale = displayWidth > 0 ? displayWidth / totalDuration : 1;

    // Calculate dynamic height based on canvas size (10%, clamped)
    const height = calculateMinimapHeight(displayHeight);

    this.state = {
      height,
      totalDuration,
      maxDepth,
      scale,
      displayWidth,
      displayHeight,
    };

    // Initialize selection to full timeline and full depth (no zoom)
    this.selection = {
      startTime: 0,
      endTime: totalDuration,
      depthStart: 0,
      depthEnd: maxDepth,
      isDragging: false,
      dragMode: null,
    };
  }

  // ============================================================================
  // STATE ACCESSORS
  // ============================================================================

  /**
   * Get current minimap state (read-only).
   */
  public getState(): Readonly<MinimapState> {
    return this.state;
  }

  /**
   * Get current selection state (read-only).
   */
  public getSelection(): Readonly<MinimapSelection> {
    return this.selection;
  }

  /**
   * Get minimap height.
   */
  public getHeight(): number {
    return this.state.height;
  }

  /**
   * Get minimap chart area height (excludes axis).
   */
  public getChartHeight(): number {
    return this.state.height - AXIS_HEIGHT;
  }

  // ============================================================================
  // COORDINATE CONVERSIONS
  // ============================================================================

  /**
   * Convert time in nanoseconds to minimap X coordinate.
   *
   * @param timeNs - Time in nanoseconds
   * @returns X coordinate in minimap pixels
   */
  public timeToMinimapX(timeNs: number): number {
    return timeNs * this.state.scale;
  }

  /**
   * Convert minimap X coordinate to time in nanoseconds.
   *
   * @param x - X coordinate in minimap pixels
   * @returns Time in nanoseconds
   */
  public minimapXToTime(x: number): number {
    return x / this.state.scale;
  }

  /**
   * Clamp time to valid timeline bounds.
   *
   * @param timeNs - Time in nanoseconds
   * @returns Clamped time in nanoseconds
   */
  public clampTime(timeNs: number): number {
    return Math.max(0, Math.min(this.state.totalDuration, timeNs));
  }

  /**
   * Convert depth to minimap Y coordinate.
   * Uses INVERTED mapping to match main timeline's coordinate system:
   * - Depth 0 (root frames) maps to BOTTOM of chart area
   * - maxDepth (deepest frames) maps to TOP of chart area (just below axis)
   *
   * The axis is at TOP of minimap (Y=0 to Y=AXIS_HEIGHT).
   * The chart area is from Y=AXIS_HEIGHT to Y=minimapHeight.
   *
   * @param depth - Depth value (0-based)
   * @returns Y coordinate in minimap pixels
   */
  public depthToMinimapY(depth: number): number {
    const chartHeight = this.state.height - AXIS_HEIGHT;
    if (this.state.maxDepth <= 0) {
      return this.state.height; // Return bottom of chart area if no depth info
    }
    const ratio = depth / this.state.maxDepth;
    // Invert: depth 0 → bottom (minimapHeight), maxDepth → top of chart (AXIS_HEIGHT)
    return AXIS_HEIGHT + chartHeight * (1 - ratio);
  }

  /**
   * Convert minimap Y coordinate to depth.
   * Inverse of depthToMinimapY - accounts for inverted Y-axis mapping.
   *
   * Axis area: Y=0 to Y=AXIS_HEIGHT (at TOP).
   * Chart area: Y=AXIS_HEIGHT (top of chart) to Y=minimapHeight (bottom).
   * - Y=AXIS_HEIGHT → maxDepth (deepest)
   * - Y=minimapHeight → depth 0 (root)
   *
   * @param y - Y coordinate in minimap pixels
   * @returns Depth value (0-based)
   */
  public minimapYToDepth(y: number): number {
    const chartHeight = this.state.height - AXIS_HEIGHT;
    if (chartHeight <= 0) {
      return 0;
    }
    // Invert: Y at top of chart (AXIS_HEIGHT) → maxDepth, Y at bottom (minimapHeight) → depth 0
    const yInChart = y - AXIS_HEIGHT;
    const ratio = 1 - yInChart / chartHeight;
    return Math.max(0, Math.min(this.state.maxDepth, ratio * this.state.maxDepth));
  }

  // ============================================================================
  // VIEWPORT SYNC
  // ============================================================================

  /**
   * Update selection to match the main timeline viewport.
   * Called from FlameChart render loop to keep lens in sync.
   *
   * @param viewport - Current main timeline viewport state
   * @param visibleDepthStart - First visible depth row (optional)
   * @param visibleDepthEnd - Last visible depth row (optional)
   */
  public setSelectionFromViewport(
    viewport: ViewportState,
    visibleDepthStart?: number,
    visibleDepthEnd?: number,
  ): void {
    // Calculate visible time range from main viewport
    const visibleTimeStart = viewport.offsetX / viewport.zoom;
    const visibleTimeEnd = (viewport.offsetX + viewport.displayWidth) / viewport.zoom;

    // Update time selection (clamped to timeline bounds)
    this.selection.startTime = this.clampTime(visibleTimeStart);
    this.selection.endTime = this.clampTime(visibleTimeEnd);

    // Update depth selection if provided (clamped to valid depth range)
    if (visibleDepthStart !== undefined && visibleDepthEnd !== undefined) {
      this.selection.depthStart = Math.max(0, Math.min(this.state.maxDepth, visibleDepthStart));
      this.selection.depthEnd = Math.max(0, Math.min(this.state.maxDepth, visibleDepthEnd));
    }
  }

  /**
   * Get the selection as a main viewport-compatible zoom/offset.
   * Used when minimap selection changes need to update main viewport.
   *
   * @param displayWidth - Main viewport display width
   * @returns Zoom and offsetX for main viewport
   */
  public getViewportFromSelection(displayWidth: number): { zoom: number; offsetX: number } {
    const duration = this.selection.endTime - this.selection.startTime;
    const zoom = duration > 0 ? displayWidth / duration : displayWidth / this.state.totalDuration;
    const offsetX = this.selection.startTime * zoom;
    return { zoom, offsetX };
  }

  // ============================================================================
  // SELECTION MANIPULATION
  // ============================================================================

  /**
   * Set selection directly.
   *
   * @param startTime - Selection start in nanoseconds
   * @param endTime - Selection end in nanoseconds
   */
  public setSelection(startTime: number, endTime: number): void {
    // Ensure start < end
    const actualStart = Math.min(startTime, endTime);
    const actualEnd = Math.max(startTime, endTime);

    this.selection.startTime = this.clampTime(actualStart);
    this.selection.endTime = this.clampTime(actualEnd);
  }

  /**
   * Move selection by a delta time, keeping duration constant.
   *
   * @param deltaTimeNs - Time delta in nanoseconds
   */
  public moveSelection(deltaTimeNs: number): void {
    const duration = this.selection.endTime - this.selection.startTime;
    let newStart = this.selection.startTime + deltaTimeNs;

    // Clamp to valid range while maintaining duration
    if (newStart < 0) {
      newStart = 0;
    }
    if (newStart + duration > this.state.totalDuration) {
      newStart = this.state.totalDuration - duration;
    }

    this.selection.startTime = newStart;
    this.selection.endTime = newStart + duration;
  }

  /**
   * Reset selection to full timeline (zoom out completely).
   */
  public resetSelection(): void {
    this.selection.startTime = 0;
    this.selection.endTime = this.state.totalDuration;
    this.selection.depthStart = 0;
    this.selection.depthEnd = this.state.maxDepth;
  }

  // ============================================================================
  // DRAG STATE MANAGEMENT
  // ============================================================================

  /**
   * Start a drag operation.
   *
   * @param mode - Type of drag operation
   */
  public startDrag(mode: MinimapDragMode): void {
    this.selection.isDragging = true;
    this.selection.dragMode = mode;
  }

  /**
   * End the current drag operation.
   */
  public endDrag(): void {
    this.selection.isDragging = false;
    this.selection.dragMode = null;
  }

  /**
   * Check if currently dragging.
   */
  public isDragging(): boolean {
    return this.selection.isDragging;
  }

  /**
   * Get the current drag mode.
   */
  public getDragMode(): MinimapDragMode | null {
    return this.selection.dragMode;
  }

  // ============================================================================
  // DRAG MODE DETECTION
  // ============================================================================

  /**
   * Determine the appropriate drag mode based on cursor position and modifier keys.
   * Uses 8px edge threshold for resize handle detection.
   *
   * Default behavior (no modifiers):
   * - Edge = resize (same as before)
   * - Inside lens = CREATE new selection (changed from 'move')
   * - Outside lens = CREATE new selection
   *
   * With Shift key:
   * - Edge = resize (same)
   * - Inside lens = MOVE viewport
   * - Outside lens = CREATE new selection
   *
   * @param screenX - Screen X coordinate in minimap space
   * @param shiftKey - Whether Shift key is held (enables move mode inside lens)
   * @returns Appropriate drag mode for starting a drag at this position
   */
  public getDragModeForPosition(screenX: number, shiftKey = false): MinimapDragMode {
    const lensStartX = this.timeToMinimapX(this.selection.startTime);
    const lensEndX = this.timeToMinimapX(this.selection.endTime);

    // Check if near left edge (resize-left) - same behavior regardless of modifier
    if (Math.abs(screenX - lensStartX) <= EDGE_THRESHOLD) {
      return 'resize-left';
    }

    // Check if near right edge (resize-right) - same behavior regardless of modifier
    if (Math.abs(screenX - lensEndX) <= EDGE_THRESHOLD) {
      return 'resize-right';
    }

    // Check if inside lens
    if (screenX >= lensStartX && screenX <= lensEndX) {
      // Shift+drag inside lens = move viewport
      // Default drag inside lens = create new selection (like outside lens)
      return shiftKey ? 'move' : 'create';
    }

    // Outside lens = create new selection
    return 'create';
  }

  /**
   * Get cursor style based on position in minimap.
   *
   * @param screenX - Screen X coordinate in minimap space
   * @returns CSS cursor style
   */
  public getCursorForPosition(screenX: number): string {
    const mode = this.getDragModeForPosition(screenX);
    switch (mode) {
      case 'resize-left':
      case 'resize-right':
        return 'ew-resize';
      case 'move':
        return 'grab';
      case 'create':
        return 'crosshair';
      default:
        return 'default';
    }
  }

  // ============================================================================
  // RESIZE HANDLING
  // ============================================================================

  /**
   * Handle resize from left edge.
   * Moves the start time while keeping end time fixed.
   *
   * @param displayWidth - Main viewport display width (for min selection constraint)
   * @param newStartTime - New start time in nanoseconds
   */
  public resizeFromLeft(displayWidth: number, newStartTime: number): void {
    // Ensure minimum selection width (at least 10 pixels worth of time)
    const minDuration = this.minimapXToTime(10);
    const maxStart = this.selection.endTime - minDuration;

    this.selection.startTime = this.clampTime(Math.min(newStartTime, maxStart));
  }

  /**
   * Handle resize from right edge.
   * Moves the end time while keeping start time fixed.
   *
   * @param displayWidth - Main viewport display width (for min selection constraint)
   * @param newEndTime - New end time in nanoseconds
   */
  public resizeFromRight(displayWidth: number, newEndTime: number): void {
    // Ensure minimum selection width (at least 10 pixels worth of time)
    const minDuration = this.minimapXToTime(10);
    const minEnd = this.selection.startTime + minDuration;

    this.selection.endTime = this.clampTime(Math.max(newEndTime, minEnd));
  }

  // ============================================================================
  // DIMENSION UPDATES
  // ============================================================================

  /**
   * Handle resize of the minimap container.
   *
   * @param newWidth - New display width in pixels
   * @param newHeight - New canvas height in pixels (optional, for height recalculation)
   */
  public resize(newWidth: number, newHeight?: number): void {
    this.state.displayWidth = newWidth;
    this.state.scale = newWidth > 0 ? newWidth / this.state.totalDuration : 1;

    // Update height if canvas height changed
    if (newHeight !== undefined) {
      this.state.displayHeight = newHeight;
      this.state.height = calculateMinimapHeight(newHeight);
    }
  }

  /**
   * Update total duration (e.g., when timeline data changes).
   *
   * @param totalDuration - New total duration in nanoseconds
   * @param maxDepth - New maximum depth
   */
  public setTimelineData(totalDuration: number, maxDepth: number): void {
    this.state.totalDuration = totalDuration;
    this.state.maxDepth = maxDepth;
    this.state.scale = this.state.displayWidth > 0 ? this.state.displayWidth / totalDuration : 1;

    // Reset selection to full timeline
    this.resetSelection();
  }
}
