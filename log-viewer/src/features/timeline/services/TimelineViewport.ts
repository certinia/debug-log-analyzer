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
   *
   * With coordinate system where offsetY <= 0:
   * - offsetY = 0: bottom (depth 0) at bottom of viewport
   * - offsetY < 0: scrolled down to reveal higher depths
   */
  public getBounds(): ViewportBounds {
    const timeStart = this.state.offsetX / this.state.zoom;
    const timeEnd = (this.state.offsetX + this.state.displayWidth) / this.state.zoom;

    // World Y coordinates of visible region
    // With scale.y = -1 flip and container.y = screen.height - offsetY:
    // Screen renders worldY in range [-offsetY, screen.height - offsetY]
    const worldYBottom = -this.state.offsetY; // Visible at screen bottom (lower depths)
    const worldYTop = -this.state.offsetY + this.state.displayHeight; // Visible at screen top (higher depths)

    // Convert to depth levels (depth 0 is at worldY = 0)
    // An event at depth D occupies worldY = [D * HEIGHT, (D+1) * HEIGHT]
    // Use floor for both to include only depths that are at least partially visible
    const depthStart = Math.floor(worldYBottom / TIMELINE_CONSTANTS.EVENT_HEIGHT);
    const depthEnd = Math.floor(worldYTop / TIMELINE_CONSTANTS.EVENT_HEIGHT);

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
   *
   * Vertical offset behavior (worldContainer.y = screen.height - offsetY):
   * - offsetY = 0: Default view (bottom row at bottom of viewport)
   * - offsetY < 0: Scrolled down (negative offset moves content down to reveal top depths)
   * - offsetY > 0: Would scroll up (not allowed - prevents bottom from moving off bottom)
   *
   * Constraints:
   * - Maximum offsetY = 0: Bottom row cannot move up beyond bottom of viewport
   * - Minimum offsetY: Allow scrolling down until top is 4 event heights below top edge (T098)
   */
  private clampOffsetY(offsetY: number): number {
    const realHeight = TIMELINE_CONSTANTS.EVENT_HEIGHT * this.maxDepth;

    // Maximum offset = 0: prevents bottom row from moving off bottom
    const maxOffset = 0;

    // Minimum offset: allow scrolling until top row is 4 EVENT_HEIGHT below top
    // maxVertOffset = how much we can scroll down
    // realHeight - displayHeight = amount content exceeds viewport
    // + 4 * EVENT_HEIGHT = extra padding at top (per clarification 2025-11-07)
    const maxVertOffset = Math.max(
      0,
      realHeight - this.state.displayHeight + 4 * TIMELINE_CONSTANTS.EVENT_HEIGHT,
    );
    const minOffset = -maxVertOffset;

    return Math.max(minOffset, Math.min(maxOffset, offsetY));
  }

  /**
   * Convert screen Y coordinate to depth level.
   *
   * With offsetY <= 0 and worldContainer.y = screen.height - offsetY:
   * - screenY = 0 is top of viewport
   * - screenY = displayHeight is bottom of viewport
   */
  public screenYToDepth(screenY: number): number {
    // World Y visible at bottom of screen (screenY = displayHeight)
    const worldYBottom = -this.state.offsetY;

    // World Y at this screen position
    // screenY increases downward, worldY increases upward
    const worldY = worldYBottom + (this.state.displayHeight - screenY);

    return Math.floor(worldY / TIMELINE_CONSTANTS.EVENT_HEIGHT);
  }

  /**
   * Convert depth level to screen Y coordinate.
   */
  public depthToScreenY(depth: number): number {
    const worldY = depth * TIMELINE_CONSTANTS.EVENT_HEIGHT;
    const worldYBottom = -this.state.offsetY;

    // Screen Y distance from bottom
    return this.state.displayHeight - (worldY - worldYBottom);
  }
}
