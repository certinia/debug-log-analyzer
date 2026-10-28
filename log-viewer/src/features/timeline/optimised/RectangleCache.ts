/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

/**
 * RectangleCache
 *
 * Single source of truth for rectangle computation and viewport culling.
 * Separates "what to draw" from "how to draw it" to eliminate coupling between renderers.
 *
 * Responsibilities:
 * - Maintain spatial index (rectsByCategory) for efficient access
 * - Perform viewport culling on demand
 * - Provide culled rectangles to any consumer (renderers)
 *
 * Does NOT:
 * - Perform any rendering
 * - Contain any PixiJS graphics logic
 * - Implement any search logic
 */

import type {
  CulledRenderData,
  RectColumns,
  RenderRectangle,
  ViewportState,
} from '../types/flamechart.types.js';
import type { BatchColorInfo } from './BucketColorResolver.js';
import { TemporalSegmentTree } from './TemporalSegmentTree.js';

/**
 * Pre-computed event rectangle with fixed and dynamic properties.
 * Stored once at construction to avoid recalculating every frame.
 */
export interface PrecomputedRect extends RenderRectangle {
  /** Unique ID for this rectangle */
  id: string;

  /** Timestamp in nanoseconds (fixed) */
  timeStart: number;

  /** Exit timestamp in nanoseconds (fixed) */
  timeEnd: number;

  /** Call stack depth (fixed) */
  depth: number;

  /** Total duration in nanoseconds including children (fixed) */
  duration: number;

  /** Self duration in nanoseconds excluding children (fixed, for category resolution) */
  selfDuration: number;

  /** Event category for color batching (fixed) */
  category: string;

  /** Screen X position (updated during culling) */
  x: number;

  /** Screen Y position (fixed) */
  y: number;

  /** Screen width (updated during culling) */
  width: number;

  /** Screen height (fixed) */
  height: number;
}

/** Rectangles built ahead, as `TimelineFrames` holds them. */
export interface PrecomputedRectData extends RectColumns {
  rectsByCategory: Map<string, PrecomputedRect[]>;
}

/**
 * Holds the rectangles by category and answers viewport and region queries through a
 * TemporalSegmentTree. Nothing reaches past it to the tree.
 */
export class RectangleCache {
  /** Spatial index: all rectangles grouped by category */
  private rectsByCategory: Map<string, PrecomputedRect[]>;

  /** Segment tree for O(log n) viewport culling */
  private segmentTree: TemporalSegmentTree;

  /** @param precomputed - The rectangles, built ahead */
  constructor(precomputed: PrecomputedRectData) {
    this.rectsByCategory = precomputed.rectsByCategory;
    for (const rects of this.rectsByCategory.values()) {
      sortByStartIfNeeded(rects);
    }

    this.segmentTree = new TemporalSegmentTree(precomputed);
  }

  /**
   * Get culled rectangles and buckets for current viewport.
   * Uses TemporalSegmentTree for O(log n) performance.
   *
   * Events wider than BUCKET_WIDTH are returned as visible rectangles.
   * Events up to BUCKET_WIDTH wide are aggregated into time-aligned buckets.
   *
   * @param viewport - Current viewport state
   * @param batchColors - Theme-aware category colors for bucket color resolution
   * @returns CulledRenderData with visible rectangles, buckets, and stats
   *
   * Performance target: <5ms for 50,000 events
   */
  public getCulledRectangles(
    viewport: ViewportState,
    batchColors: Map<string, BatchColorInfo>,
  ): CulledRenderData {
    return this.segmentTree.query(viewport, batchColors);
  }

  /**
   * Get the rectangles, grouped by category and each ascending by timeStart.
   *
   * @returns Map of category to rectangles
   */
  public getRectsByCategory(): Map<string, PrecomputedRect[]> {
    return this.rectsByCategory;
  }

  /**
   * Query rectangles within a specific time and depth region.
   * Delegates to TemporalSegmentTree for O(log n + k) performance.
   * Used for hit testing when bucket rects are empty.
   *
   * @param timeStart - Start time in nanoseconds
   * @param timeEnd - End time in nanoseconds
   * @param depthStart - Minimum depth (inclusive)
   * @param depthEnd - Maximum depth (inclusive)
   * @returns The rectangles in the region
   */
  public queryRectsInRegion(
    timeStart: number,
    timeEnd: number,
    depthStart: number,
    depthEnd: number,
  ): PrecomputedRect[] {
    return this.segmentTree.queryRectsInRegion(timeStart, timeEnd, depthStart, depthEnd);
  }
}

// A check costs less than the sort, and the frames arrive sorted on a well-formed log.
function sortByStartIfNeeded(rects: PrecomputedRect[]): void {
  for (let i = 1; i < rects.length; i++) {
    if (rects[i]!.timeStart < rects[i - 1]!.timeStart) {
      rects.sort((a, b) => a.timeStart - b.timeStart);
      return;
    }
  }
}
