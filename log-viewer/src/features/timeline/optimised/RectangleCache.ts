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
 * - Maintain the spatial index (a TemporalSegmentTree over the frames' rows)
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
  /** Timestamp in nanoseconds (fixed) */
  timeStart: number;

  /** Exit timestamp in nanoseconds (fixed) */
  timeEnd: number;

  /** Call stack depth (fixed) */
  depth: number;

  /** Total duration in nanoseconds including children (fixed) */
  duration: number;

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

/**
 * Indexes the rows with a rect and answers viewport and region queries through a
 * TemporalSegmentTree. Nothing reaches past it to the tree.
 */
export class RectangleCache {
  /** Segment tree for O(log n) viewport culling */
  private segmentTree: TemporalSegmentTree;

  /** @param columns - The frames, by row; only the rows with a rect are indexed */
  constructor(columns: RectColumns) {
    this.segmentTree = new TemporalSegmentTree(columns);
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
   * Query the rows with a rect within a specific time and depth region.
   * Delegates to TemporalSegmentTree for O(log n + k) performance.
   * Used for hit testing.
   *
   * @param timeStart - Start time in nanoseconds
   * @param timeEnd - End time in nanoseconds
   * @param depthStart - Minimum depth (inclusive)
   * @param depthEnd - Maximum depth (inclusive)
   * @returns The rows in the region
   */
  public queryRowsInRegion(
    timeStart: number,
    timeEnd: number,
    depthStart: number,
    depthEnd: number,
  ): number[] {
    return this.segmentTree.queryRowsInRegion(timeStart, timeEnd, depthStart, depthEnd);
  }
}
