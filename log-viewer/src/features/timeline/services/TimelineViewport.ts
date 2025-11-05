/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */

/**
 * TimelineViewport
 *
 * Manages viewport state (zoom, pan, bounds) for timeline visualization.
 * Handles coordinate transformations and boundary constraints.
 */

import type { ViewportBounds, ViewportState } from '../types/timeline.types.js';
import { TIMELINE_CONSTANTS } from '../types/timeline.types.js';

export class TimelineViewport {
  private state: ViewportState;
  private totalDuration: number;
  private maxDepth: number;

  constructor(
    displayWidth: number,
    displayHeight: number,
    totalDuration: number,
    maxDepth: number,
  ) {
    this.totalDuration = totalDuration;
    this.maxDepth = maxDepth;

    // Initialize viewport state with default values
    this.state = {
      zoom: 0,
      offsetX: 0,
      offsetY: 0,
      displayWidth,
      displayHeight,
    };

    // Calculate initial zoom to fit all events
    this.calculateDefaultZoom();
  }

  /**
   * Get current viewport state (read-only).
   */
  public getState(): Readonly<ViewportState> {
    return { ...this.state };
  }

  /**
   * Calculate viewport bounds for culling.
   */
  public getBounds(): ViewportBounds {
    const timeStart = this.state.offsetX / this.state.zoom;
    const timeEnd = (this.state.offsetX + this.state.displayWidth) / this.state.zoom;

    const depthStart = Math.floor(this.state.offsetY / TIMELINE_CONSTANTS.EVENT_HEIGHT);
    const depthEnd = Math.ceil(
      (this.state.offsetY + this.state.displayHeight) / TIMELINE_CONSTANTS.EVENT_HEIGHT,
    );

    return {
      timeStart,
      timeEnd,
      depthStart,
      depthEnd,
    };
  }

  /**
   * Set zoom level with optional anchor point.
   * @param newZoom - New zoom level (pixels per nanosecond)
   * @param anchorX - Screen X coordinate to keep stable (optional)
   * @returns true if zoom changed
   */
  public setZoom(newZoom: number, anchorX?: number): boolean {
    const oldZoom = this.state.zoom;

    // Clamp zoom to valid range
    const minZoom = this.getMinZoom();
    const maxZoom = this.getMaxZoom();
    newZoom = Math.max(minZoom, Math.min(maxZoom, newZoom));

    if (newZoom === oldZoom) {
      return false;
    }

    // Calculate anchor point (default to center)
    const anchor = anchorX ?? this.state.displayWidth / 2;

    // Calculate time at anchor before zoom
    const timeAtAnchor = (anchor + this.state.offsetX) / oldZoom;

    // Update zoom
    this.state.zoom = newZoom;

    // Adjust offsetX to keep anchor point stable
    const newOffsetX = timeAtAnchor * newZoom - anchor;
    this.state.offsetX = this.clampOffsetX(newOffsetX);

    return true;
  }

  /**
   * Set pan offsets with boundary constraints.
   * @param offsetX - Horizontal offset in pixels
   * @param offsetY - Vertical offset in pixels
   * @returns true if pan changed
   */
  public setPan(offsetX: number, offsetY: number): boolean {
    const oldOffsetX = this.state.offsetX;
    const oldOffsetY = this.state.offsetY;

    this.state.offsetX = this.clampOffsetX(offsetX);
    this.state.offsetY = this.clampOffsetY(offsetY);

    return this.state.offsetX !== oldOffsetX || this.state.offsetY !== oldOffsetY;
  }

  /**
   * Update pan by delta (for drag operations).
   * @param deltaX - Change in X offset
   * @param deltaY - Change in Y offset
   * @returns true if pan changed
   */
  public panBy(deltaX: number, deltaY: number): boolean {
    return this.setPan(this.state.offsetX + deltaX, this.state.offsetY + deltaY);
  }

  /**
   * Handle window resize - update display dimensions and preserve zoom/pan.
   * @param newWidth - New canvas width
   * @param newHeight - New canvas height
   */
  public resize(newWidth: number, newHeight: number): void {
    if (newWidth === this.state.displayWidth && newHeight === this.state.displayHeight) {
      return;
    }

    this.state.displayWidth = newWidth;
    this.state.displayHeight = newHeight;

    // Recalculate default zoom (min zoom level)
    const oldMinZoom = this.getMinZoom();
    this.calculateDefaultZoom();
    const newMinZoom = this.getMinZoom();

    // Adjust current zoom if it was at the old minimum
    if (Math.abs(this.state.zoom - oldMinZoom) < 0.0001) {
      this.state.zoom = newMinZoom;
    } else {
      // Clamp zoom to new valid range
      this.state.zoom = Math.max(newMinZoom, Math.min(this.getMaxZoom(), this.state.zoom));
    }

    // Reclamp offsets with new dimensions
    this.state.offsetX = this.clampOffsetX(this.state.offsetX);
    this.state.offsetY = this.clampOffsetY(this.state.offsetY);
  }

  /**
   * Set viewport state directly for resize operations.
   * This bypasses normal clamping to allow preserving visible content during resize.
   * @param zoom - New zoom level
   * @param offsetX - New horizontal offset
   * @param offsetY - New vertical offset
   */
  public setStateForResize(zoom: number, offsetX: number, offsetY: number): void {
    // Don't clamp zoom - allow any zoom level to preserve visible content
    this.state.zoom = zoom;

    // Clamp offsets to prevent going out of bounds
    this.state.offsetX = this.clampOffsetX(offsetX);
    this.state.offsetY = this.clampOffsetY(offsetY);
  }

  /**
   * Reset to default view (zoom out to show all events).
   */
  public reset(): void {
    this.calculateDefaultZoom();
    this.state.offsetX = 0;
    this.state.offsetY = 0;
  }

  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================

  /**
   * Calculate default zoom level (fit all events in viewport).
   */
  private calculateDefaultZoom(): void {
    if (this.totalDuration > 0 && this.state.displayWidth > 0) {
      this.state.zoom = this.state.displayWidth / this.totalDuration;
    } else {
      this.state.zoom = 0.001; // Fallback
    }
  }

  /**
   * Get minimum zoom level (all events visible).
   */
  private getMinZoom(): number {
    if (this.totalDuration > 0 && this.state.displayWidth > 0) {
      return this.state.displayWidth / this.totalDuration;
    }
    return 0.0001;
  }

  /**
   * Get maximum zoom level (0.001ms precision).
   */
  private getMaxZoom(): number {
    if (this.state.displayWidth > 0) {
      return this.state.displayWidth / TIMELINE_CONSTANTS.MAX_ZOOM_NS;
    }
    return 0.3; // Fallback
  }

  /**
   * Clamp horizontal offset to valid range.
   */
  private clampOffsetX(offsetX: number): number {
    const minOffset = 0;
    const maxOffset = Math.max(0, this.state.zoom * this.totalDuration - this.state.displayWidth);
    return Math.max(minOffset, Math.min(maxOffset, offsetX));
  }

  /**
   * Clamp vertical offset to valid range.
   */
  private clampOffsetY(offsetY: number): number {
    const realHeight = TIMELINE_CONSTANTS.EVENT_HEIGHT * this.maxDepth;
    const maxVertOffset = realHeight - this.state.displayHeight + this.state.displayHeight / 4;

    // Allow scrolling up to see top of deep stacks, but not beyond bottom
    const minOffset = -Math.max(0, maxVertOffset);
    const maxOffset = 0;

    return Math.max(minOffset, Math.min(maxOffset, offsetY));
  }

  /**
   * Convert screen Y coordinate to depth level.
   */
  public screenYToDepth(screenY: number): number {
    const y = this.state.displayHeight - screenY - this.state.offsetY;
    const realHeight = TIMELINE_CONSTANTS.EVENT_HEIGHT * this.maxDepth;
    return Math.floor((y / realHeight) * this.maxDepth);
  }

  /**
   * Convert depth level to screen Y coordinate.
   */
  public depthToScreenY(depth: number): number {
    const realHeight = TIMELINE_CONSTANTS.EVENT_HEIGHT * this.maxDepth;
    const y = (depth / this.maxDepth) * realHeight;
    return this.state.displayHeight - this.state.offsetY - y;
  }
}
