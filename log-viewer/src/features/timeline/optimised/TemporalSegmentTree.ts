/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

/**
 * Temporal Segment Tree
 *
 * A pre-computed tree structure for O(log n) viewport culling and bucket aggregation.
 * Replaces the per-frame O(n) iteration in RectangleManager.getCulledRectangles().
 *
 * Key concepts:
 * - Leaf nodes represent individual events
 * - Branch nodes aggregate children with pre-computed category statistics
 * - Query traversal stops at nodes where nodeSpan <= threshold (2px / zoom)
 * - Pre-computed category stats enable instant bucket color resolution
 *
 * Memory usage: ~175MB for 500k events (tree + original rectangles)
 * Build time: O(n log n) for sorting + O(n) for tree construction
 * Query time: O(k log n) where k = number of visible nodes
 */

import type {
  CategoryAggregation,
  CulledRenderData,
  PixelBucket,
  RenderStats,
  SegmentNode,
  ViewportState,
} from '../types/flamechart.types.js';
import {
  BUCKET_CONSTANTS,
  SEGMENT_TREE_CONSTANTS,
  TIMELINE_CONSTANTS,
} from '../types/flamechart.types.js';
import type { BatchColorInfo } from './BucketColorResolver.js';
import { calculateBucketColor } from './BucketOpacity.js';
import type { PrecomputedRect } from './RectangleManager.js';
import { calculateViewportBounds } from './ViewportUtils.js';

/**
 * Map category names to their hex colors.
 * Colors match TIMELINE_CONSTANTS.DEFAULT_COLORS but in numeric format.
 */
const CATEGORY_COLORS: Record<string, number> = {
  DML: 0xb06868,
  SOQL: 0x6d4c7d,
  Method: 0x2b8f81,
  'Code Unit': 0x88ae58,
  'System Method': 0x8d6e63,
  Flow: 0x5c8fa6,
  Workflow: 0x51a16e,
};

const UNKNOWN_CATEGORY_COLOR = 0x888888;

/**
 * Priority map for category resolution (lower = higher priority).
 */
const PRIORITY_MAP = new Map<string, number>(
  BUCKET_CONSTANTS.CATEGORY_PRIORITY.map((cat, index) => [cat, index]),
);

/**
 * TemporalSegmentTree
 *
 * Manages separate trees per depth level for efficient viewport culling.
 * Each depth level has its own independent time series of events.
 */
export class TemporalSegmentTree {
  /** Tree root per depth level: Map<depth, rootNode> */
  private treesByDepth: Map<number, SegmentNode> = new Map();

  /** Maximum depth in the tree */
  private maxDepth = 0;

  /** Cached batch colors for theme support */
  private batchColors?: Map<string, BatchColorInfo>;

  /**
   * Build segment trees from pre-computed rectangles.
   *
   * @param rectsByCategory - Rectangles grouped by category (from RectangleManager)
   * @param batchColors - Optional colors for theme support
   */
  constructor(
    rectsByCategory: Map<string, PrecomputedRect[]>,
    batchColors?: Map<string, BatchColorInfo>,
  ) {
    this.batchColors = batchColors;
    this.buildTrees(rectsByCategory);
  }

  /**
   * Update batch colors (for theme changes).
   */
  public setBatchColors(batchColors: Map<string, BatchColorInfo>): void {
    this.batchColors = batchColors;
    // Note: We don't rebuild trees - colors are resolved at query time
  }

  /**
   * Query the segment tree for nodes to render at current viewport.
   *
   * @param viewport - Current viewport state
   * @param batchColors - Optional colors from RenderBatch (for theme support)
   * @returns CulledRenderData compatible with existing rendering pipeline
   */
  public query(
    viewport: ViewportState,
    batchColors?: Map<string, BatchColorInfo>,
  ): CulledRenderData {
    const effectiveBatchColors = batchColors ?? this.batchColors;
    const bounds = calculateViewportBounds(viewport);
    const threshold = BUCKET_CONSTANTS.BUCKET_WIDTH / viewport.zoom; // T = 2px / zoom (ns)

    const visibleRects = new Map<string, PrecomputedRect[]>();

    // Bucket aggregation map: keyed by (depth << 24) | bucketIndex
    // This matches the legacy RectangleManager approach for grid-aligned buckets
    const bucketMap = new Map<
      number,
      {
        depth: number;
        bucketIndex: number;
        timeStart: number;
        timeEnd: number;
        eventCount: number;
        categoryStats: Map<string, CategoryAggregation>;
      }
    >();

    // Stats tracking - using mutable object to avoid callback overhead
    const stats = { visibleCount: 0, bucketedEventCount: 0 };

    // Calculate bucket time width (how much time fits in 2 pixels)
    const bucketTimeWidth = BUCKET_CONSTANTS.BUCKET_WIDTH / viewport.zoom;
    const eventHeight = TIMELINE_CONSTANTS.EVENT_HEIGHT;

    // Query each visible depth level
    for (let depth = bounds.depthStart; depth <= bounds.depthEnd; depth++) {
      const tree = this.treesByDepth.get(depth);
      if (!tree) continue;

      this.queryNode(
        tree,
        bounds.timeStart,
        bounds.timeEnd,
        threshold,
        bucketTimeWidth,
        viewport,
        visibleRects,
        bucketMap,
        stats,
      );
    }

    // Convert bucket map to PixelBucket array
    const buckets: PixelBucket[] = [];
    let maxEventsPerBucket = 0;

    for (const [key, bucket] of bucketMap) {
      maxEventsPerBucket = Math.max(maxEventsPerBucket, bucket.eventCount);

      // Determine dominant category for color
      const dominantCategory = this.resolveDominantCategory(bucket.categoryStats);

      // Get color from dominant category and calculate opacity based on event count
      const color =
        effectiveBatchColors?.get(dominantCategory)?.color ??
        CATEGORY_COLORS[dominantCategory] ??
        UNKNOWN_CATEGORY_COLOR;
      const finalColor = calculateBucketColor(color, bucket.eventCount);

      const pixelBucket: PixelBucket = {
        id: `bucket-${key}`,
        // Grid-aligned X position: bucketIndex * BUCKET_WIDTH (always on 2px grid)
        x: bucket.bucketIndex * BUCKET_CONSTANTS.BUCKET_WIDTH,
        y: bucket.depth * eventHeight,
        timeStart: bucket.timeStart,
        timeEnd: bucket.timeEnd,
        depth: bucket.depth,
        eventCount: bucket.eventCount,
        categoryStats: {
          byCategory: bucket.categoryStats,
          dominantCategory,
        },
        // Event refs are expensive to collect - leave empty for multi-event buckets
        eventRefs: [],
        color: finalColor,
      };

      buckets.push(pixelBucket);
    }

    const renderStats: RenderStats = {
      visibleCount: stats.visibleCount,
      bucketedEventCount: stats.bucketedEventCount,
      bucketCount: buckets.length,
      maxEventsPerBucket,
    };

    return { visibleRects, buckets, stats: renderStats };
  }

  /**
   * Get the maximum depth in the tree.
   */
  public getMaxDepth(): number {
    return this.maxDepth;
  }

  // ==========================================================================
  // TREE BUILDING
  // ==========================================================================

  /**
   * Build segment trees for all depth levels.
   */
  private buildTrees(rectsByCategory: Map<string, PrecomputedRect[]>): void {
    // Group all rectangles by depth
    const rectsByDepth = new Map<number, PrecomputedRect[]>();

    for (const rects of rectsByCategory.values()) {
      for (const rect of rects) {
        let depthRects = rectsByDepth.get(rect.depth);
        if (!depthRects) {
          depthRects = [];
          rectsByDepth.set(rect.depth, depthRects);
        }
        depthRects.push(rect);
        this.maxDepth = Math.max(this.maxDepth, rect.depth);
      }
    }

    // Build tree for each depth
    for (const [depth, rects] of rectsByDepth) {
      const tree = this.buildTreeForDepth(rects, depth);
      if (tree) {
        this.treesByDepth.set(depth, tree);
      }
    }
  }

  /**
   * Build segment tree for a single depth level.
   *
   * @param rects - Rectangles at this depth
   * @param depth - Depth level (for Y position calculation)
   * @returns Root node of the tree, or null if no rectangles
   */
  private buildTreeForDepth(rects: PrecomputedRect[], depth: number): SegmentNode | null {
    if (rects.length === 0) {
      return null;
    }

    // Sort by timestamp (O(n log n))
    const sorted = [...rects].sort((a, b) => a.timeStart - b.timeStart);

    // Create leaf nodes (O(n))
    const leaves = sorted.map((rect) => this.createLeafNode(rect, depth));

    // Build tree bottom-up
    return this.buildTreeFromLeaves(leaves);
  }

  /**
   * Create a leaf node from a PrecomputedRect.
   */
  private createLeafNode(rect: PrecomputedRect, depth: number): SegmentNode {
    const duration = Math.max(SEGMENT_TREE_CONSTANTS.MIN_NODE_SPAN, rect.duration);

    const categoryStats = new Map<string, CategoryAggregation>([
      [rect.category, { count: 1, totalDuration: duration }],
    ]);

    return {
      timeStart: rect.timeStart,
      timeEnd: rect.timeEnd,
      nodeSpan: duration,

      categoryStats,
      dominantCategory: rect.category,

      eventCount: 1,
      eventRef: rect.eventRef,
      rectRef: rect, // Direct reference for O(1) lookup in addVisibleRect

      children: null,
      isLeaf: true,

      y: depth * TIMELINE_CONSTANTS.EVENT_HEIGHT,
      depth,
    };
  }

  /**
   * Build tree from leaves using iterative bottom-up construction.
   *
   * PERF: Uses index-based iteration to avoid array allocations from slice().
   */
  private buildTreeFromLeaves(leaves: SegmentNode[]): SegmentNode {
    const { BRANCHING_FACTOR } = SEGMENT_TREE_CONSTANTS;

    let currentLevel = leaves;

    while (currentLevel.length > 1) {
      const levelLength = currentLevel.length;
      // Pre-calculate next level size to avoid array resizing
      const nextLevelSize = Math.ceil(levelLength / BRANCHING_FACTOR);
      const nextLevel: SegmentNode[] = new Array(nextLevelSize);
      let nextIdx = 0;

      for (let i = 0; i < levelLength; i += BRANCHING_FACTOR) {
        const end = Math.min(i + BRANCHING_FACTOR, levelLength);
        nextLevel[nextIdx++] = this.createBranchNodeFromRange(currentLevel, i, end);
      }

      currentLevel = nextLevel;
    }

    return currentLevel[0]!;
  }

  /**
   * Create a branch node from a range of children (avoids array allocation).
   *
   * PERF: Uses start/end indices instead of creating a sliced array.
   */
  private createBranchNodeFromRange(
    children: SegmentNode[],
    start: number,
    end: number,
  ): SegmentNode {
    const firstChild = children[start]!;
    const lastChild = children[end - 1]!;
    const timeStart = firstChild.timeStart;
    const timeEnd = lastChild.timeEnd;
    const nodeSpan = Math.max(SEGMENT_TREE_CONSTANTS.MIN_NODE_SPAN, timeEnd - timeStart);

    // Aggregate statistics
    let totalEventCount = 0;
    const categoryStats = new Map<string, CategoryAggregation>();

    for (let i = start; i < end; i++) {
      const child = children[i]!;
      totalEventCount += child.eventCount;

      // Merge category stats
      for (const [cat, stats] of child.categoryStats) {
        const existing = categoryStats.get(cat);
        if (existing) {
          existing.count += stats.count;
          existing.totalDuration += stats.totalDuration;
        } else {
          categoryStats.set(cat, { count: stats.count, totalDuration: stats.totalDuration });
        }
      }
    }

    // Determine dominant category
    const dominantCategory = this.resolveDominantCategory(categoryStats);

    // Store actual child references for tree traversal
    const childNodes = children.slice(start, end);

    return {
      timeStart,
      timeEnd,
      nodeSpan,

      categoryStats,
      dominantCategory,

      eventCount: totalEventCount,

      children: childNodes,
      isLeaf: false,

      y: firstChild.y,
      depth: firstChild.depth,
    };
  }

  // ==========================================================================
  // QUERY ALGORITHM
  // ==========================================================================

  /**
   * Recursive query traversal.
   * Stops at first node where nodeSpan <= threshold.
   * Aggregates nodes into grid-aligned buckets matching legacy behavior.
   *
   * PERF: Uses mutable stats object instead of callbacks to reduce overhead.
   */
  private queryNode(
    node: SegmentNode,
    queryStart: number,
    queryEnd: number,
    threshold: number,
    bucketTimeWidth: number,
    viewport: ViewportState,
    visibleRects: Map<string, PrecomputedRect[]>,
    bucketMap: Map<
      number,
      {
        depth: number;
        bucketIndex: number;
        timeStart: number;
        timeEnd: number;
        eventCount: number;
        categoryStats: Map<string, CategoryAggregation>;
      }
    >,
    stats: { visibleCount: number; bucketedEventCount: number },
  ): void {
    // Early exit: node completely outside query range
    if (node.timeEnd <= queryStart || node.timeStart >= queryEnd) {
      return;
    }

    // Check if this node should be rendered as a bucket
    if (node.nodeSpan <= threshold) {
      // Aggregate into grid-aligned bucket (matching legacy behavior)
      this.aggregateIntoBucket(node, bucketTimeWidth, bucketMap);
      stats.bucketedEventCount += node.eventCount;
      return;
    }

    // Node too large to be a bucket
    if (node.isLeaf) {
      // Leaf node larger than threshold = visible rectangle
      // Add to visible rects by finding the original PrecomputedRect
      this.addVisibleRect(node, viewport, visibleRects);
      stats.visibleCount++;
      return;
    }

    // Branch node: recurse into children
    for (const child of node.children!) {
      this.queryNode(
        child,
        queryStart,
        queryEnd,
        threshold,
        bucketTimeWidth,
        viewport,
        visibleRects,
        bucketMap,
        stats,
      );
    }
  }

  /**
   * Aggregate a segment node into a grid-aligned bucket.
   * Multiple nodes that fall into the same grid cell are merged into one bucket.
   * This matches the legacy RectangleManager bucket behavior.
   */
  private aggregateIntoBucket(
    node: SegmentNode,
    bucketTimeWidth: number,
    bucketMap: Map<
      number,
      {
        depth: number;
        bucketIndex: number;
        timeStart: number;
        timeEnd: number;
        eventCount: number;
        categoryStats: Map<string, CategoryAggregation>;
      }
    >,
  ): void {
    // Calculate grid-aligned bucket index (same as legacy)
    const bucketIndex = Math.floor(node.timeStart / bucketTimeWidth);
    // Composite integer key: depth in upper 8 bits, bucketIndex in lower 24 bits
    const bucketKey = (node.depth << 24) | (bucketIndex & 0xffffff);

    let bucket = bucketMap.get(bucketKey);
    if (!bucket) {
      bucket = {
        depth: node.depth,
        bucketIndex,
        timeStart: bucketIndex * bucketTimeWidth,
        timeEnd: (bucketIndex + 1) * bucketTimeWidth,
        eventCount: 0,
        categoryStats: new Map(),
      };
      bucketMap.set(bucketKey, bucket);
    }

    // Aggregate node stats into bucket
    bucket.eventCount += node.eventCount;

    // Merge category stats
    for (const [category, stats] of node.categoryStats) {
      const existing = bucket.categoryStats.get(category);
      if (existing) {
        existing.count += stats.count;
        existing.totalDuration += stats.totalDuration;
      } else {
        bucket.categoryStats.set(category, {
          count: stats.count,
          totalDuration: stats.totalDuration,
        });
      }
    }
  }

  /**
   * Add a leaf node as a visible rectangle.
   *
   * PERFORMANCE: Uses rectRef stored in leaf node instead of O(n) search.
   */
  private addVisibleRect(
    node: SegmentNode,
    viewport: ViewportState,
    visibleRects: Map<string, PrecomputedRect[]>,
  ): void {
    // Use the pre-stored rect reference from the leaf node
    const rect = node.rectRef;
    if (!rect) return;

    // Update screen coordinates
    // NOTE: Do NOT subtract viewport.offsetX here - renderer applies via container transform
    rect.x = rect.timeStart * viewport.zoom;
    rect.width = rect.duration * viewport.zoom;

    // Add to category group
    const category = node.dominantCategory;
    let group = visibleRects.get(category);
    if (!group) {
      group = [];
      visibleRects.set(category, group);
    }
    group.push(rect);
  }

  // ==========================================================================
  // UTILITY METHODS
  // ==========================================================================

  /**
   * Resolve dominant category from stats using priority order.
   */
  private resolveDominantCategory(categoryStats: Map<string, CategoryAggregation>): string {
    let winningCategory = '';
    let winningPriority = Infinity;
    let winningDuration = -1;
    let winningCount = -1;

    for (const [category, stats] of categoryStats) {
      const priority = PRIORITY_MAP.get(category) ?? Infinity;

      if (priority < winningPriority) {
        winningCategory = category;
        winningPriority = priority;
        winningDuration = stats.totalDuration;
        winningCount = stats.count;
      } else if (priority === winningPriority) {
        if (stats.totalDuration > winningDuration) {
          winningCategory = category;
          winningDuration = stats.totalDuration;
          winningCount = stats.count;
        } else if (stats.totalDuration === winningDuration) {
          if (stats.count > winningCount) {
            winningCategory = category;
            winningCount = stats.count;
          }
        }
      }
    }

    return winningCategory;
  }
}
