/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * Temporal Segment Tree
 *
 * The primary spatial index for efficient frame queries in the timeline.
 * Use this tree (via RectangleManager) for all spatial queries instead of
 * traversing the event tree directly.
 *
 * A pre-computed tree structure for O(log n) viewport culling and bucket aggregation.
 * Replaces the per-frame O(n) iteration in RectangleManager.getCulledRectangles().
 *
 * Key capabilities:
 * - Viewport culling: query() returns visible rectangles and buckets
 * - Spatial queries: queryEventsInRegion() for hit testing (O(log n + k))
 * - Density stats: queryBucketStats() for minimap visualization (O(log n))
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
  LogEvent,
  PixelBucket,
  RenderStats,
  SegmentNode,
  ViewportState,
} from '../types/flamechart.types.js';
import {
  BUCKET_CONSTANTS,
  mergeNodeCategoryStats,
  SEGMENT_TREE_CONSTANTS,
  TIMELINE_CONSTANTS,
} from '../types/flamechart.types.js';
import {
  CATEGORY_COLORS,
  UNKNOWN_CATEGORY_COLOR,
  type BatchColorInfo,
} from './BucketColorResolver.js';
import type { PrecomputedRect } from './RectangleManager.js';
import { calculateViewportBounds } from './ViewportUtils.js';

/**
 * Priority map for category resolution (lower = higher priority).
 */
const PRIORITY_MAP = new Map<string, number>(
  BUCKET_CONSTANTS.CATEGORY_PRIORITY.map((cat, index) => [cat, index]),
);

/**
 * Frame data for minimap density computation.
 * Pre-sorted by timeStart for efficient sliding window algorithms.
 */
export interface SkylineFrame {
  timeStart: number;
  timeEnd: number;
  depth: number;
  category: string;
  selfDuration: number;
}

/**
 * TemporalSegmentTree
 *
 * Manages separate trees per depth level for efficient viewport culling.
 * Each depth level has its own independent time series of events.
 */
/** Bucket type used during aggregation */
type AggregationBucket = {
  depth: number;
  bucketIndex: number;
  timeStart: number;
  timeEnd: number;
  eventCount: number;
  categoryStats: Map<string, CategoryAggregation>;
  dominantCategory: string; // Resolved after all nodes aggregated
};

export class TemporalSegmentTree {
  /** Tree root per depth level: Map<depth, rootNode> */
  private treesByDepth: Map<number, SegmentNode> = new Map();

  /** Maximum depth in the tree */
  private maxDepth = 0;

  /** Cached batch colors for theme support */
  private batchColors?: Map<string, BatchColorInfo>;

  /**
   * Unsorted frames collected during tree construction.
   * Sorting is deferred to first getAllFramesSorted() call.
   */
  private unsortedFrames: SkylineFrame[] | null = null;

  /**
   * Cached sorted frames for minimap density computation.
   * Lazily sorted on first access to defer ~25ms sort cost to minimap render.
   */
  private cachedSortedFrames: SkylineFrame[] | null = null;

  /**
   * Build segment trees from pre-computed rectangles.
   *
   * @param rectsByCategory - Rectangles grouped by category (from RectangleManager)
   * @param batchColors - Optional colors for theme support
   * @param rectsByDepth - Optional pre-grouped by depth (from unified conversion, saves ~12ms)
   */
  constructor(
    rectsByCategory: Map<string, PrecomputedRect[]>,
    batchColors?: Map<string, BatchColorInfo>,
    rectsByDepth?: Map<number, PrecomputedRect[]>,
  ) {
    this.batchColors = batchColors;
    this.buildTrees(rectsByCategory, rectsByDepth);
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
    // T = 2px / zoom (ns) - used for both threshold check and bucket width
    const bucketTimeWidth = BUCKET_CONSTANTS.BUCKET_WIDTH / viewport.zoom;
    const eventHeight = TIMELINE_CONSTANTS.EVENT_HEIGHT;

    // Pre-initialize maps with known categories for O(1) lookup
    // If a category returns undefined, it's unknown and can be skipped
    const visibleRects = new Map<string, PrecomputedRect[]>();
    const bucketsByCategory = new Map<string, PixelBucket[]>();

    // Cache base colors per category (computed once per category)
    const categoryBaseColors = new Map<string, number>();

    for (const category of BUCKET_CONSTANTS.CATEGORY_PRIORITY) {
      visibleRects.set(category, []);
      bucketsByCategory.set(category, []);
      // Pre-cache base color for each known category
      const baseColor =
        effectiveBatchColors?.get(category)?.color ??
        CATEGORY_COLORS[category] ??
        UNKNOWN_CATEGORY_COLOR;
      categoryBaseColors.set(category, baseColor);
    }

    // Bucket aggregation map: keyed by (depth << 24) | bucketIndex
    // This matches the legacy RectangleManager approach for grid-aligned buckets
    const bucketMap = new Map<number, AggregationBucket>();

    // Stats tracking - using mutable object to avoid callback overhead
    const stats = { visibleCount: 0, bucketedEventCount: 0 };

    // Query each visible depth level
    const { depthStart, depthEnd, timeStart, timeEnd } = bounds;
    for (let depth = depthStart; depth <= depthEnd; depth++) {
      const tree = this.treesByDepth.get(depth);
      if (!tree) continue;

      this.queryNode(
        tree,
        timeStart,
        timeEnd,
        bucketTimeWidth, // threshold
        bucketTimeWidth,
        viewport,
        visibleRects,
        bucketMap,
        stats,
      );
    }

    // Convert bucketMap to PixelBuckets grouped by category
    // Resolve dominant category for each bucket from its aggregated stats
    let maxEventsPerBucket = 0;
    let bucketCount = 0;

    for (const [key, bucket] of bucketMap) {
      const { eventCount, categoryStats } = bucket;
      maxEventsPerBucket = Math.max(maxEventsPerBucket, eventCount);

      // Resolve dominant category from aggregated stats
      const dominantCategory = this.resolveDominantCategory(categoryStats);

      // Get pre-initialized category array (skip unknown categories)
      const categoryBuckets = bucketsByCategory.get(dominantCategory);
      if (!categoryBuckets) continue;

      // Get cached base color (skip unknown categories)
      const baseColor = categoryBaseColors.get(dominantCategory);
      if (baseColor === undefined) continue;

      const { bucketIndex, depth, timeStart, timeEnd } = bucket;
      categoryBuckets.push({
        id: `bucket-${key}`,
        // Grid-aligned X position: bucketIndex * BUCKET_WIDTH (always on 2px grid)
        x: bucketIndex * BUCKET_CONSTANTS.BUCKET_WIDTH,
        y: depth * eventHeight,
        timeStart,
        timeEnd,
        depth,
        eventCount,
        categoryStats: {
          byCategory: categoryStats,
          dominantCategory,
        },
        // Event refs are expensive to collect - leave empty for multi-event buckets
        eventRefs: [],
        color: baseColor,
      });
      bucketCount++;
    }

    const renderStats: RenderStats = {
      visibleCount: stats.visibleCount,
      bucketedEventCount: stats.bucketedEventCount,
      bucketCount,
      maxEventsPerBucket,
    };

    return { visibleRects, buckets: bucketsByCategory, stats: renderStats };
  }

  /**
   * Get the maximum depth in the tree.
   */
  public getMaxDepth(): number {
    return this.maxDepth;
  }

  /**
   * Get all frames sorted by timeStart for minimap density computation.
   * Frames are collected during tree construction but sorting is deferred
   * to first access to avoid blocking init when minimap isn't immediately visible.
   *
   * Performance: Lazy sorting defers ~25ms cost to first minimap render,
   * reducing init time when minimap isn't immediately needed.
   *
   * @returns Array of SkylineFrame sorted by timeStart
   */
  public getAllFramesSorted(): SkylineFrame[] {
    // Lazy sort on first access
    if (!this.cachedSortedFrames && this.unsortedFrames) {
      this.cachedSortedFrames = this.unsortedFrames;
      this.cachedSortedFrames.sort((a, b) => a.timeStart - b.timeStart);
      this.unsortedFrames = null; // Release reference
    }
    return this.cachedSortedFrames ?? [];
  }

  /**
   * Query events within a specific time and depth region.
   * Used for hit testing when bucket eventRefs are empty.
   * O(log n + k) complexity where k = events in region.
   *
   * @param timeStart - Start time in nanoseconds
   * @param timeEnd - End time in nanoseconds
   * @param depthStart - Minimum depth (inclusive)
   * @param depthEnd - Maximum depth (inclusive)
   * @returns Array of LogEvent references in the region
   */
  public queryEventsInRegion(
    timeStart: number,
    timeEnd: number,
    depthStart: number,
    depthEnd: number,
  ): LogEvent[] {
    const results: LogEvent[] = [];

    for (let depth = depthStart; depth <= depthEnd; depth++) {
      const tree = this.treesByDepth.get(depth);
      if (!tree) {
        continue;
      }

      this.collectEventsFromNode(tree, timeStart, timeEnd, results);
    }

    return results;
  }

  /**
   * Collect events from a tree node that overlap with the query time range.
   * Recursive traversal with early exit for non-overlapping nodes.
   */
  private collectEventsFromNode(
    node: SegmentNode,
    queryStart: number,
    queryEnd: number,
    results: LogEvent[],
  ): void {
    // Early exit: no overlap
    if (node.timeEnd <= queryStart || node.timeStart >= queryEnd) {
      return;
    }

    // Leaf with event ref: add to results
    if (node.isLeaf && node.eventRef) {
      results.push(node.eventRef);
      return;
    }

    // Branch: recurse into children
    if (node.children) {
      for (const child of node.children) {
        this.collectEventsFromNode(child, queryStart, queryEnd, results);
      }
    }
  }

  /**
   * Stats returned from queryBucketStats for minimap density computation.
   */
  public queryBucketStats(
    timeStart: number,
    timeEnd: number,
  ): {
    maxDepth: number;
    eventCount: number;
    selfDurationSum: number;
    categoryWeights: Map<string, { weightedTime: number; maxDepth: number }>;
    frames: SkylineFrame[];
  } {
    let maxDepth = 0;
    let eventCount = 0;
    let selfDurationSum = 0;
    const categoryWeights = new Map<string, { weightedTime: number; maxDepth: number }>();
    const frames: SkylineFrame[] = [];

    // Query each depth level
    for (const [depth, tree] of this.treesByDepth) {
      this.aggregateStatsFromNode(
        tree,
        timeStart,
        timeEnd,
        depth,
        categoryWeights,
        frames,
        (d, count, selfDur) => {
          if (d > maxDepth) {
            maxDepth = d;
          }
          eventCount += count;
          selfDurationSum += selfDur;
        },
      );
    }

    return { maxDepth, eventCount, selfDurationSum, categoryWeights, frames };
  }

  /**
   * Aggregate stats from a tree node for minimap density computation.
   * Collects frame references for skyline computation.
   */
  private aggregateStatsFromNode(
    node: SegmentNode,
    queryStart: number,
    queryEnd: number,
    depth: number,
    categoryWeights: Map<string, { weightedTime: number; maxDepth: number }>,
    frames: SkylineFrame[],
    onStats: (depth: number, count: number, selfDuration: number) => void,
  ): void {
    // Early exit: no overlap
    if (node.timeEnd <= queryStart || node.timeStart >= queryEnd) {
      return;
    }

    // Leaf node: aggregate its stats
    if (node.isLeaf && node.rectRef) {
      const rect = node.rectRef;

      // Calculate visible time within query range
      const overlapStart = Math.max(rect.timeStart, queryStart);
      const overlapEnd = Math.min(rect.timeEnd, queryEnd);
      const visibleTime = overlapEnd - overlapStart;

      // Calculate overlap ratio for proportional self-duration attribution
      const rectDuration = rect.timeEnd - rect.timeStart;
      const overlapRatio = rectDuration > 0 ? visibleTime / rectDuration : 0;
      const proportionalSelfDuration = rect.selfDuration * overlapRatio;

      // Depth² weighting for category dominance (still used for fallback stats)
      const depthWeight = (depth + 1) * (depth + 1);
      const weightedTime = proportionalSelfDuration * depthWeight;

      // Update category weights
      const category = rect.category;
      const existing = categoryWeights.get(category);
      if (existing) {
        existing.weightedTime += weightedTime;
        if (depth > existing.maxDepth) {
          existing.maxDepth = depth;
        }
      } else {
        categoryWeights.set(category, { weightedTime, maxDepth: depth });
      }

      // Collect frame for density computation
      frames.push({
        timeStart: rect.timeStart,
        timeEnd: rect.timeEnd,
        depth,
        category,
        selfDuration: rect.selfDuration,
      });

      onStats(depth, 1, proportionalSelfDuration);
      return;
    }

    // Branch node: recurse into children
    if (node.children) {
      for (const child of node.children) {
        this.aggregateStatsFromNode(
          child,
          queryStart,
          queryEnd,
          depth,
          categoryWeights,
          frames,
          onStats,
        );
      }
    }
  }

  // ==========================================================================
  // TREE BUILDING
  // ==========================================================================

  /**
   * Build segment trees for all depth levels.
   *
   * PERF optimizations:
   * - Uses pre-grouped rectsByDepth when available (~12ms saved)
   * - Collects frames for minimap during iteration (avoids O(N) traversal)
   * - Defers frame sorting to first getAllFramesSorted() call (~25ms saved)
   *
   * @param rectsByCategory - Rectangles grouped by category
   * @param preGroupedByDepth - Optional pre-grouped by depth from unified conversion
   */
  private buildTrees(
    rectsByCategory: Map<string, PrecomputedRect[]>,
    preGroupedByDepth?: Map<number, PrecomputedRect[]>,
  ): void {
    // Collect frames during iteration (avoids separate tree traversal later)
    const allFrames: SkylineFrame[] = [];

    // Use pre-grouped rectsByDepth if available, otherwise group from category map
    let rectsByDepth: Map<number, PrecomputedRect[]>;

    if (preGroupedByDepth) {
      // PERF: Use pre-grouped data (~12ms saved by skipping grouping iteration)
      rectsByDepth = preGroupedByDepth;

      // Still need to collect frames and track maxDepth
      for (const [depth, rects] of rectsByDepth) {
        this.maxDepth = Math.max(this.maxDepth, depth);
        for (const rect of rects) {
          allFrames.push({
            timeStart: rect.timeStart,
            timeEnd: rect.timeEnd,
            depth: rect.depth,
            category: rect.category,
            selfDuration: rect.selfDuration,
          });
        }
      }
    } else {
      // Fallback: Group all rectangles by depth
      rectsByDepth = new Map<number, PrecomputedRect[]>();

      for (const rects of rectsByCategory.values()) {
        for (const rect of rects) {
          let depthRects = rectsByDepth.get(rect.depth);
          if (!depthRects) {
            depthRects = [];
            rectsByDepth.set(rect.depth, depthRects);
          }
          depthRects.push(rect);
          this.maxDepth = Math.max(this.maxDepth, rect.depth);

          // Collect frame directly (eliminates recursive tree traversal in getAllFramesSorted)
          allFrames.push({
            timeStart: rect.timeStart,
            timeEnd: rect.timeEnd,
            depth: rect.depth,
            category: rect.category,
            selfDuration: rect.selfDuration,
          });
        }
      }
    }

    // Build tree for each depth
    for (const [depth, rects] of rectsByDepth) {
      const tree = this.buildTreeForDepth(rects, depth);
      if (tree) {
        this.treesByDepth.set(depth, tree);
      }
    }

    // PERF: Defer sorting to first getAllFramesSorted() call (~25ms saved at init)
    this.unsortedFrames = allFrames;
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

    // Create leaf nodes (O(n))
    const leaves = rects
      .map((rect) => this.createLeafNode(rect, depth))
      .sort((a, b) => a.timeStart - b.timeStart);

    // Build tree bottom-up
    return this.buildTreeFromLeaves(leaves);
  }

  /**
   * Create a leaf node from a PrecomputedRect.
   *
   * PERF: Uses leafCategory/leafDuration instead of Map to avoid 500k+ Map allocations.
   * categoryStats is null for leaf nodes - aggregation creates Maps only for branch nodes.
   */
  private createLeafNode(rect: PrecomputedRect, depth: number): SegmentNode {
    const duration = Math.max(SEGMENT_TREE_CONSTANTS.MIN_NODE_SPAN, rect.duration);

    return {
      timeStart: rect.timeStart,
      timeEnd: rect.timeEnd,
      nodeSpan: duration,

      // PERF: null instead of Map - saves ~35-40ms for 500k leaf nodes
      categoryStats: null,
      dominantCategory: rect.category,
      // PERF: Pre-compute priority to avoid PRIORITY_MAP lookups during query
      dominantPriority: PRIORITY_MAP.get(rect.category) ?? Infinity,

      // Leaf-specific fields (avoid Map allocation)
      leafCategory: rect.category,
      leafDuration: duration,

      eventCount: 1,
      eventRef: rect.eventRef,
      rectRef: rect, // Direct reference for O(1) lookup in addVisibleRect

      children: null,
      isLeaf: true,

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
   * PERF: Handles leaf nodes with leafCategory/leafDuration instead of categoryStats Map.
   */
  private createBranchNodeFromRange(
    children: SegmentNode[],
    start: number,
    end: number,
  ): SegmentNode {
    const firstChild = children[start]!;
    const timeStart = firstChild.timeStart;

    // Aggregate statistics and compute max timeEnd in a single pass
    // Children are sorted by timeStart, but an earlier child may have a longer duration
    // and thus a later timeEnd than subsequent children
    let timeEnd = firstChild.timeEnd;
    let totalEventCount = 0;
    const categoryStats = new Map<string, CategoryAggregation>();

    for (let i = start; i < end; i++) {
      const child = children[i]!;

      // Track max timeEnd
      if (child.timeEnd > timeEnd) {
        timeEnd = child.timeEnd;
      }

      totalEventCount += child.eventCount;
      mergeNodeCategoryStats(categoryStats, child);
    }

    const nodeSpan = Math.max(SEGMENT_TREE_CONSTANTS.MIN_NODE_SPAN, timeEnd - timeStart);

    return {
      timeStart,
      timeEnd,
      nodeSpan,

      categoryStats,
      // Branch nodes don't use dominantCategory/Priority - buckets resolve from categoryStats
      dominantCategory: '',
      dominantPriority: Infinity,

      eventCount: totalEventCount,

      children: children.slice(start, end),
      isLeaf: false,

      depth: firstChild.depth,
    };
  }

  // ==========================================================================
  // QUERY ALGORITHM
  // ==========================================================================

  /**
   * Iterative query traversal using explicit stack.
   * Stops at first node where nodeSpan <= threshold.
   * Aggregates nodes into grid-aligned buckets matching legacy behavior.
   *
   * PERF: Eliminates recursion overhead - no function calls, stack frames, or parameter copying.
   */
  private queryNode(
    root: SegmentNode,
    queryStart: number,
    queryEnd: number,
    threshold: number,
    bucketTimeWidth: number,
    viewport: ViewportState,
    visibleRects: Map<string, PrecomputedRect[]>,
    bucketMap: Map<number, AggregationBucket>,
    stats: { visibleCount: number; bucketedEventCount: number },
  ): void {
    // PERF: Use explicit stack instead of recursion
    const stack: SegmentNode[] = [root];

    let bucketedEventCount = 0;
    let visibleCount = 0;

    while (stack.length > 0) {
      const node = stack.pop()!;

      // Early exit: node completely outside query range
      const { timeStart, timeEnd } = node;
      if (timeEnd <= queryStart || timeStart >= queryEnd) {
        continue;
      }

      // Check if this node should be rendered as a bucket
      if (node.nodeSpan <= threshold) {
        // Aggregate into grid-aligned bucket (matching legacy behavior)
        this.aggregateIntoBucket(node, bucketTimeWidth, bucketMap);
        bucketedEventCount += node.eventCount;
        continue;
      }

      // Node too large to be a bucket
      if (node.isLeaf) {
        // Leaf node larger than threshold = visible rectangle
        this.addVisibleRect(node, viewport, visibleRects);
        ++visibleCount;
        continue;
      }

      // Branch node: push children onto stack (reverse order for left-to-right processing)
      const children = node.children!;
      const len = children.length;
      for (let i = len - 1; i >= 0; i--) {
        stack.push(children[i]!);
      }
    }

    stats.bucketedEventCount += bucketedEventCount;
    stats.visibleCount += visibleCount;
  }

  /**
   * Aggregate a segment node into a grid-aligned bucket.
   * Multiple nodes that fall into the same grid cell are merged into one bucket.
   * Dominant category is resolved after all nodes are aggregated.
   *
   * PERF: Handles leaf nodes with leafCategory/leafDuration instead of categoryStats Map.
   */
  private aggregateIntoBucket(
    node: SegmentNode,
    bucketTimeWidth: number,
    bucketMap: Map<number, AggregationBucket>,
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
        dominantCategory: '', // Resolved after all nodes aggregated
      };
      bucketMap.set(bucketKey, bucket);
    }

    // Aggregate node stats into bucket
    bucket.eventCount += node.eventCount;
    mergeNodeCategoryStats(bucket.categoryStats, node);
  }

  /**
   * Add a leaf node as a visible rectangle.
   *
   * PERFORMANCE: Uses rectRef stored in leaf node instead of O(n) search.
   * Uses pre-initialized map - unknown categories return undefined and are skipped.
   */
  private addVisibleRect(
    node: SegmentNode,
    viewport: ViewportState,
    visibleRects: Map<string, PrecomputedRect[]>,
  ): void {
    // Use the pre-stored rect reference from the leaf node
    const rect = node.rectRef;
    if (!rect) return;

    // Get pre-initialized category group (skip unknown categories)
    const group = visibleRects.get(node.dominantCategory);
    if (!group) return;

    // Update screen coordinates
    // NOTE: Do NOT subtract viewport.offsetX here - renderer applies via container transform
    rect.x = rect.timeStart * viewport.zoom;
    rect.width = rect.duration * viewport.zoom;

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
