/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

/**
 * TimelineMarkerRenderer
 *
 * Renders marker indicators as vertical bands behind the timeline using PixiJS Sprites.
 * Handles time-range visualization, viewport culling, and severity-based stacking.
 *
 * Performance optimizations:
 * - Uses SpritePool with shared 1x1 white texture for automatic GPU batching
 * - Sprites are pooled and reused (no GC overhead after warmup)
 * - Color applied via sprite.tint (pre-blended opaque colors)
 */

import type { Container } from 'pixi.js';
import type { MarkerType, TimelineMarker } from '../types/flamechart.types.js';
import { MARKER_ALPHA, MARKER_COLORS, SEVERITY_RANK } from '../types/flamechart.types.js';
import { blendWithBackground } from './BucketColorResolver.js';
import { SpritePool } from './SpritePool.js';
import type { TimelineViewport } from './TimelineViewport.js';

/**
 * Pre-blended opaque marker colors (MARKER_COLORS blended at MARKER_ALPHA opacity).
 * Computed once at module load time for performance.
 */
const MARKER_COLORS_BLENDED: Record<MarkerType, number> = {
  error: blendWithBackground(MARKER_COLORS.error, MARKER_ALPHA),
  skip: blendWithBackground(MARKER_COLORS.skip, MARKER_ALPHA),
  unexpected: blendWithBackground(MARKER_COLORS.unexpected, MARKER_ALPHA),
};

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
 * Renders marker indicators as semi-transparent vertical bands using sprites.
 *
 * Architecture:
 * - Uses single SpritePool for efficient rendering
 * - Renders in severity order (skip → unexpected → error) via z-ordering
 * - Culls off-screen indicators for performance
 * - Calculates end times for markers with null endTime
 */
export class TimelineMarkerRenderer {
  private container: Container;
  private viewport: TimelineViewport;
  private markers: readonly TimelineMarker[];
  private spritePool: SpritePool;
  private visibleIndicators: MarkerIndicator[] = [];

  /**
   * Creates a new TimelineMarkerRenderer.
   *
   * @param container - PixiJS container to render into (should be at z-index 0)
   * @param viewport - Viewport manager for coordinate transforms
   * @param markers - Array of markers from parser
   */
  constructor(container: Container, viewport: TimelineViewport, markers: TimelineMarker[]) {
    this.container = container;
    this.viewport = viewport;

    // Sort markers by startTime for efficient end time resolution
    this.markers = [...markers].sort((a, b) => {
      if (a.startTime !== b.startTime) {
        return a.startTime - b.startTime;
      }
      return SEVERITY_RANK[b.type] - SEVERITY_RANK[a.type];
    });

    // Create sprite pool for marker rendering
    this.spritePool = new SpritePool(container);
  }

  /**
   * Renders all visible truncation indicators for current viewport.
   *
   * Algorithm:
   * 1. Cull markers outside viewport
   * 2. Resolve end times with overlap prevention
   * 3. Transform to screen coordinates
   * 4. Render as sprites with tinted colors
   *
   * Overlap behavior:
   * - Higher priority marker takes precedence (error > unexpected > skip)
   * - Same priority: current marker stops at start of next marker
   *
   * Performance: <10ms target for typical logs (<10 markers)
   */
  public render(): void {
    // Release all sprites back to pool
    this.spritePool.releaseAll();

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

      // Create indicator record with pre-blended opaque color
      const indicator: MarkerIndicator = {
        marker,
        resolvedEndTime,
        screenStartX: worldStartX,
        screenEndX: worldEndX,
        screenWidth: worldWidth,
        color: MARKER_COLORS_BLENDED[marker.type],
        isVisible: true,
      };

      this.visibleIndicators.push(indicator);
    }

    // Apply 1px gap for negative space separation between adjacent markers
    const gap = 1;
    const halfGap = gap / 2;
    const viewportState = this.viewport.getState();

    // Draw all indicators as sprites
    for (const indicator of this.visibleIndicators) {
      const sprite = this.spritePool.acquire();

      // Apply gap to create separation between adjacent markers
      const gappedX = indicator.screenStartX + halfGap;
      const gappedWidth = Math.max(0, indicator.screenWidth - gap);

      sprite.position.set(gappedX, 0);
      sprite.width = gappedWidth;
      sprite.height = viewportState.displayHeight;
      sprite.tint = indicator.color;
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
   * Cleans up sprite pool and removes from container.
   * Must be called before discarding the renderer.
   */
  public destroy(): void {
    this.spritePool.destroy();
    this.container.destroy();
  }
}
