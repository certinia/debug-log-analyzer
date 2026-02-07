/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * SelectionHighlightRenderer
 *
 * Rendering layer for selection highlight using PixiJS Graphics.
 * Draws an orange highlight around the selected frame or marker with viewport culling.
 *
 * Uses shared HighlightRenderer for consistent styling with SearchHighlightRenderer.
 * Selection highlight looks identical to search match highlight.
 *
 * Supports two selection types:
 * - Frame selection: highlight around a specific event rectangle
 * - Marker selection: full-height highlight for timeline markers
 */

import * as PIXI from 'pixi.js';
import type {
  EventNode,
  TimelineMarker,
  TreeNode,
  ViewportState,
} from '../../types/flamechart.types.js';
import { TIMELINE_CONSTANTS } from '../../types/flamechart.types.js';
import {
  extractHighlightColors,
  MIN_HIGHLIGHT_WIDTH,
  renderHighlight,
  type HighlightColors,
} from '../rendering/HighlightRenderer.js';

/**
 * Culling bounds derived from viewport.
 */
interface CullingBounds {
  /** Start time in nanoseconds */
  timeStart: number;
  /** End time in nanoseconds */
  timeEnd: number;
  /** Start depth (0-indexed) */
  depthStart: number;
  /** End depth (0-indexed) */
  depthEnd: number;
}

/**
 * SelectionHighlightRenderer
 *
 * Renders selection highlight as an orange overlay + border around the selected frame or marker.
 * Uses two Graphics layers:
 * - Frame highlight: zIndex 3 (renders on top of frames)
 * - Marker highlight: zIndex -1 (renders behind frames/buckets)
 * Styling is identical to search match highlight via shared HighlightRenderer.
 */
export class SelectionHighlightRenderer {
  /** Graphics for frame selection highlight (renders on top of frames) */
  private frameGraphics: PIXI.Graphics;

  /** Graphics for marker selection highlight (renders behind frames) */
  private markerGraphics: PIXI.Graphics;

  /** All markers for duration calculation */
  private markers: TimelineMarker[] = [];

  /** Timeline end time for last marker duration calculation */
  private timelineEnd = 0;

  /** Highlight colors extracted from CSS variables (same as search) */
  private colors: HighlightColors;

  /**
   * @param container - PixiJS container to add graphics to (worldContainer)
   */
  constructor(container: PIXI.Container) {
    // Frame highlight graphics - renders on top of frames
    this.frameGraphics = new PIXI.Graphics();
    this.frameGraphics.zIndex = 3;
    container.addChild(this.frameGraphics);

    // Marker highlight graphics - renders behind frames/buckets
    this.markerGraphics = new PIXI.Graphics();
    this.markerGraphics.zIndex = -1;
    container.addChild(this.markerGraphics);

    // Extract colors from shared utility (same colors as search highlight)
    this.colors = extractHighlightColors();
  }

  /**
   * Set markers array and timeline parameters for marker selection.
   * Required for calculating marker duration.
   *
   * @param markers - Array of timeline markers (sorted by startTime)
   * @param timelineEnd - End time of timeline in nanoseconds
   */
  public setMarkerContext(markers: TimelineMarker[], timelineEnd: number): void {
    this.markers = markers;
    this.timelineEnd = timelineEnd;
  }

  /**
   * Render the selection highlight (frame or marker).
   * This renderer is stateless - selection state is passed in from SelectionManager.
   *
   * @param viewport - Viewport state for culling and transforms
   * @param selectedNode - Currently selected frame node, or null
   * @param selectedMarker - Currently selected marker, or null
   */
  public render(
    viewport: ViewportState,
    selectedNode: TreeNode<EventNode> | null,
    selectedMarker: TimelineMarker | null,
  ): void {
    // Clear both graphics
    this.frameGraphics.clear();
    this.markerGraphics.clear();

    // Render marker selection if present (uses markerGraphics - behind frames)
    if (selectedMarker) {
      this.renderMarkerHighlight(viewport, selectedMarker);
      return;
    }

    // Render frame selection if present (uses frameGraphics - on top of frames)
    if (!selectedNode) {
      return;
    }

    const bounds = this.calculateBounds(viewport);
    const event = selectedNode.data;
    const depth = selectedNode.depth ?? 0;

    // Check visibility
    if (!this.isVisible(event, depth, bounds)) {
      return;
    }

    // Use shared highlight rendering logic (same styling as search highlight)
    renderHighlight(
      this.frameGraphics,
      event.timestamp,
      event.duration,
      depth,
      viewport,
      this.colors,
    );
  }

  /**
   * Render marker selection highlight.
   * Markers render as full-height vertical bands that cover the entire viewport height.
   *
   * @param viewport - Viewport state for transforms
   * @param selectedMarker - The marker to highlight
   */
  private renderMarkerHighlight(viewport: ViewportState, selectedMarker: TimelineMarker): void {
    // Calculate marker duration (extends to next marker or timeline end)
    const markerIndex = this.markers.findIndex((m) => m.id === selectedMarker.id);
    const nextMarker = this.markers[markerIndex + 1];
    const markerEnd = nextMarker?.startTime ?? this.timelineEnd;
    const duration = markerEnd - selectedMarker.startTime;

    // Calculate screen position
    const screenX = selectedMarker.startTime * viewport.zoom;
    const screenWidth = duration * viewport.zoom;

    // Full height to cover entire visible viewport regardless of vertical pan position
    // Account for offsetY so marker selection stays fixed on screen when panning
    // The worldContainer has scale.y = -1 and position based on offsetY
    // Visible world Y range is approximately [-offsetY, displayHeight - offsetY]
    // Add buffer to extend beyond visible area
    const buffer = viewport.displayHeight;
    const screenY = -viewport.offsetY - buffer;
    const screenHeight = viewport.displayHeight + buffer * 2;

    // Enforce minimum visible width for narrow markers
    const visibleWidth = Math.max(screenWidth, MIN_HIGHLIGHT_WIDTH);

    // Calculate event center and center the highlight
    const eventCenterX = screenX + screenWidth / 2;
    const centeredX = screenWidth < MIN_HIGHLIGHT_WIDTH ? eventCenterX - visibleWidth / 2 : screenX;
    const finalWidth = screenWidth < MIN_HIGHLIGHT_WIDTH ? visibleWidth : screenWidth;

    // Draw full-height highlight (uses markerGraphics - renders behind frames)
    this.markerGraphics.rect(centeredX, screenY, finalWidth, screenHeight);

    if (screenWidth < MIN_HIGHLIGHT_WIDTH) {
      // Narrow marker: more opaque fill for visibility
      this.markerGraphics.fill({ color: this.colors.sourceColor, alpha: 0.6 });
    } else {
      // Normal marker: semi-transparent fill + border
      this.markerGraphics.fill({ color: this.colors.sourceColor, alpha: 0.3 });

      // Border at full bounds
      this.markerGraphics.rect(screenX, screenY, screenWidth, screenHeight);
      this.markerGraphics.stroke({
        width: 2,
        color: this.colors.sourceColor,
        alpha: 0.9,
      });
    }
  }

  /**
   * Clear the selection highlight from display.
   */
  public clear(): void {
    this.frameGraphics.clear();
    this.markerGraphics.clear();
  }

  /**
   * Refresh colors from CSS variables (e.g., after VS Code theme change).
   */
  public refreshColors(): void {
    this.colors = extractHighlightColors();
  }

  /**
   * Destroy renderer and cleanup resources.
   */
  public destroy(): void {
    this.frameGraphics.destroy();
    this.markerGraphics.destroy();
  }

  /**
   * Calculate culling bounds from viewport state.
   *
   * @param viewport - Viewport state
   * @returns Culling bounds in timeline coordinates
   */
  private calculateBounds(viewport: ViewportState): CullingBounds {
    const timeStart = viewport.offsetX / viewport.zoom;
    const timeEnd = (viewport.offsetX + viewport.displayWidth) / viewport.zoom;

    // Viewport culling for vertical (depth-based)
    const worldYBottom = -viewport.offsetY;
    const worldYTop = -viewport.offsetY + viewport.displayHeight;

    const EVENT_HEIGHT = TIMELINE_CONSTANTS.EVENT_HEIGHT;
    const depthStart = Math.floor(worldYBottom / EVENT_HEIGHT);
    const depthEnd = Math.floor(worldYTop / EVENT_HEIGHT);

    return { timeStart, timeEnd, depthStart, depthEnd };
  }

  /**
   * Check if event is visible within culling bounds.
   *
   * @param event - Event to test
   * @param depth - Depth of event in tree
   * @param bounds - Culling bounds
   * @returns true if event is visible
   */
  private isVisible(event: EventNode, depth: number, bounds: CullingBounds): boolean {
    const rectTimeStart = event.timestamp;
    const rectTimeEnd = rectTimeStart + event.duration;

    if (rectTimeEnd <= bounds.timeStart || rectTimeStart >= bounds.timeEnd) {
      return false;
    }

    if (depth < bounds.depthStart || depth > bounds.depthEnd) {
      return false;
    }

    return true;
  }
}
