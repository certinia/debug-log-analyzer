/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

/**
 * TimelineMarkerRenderer
 *
 * Renders marker indicators as vertical bands behind the timeline.
 * Handles time-range visualization, viewport culling, and severity-based stacking.
 */

import * as PIXI from 'pixi.js';
import type { MarkerType, TimelineMarker } from '../types/flamechart.types.js';
import {
  MARKER_ALPHA,
  MARKER_COLORS,
  SEVERITY_ORDER,
  SEVERITY_RANK,
} from '../types/flamechart.types.js';
import type { TimelineViewport } from './TimelineViewport.js';

/**
 * Internal representation of a marker indicator's visual state.
 */
interface MarkerIndicator {
  marker: TimelineMarker;
  resolvedEndTime: number;
  screenStartX: number;
  screenEndX: number;
  screenWidth: number;
  color: number;
  isVisible: boolean;
}

/**
 * Renders marker indicators as semi-transparent vertical bands.
 *
 * Architecture:
 * - Creates 3 Graphics objects (one per severity level) for proper z-index stacking
 * - Renders in SEVERITY_ORDER (skip → unexpected → error) so error appears on top
 * - Culls off-screen indicators for performance
 * - Calculates end times for markers with null endTime
 */
export class TimelineMarkerRenderer {
  private container: PIXI.Container;
  private viewport: TimelineViewport;
  private markers: readonly TimelineMarker[];
  private graphicsBySeverity: Map<MarkerType, PIXI.Graphics> = new Map();
  private visibleIndicators: MarkerIndicator[] = [];

  /**
   * Creates a new TimelineMarkerRenderer.
   *
   * @param container - PixiJS container to render into (should be at z-index 0)
   * @param viewport - Viewport manager for coordinate transforms
   * @param markers - Array of markers from parser
   */
  constructor(container: PIXI.Container, viewport: TimelineViewport, markers: TimelineMarker[]) {
    this.container = container;
    this.viewport = viewport;

    // Sort markers by startTime for efficient end time resolution
    this.markers = [...markers].sort((a, b) => {
      if (a.startTime !== b.startTime) {
        return a.startTime - b.startTime;
      }
      return SEVERITY_RANK[b.type] - SEVERITY_RANK[a.type];
    });

    this.initialize();
  }

  /**
   * Initializes Graphics objects for each severity level.
   * Creates in SEVERITY_ORDER so error renders last (on top).
   */
  private initialize(): void {
    // Import constants at runtime to avoid circular dependency
    for (const type of SEVERITY_ORDER) {
      const graphics = new PIXI.Graphics();
      this.graphicsBySeverity.set(type, graphics);
      this.container.addChild(graphics);
    }
  }

  /**
   * Renders all visible truncation indicators for current viewport.
   *
   * Algorithm:
   * 1. Cull markers outside viewport
   * 2. Resolve end times with overlap prevention
   * 3. Transform to screen coordinates
   * 4. Group by type and draw rectangles
   *
   * Overlap behavior:
   * - Higher priority marker takes precedence (error > unexpected > skip)
   * - Same priority: current marker stops at start of next marker
   *
   * Performance: <10ms target for typical logs (<10 markers)
   */
  public render(): void {
    // Clear all Graphics objects
    for (const graphics of this.graphicsBySeverity.values()) {
      graphics.clear();
    }

    // Early exit if no markers
    if (this.markers.length === 0) {
      this.visibleIndicators = [];
      return;
    }

    // Get viewport bounds for culling
    const bounds = this.viewport.getBounds();
    const timelineEndTime = bounds.timeEnd; // Use viewport end as timeline end

    // Process all markers (typically <10 for typical logs)
    this.visibleIndicators = [];

    for (let i = 0; i < this.markers.length; i++) {
      const marker = this.markers[i];
      if (!marker) {
        continue;
      }

      const nextMarker = this.markers[i + 1];
      const resolvedEndTime = nextMarker?.startTime ?? timelineEndTime;

      // T009: Viewport culling - skip markers outside visible time range
      // Marker is visible if it overlaps [bounds.timeStart, bounds.timeEnd]
      if (resolvedEndTime < bounds.timeStart || marker.startTime > bounds.timeEnd) {
        continue;
      }

      // T010: Transform to world coordinates for rendering
      // World coordinates = time * zoom (no offset - container handles transform)
      const viewportState = this.viewport.getState();
      const worldStartX = marker.startTime * viewportState.zoom;
      const worldEndX = resolvedEndTime * viewportState.zoom;
      const worldWidth = worldEndX - worldStartX;

      // Skip if width is too small (less than 1 pixel)
      if (worldWidth < 1) {
        continue;
      }

      // Create indicator record
      const indicator: MarkerIndicator = {
        marker,
        resolvedEndTime,
        screenStartX: worldStartX,
        screenEndX: worldEndX,
        screenWidth: worldWidth,
        color: MARKER_COLORS[marker.type],
        isVisible: true,
      };

      this.visibleIndicators.push(indicator);
    }

    // T010: Draw rectangles - no overlaps now, all markers can be drawn
    for (const graphics of this.graphicsBySeverity.values()) {
      graphics.clear();
    }

    // Draw all indicators (overlap prevention already handled above)
    // Apply 1px gap for negative space separation between adjacent markers
    const gap = 1;
    const halfGap = gap / 2;

    for (const indicator of this.visibleIndicators) {
      const graphics = this.graphicsBySeverity.get(indicator.marker.type);
      if (!graphics) {
        continue;
      }

      // Draw vertical band spanning full viewport height with negative space
      const viewportState = this.viewport.getState();
      graphics.setFillStyle({
        color: indicator.color,
        alpha: MARKER_ALPHA,
      });

      // Apply gap to create separation between adjacent markers
      const gappedX = indicator.screenStartX + halfGap;
      const gappedWidth = Math.max(0, indicator.screenWidth - gap);

      graphics.rect(
        gappedX,
        0, // Start at top of timeline
        gappedWidth,
        viewportState.displayHeight, // Span full height
      );
      graphics.fill();
    }
  }

  /**
   * Tests if a screen coordinate intersects any indicator.
   *
   * Used for hover detection. Returns marker with highest severity when multiple overlap.
   *
   * Algorithm:
   * 1. Convert screen coordinates to world coordinates (account for container pan)
   * 2. Iterate through visibleIndicators (already culled during render)
   * 3. Check AABB collision: worldX falls within [worldStartX, worldEndX]
   * 4. Sort matches by severity rank (error > unexpected > skip)
   * 5. Return highest priority marker, or null if no hits
   *
   * @param screenX - Mouse X coordinate in pixels (canvas-relative)
   * @param _screenY - Mouse Y coordinate in pixels (unused - indicators span full height)
   * @returns Marker under cursor (highest severity if multiple), or null if no hit
   */
  public hitTest(screenX: number, _screenY: number): TimelineMarker | null {
    // Convert screen coordinates to world coordinates
    // Container is positioned at -offsetX, so add offsetX to convert screen to world
    const viewportState = this.viewport.getState();
    const worldX = screenX + viewportState.offsetX;

    // Collect all indicators under cursor
    const hits: TimelineMarker[] = [];

    for (const indicator of this.visibleIndicators) {
      // AABB collision test: check if world X coordinate falls within indicator bounds
      if (worldX >= indicator.screenStartX && worldX <= indicator.screenEndX) {
        hits.push(indicator.marker);
      }
    }

    // No hits
    if (hits.length === 0) {
      return null;
    }

    // Single hit - return immediately
    if (hits.length === 1) {
      return hits[0]!;
    }

    // Multiple hits - return highest severity
    hits.sort((a, b) => SEVERITY_RANK[b.type] - SEVERITY_RANK[a.type]);
    return hits[0]!;
  }

  /**
   * Updates the markers and triggers re-render.
   *
   * @param markers - New array of markers
   */
  public updateMarkers(markers: readonly TimelineMarker[]): void {
    (this.markers as TimelineMarker[]) = [...markers].sort((a, b) => a.startTime - b.startTime);
    this.visibleIndicators = [];
  }

  /**
   * Cleans up GPU resources and removes from container.
   * Must be called before discarding the renderer.
   */
  public destroy(): void {
    for (const graphics of this.graphicsBySeverity.values()) {
      graphics.destroy();
    }
    this.container.destroy();
  }
}
