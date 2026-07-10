/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
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
 * - Color applied via sprite.tint with true alpha transparency
 */

import type { Container } from 'pixi.js';
import type { TimelineMarker } from '../../types/flamechart.types.js';
import {
  MARKER_ALPHA_BY_TYPE,
  MARKER_BUCKET_PX,
  MARKER_COLORS,
  MARKER_GAP_PX,
  MARKER_MIN_WIDTH_PX,
  SEVERITY_RANK,
} from '../../types/flamechart.types.js';
import { SpritePool } from '../SpritePool.js';
import type { TimelineViewport } from '../TimelineViewport.js';
import { hitTestMarkers, type MarkerIndicator } from './MarkerHitTest.js';
import { layoutMarkerRects } from './MarkerProcessor.js';

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
    const renderState = this.viewport.getState();

    // Process all markers (typically <10 truncation markers; exceptions can be many)
    this.visibleIndicators = [];

    for (let i = 0; i < this.markers.length; i++) {
      const marker = this.markers[i];
      if (!marker) {
        continue;
      }

      // A bounded marker (endTime set) shades its exact range; an unbounded marker is a
      // point at startTime. We no longer extend to the next marker's start.
      const resolvedEndTime = marker.endTime ?? marker.startTime;

      // T009: Viewport culling - skip markers outside visible time range
      // Marker is visible if it overlaps [bounds.timeStart, bounds.timeEnd]
      if (resolvedEndTime < bounds.timeStart || marker.startTime > bounds.timeEnd) {
        continue;
      }

      // T010: Transform to world coordinates for rendering
      // World coordinates = time * zoom (no offset - container handles transform)
      const worldStartX = marker.startTime * renderState.zoom;
      const exactWidth = resolvedEndTime * renderState.zoom - worldStartX;

      // Clamp to a minimum width so markers stay visible when zoomed out.
      const worldWidth = Math.max(exactWidth, MARKER_MIN_WIDTH_PX);

      const indicator: MarkerIndicator = {
        marker,
        resolvedEndTime,
        screenStartX: worldStartX,
        screenEndX: worldStartX + worldWidth,
        screenWidth: worldWidth,
        exactWidth: Math.max(exactWidth, 0),
        color: MARKER_COLORS[marker.type],
        alpha: MARKER_ALPHA_BY_TYPE[marker.type],
        isVisible: true,
      };

      this.visibleIndicators.push(indicator);
    }

    // Resolve overlapping markers into gapped, min-width rectangles (dense points collapse
    // to one line). Hit testing still uses every indicator, so bucketed markers still count.
    const rects = layoutMarkerRects(
      this.visibleIndicators,
      MARKER_MIN_WIDTH_PX,
      MARKER_GAP_PX,
      MARKER_BUCKET_PX,
    );
    for (const rect of rects) {
      const sprite = this.spritePool.acquire();
      sprite.position.set(rect.x, 0);
      sprite.width = rect.width;
      sprite.height = renderState.displayHeight;
      sprite.tint = rect.color;
      sprite.alpha = rect.alpha;
    }
  }

  /**
   * Tests if a screen coordinate intersects any indicator.
   *
   * Used for hover detection. Returns marker with highest severity when multiple overlap.
   *
   * @param screenX - Mouse X coordinate in pixels (canvas-relative)
   * @param _screenY - Mouse Y coordinate in pixels (unused - indicators span full height)
   * @returns Marker under cursor (highest severity if multiple), or null if no hit
   */
  public hitTest(screenX: number, _screenY: number): TimelineMarker | null {
    const viewportState = this.viewport.getState();
    return hitTestMarkers(screenX, viewportState.offsetX, this.visibleIndicators);
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
