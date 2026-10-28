/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * Temporal Segment Tree
 *
 * The primary spatial index for efficient frame queries in the timeline.
 * Use this tree (via RectangleCache) for all spatial queries instead of
 * traversing the event tree directly.
 *
 * A pre-computed tree structure for O(log n) viewport culling and bucket aggregation.
 *
 * Key capabilities:
 * - Viewport culling: query() returns visible rectangles and buckets
 * - Spatial queries: queryEventsInRegion() for hit testing (O(log n + k))
 *
 * Each depth's tree is held in typed arrays, one set per level, not one object per node.
 * Level 0 is the rects in start order. Node `i` on level `k > 0` spans nodes
 * `i * BRANCHING_FACTOR` up to the next `BRANCHING_FACTOR` on level `k - 1`.
 *
 * Build time: O(n log n) for sorting + O(n) for tree construction
 * Query time: O(k log n) where k = number of visible nodes
 */

import type {
  CategoryAggregation,
  CulledRenderData,
  PixelBucket,
  RenderStats,
  ViewportState,
} from '../types/flamechart.types.js';
import {
  BUCKET_CONSTANTS,
  SEGMENT_TREE_CONSTANTS,
  TIMELINE_CONSTANTS,
} from '../types/flamechart.types.js';
import { UNKNOWN_CATEGORY_COLOR, type BatchColorInfo } from './BucketColorResolver.js';
import type { PrecomputedRect } from './RectangleCache.js';
import { calculateViewportBounds } from './ViewportUtils.js';

/**
 * Priority map for category resolution (lower = higher priority).
 */
const PRIORITY_MAP = new Map<string, number>(
  BUCKET_CONSTANTS.CATEGORY_PRIORITY.map((cat, index) => [cat, index]),
);

const { BRANCHING_FACTOR, MIN_NODE_SPAN } = SEGMENT_TREE_CONSTANTS;

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

/** The branch nodes of one level. Category stats are `slotCount` wide per node. */
interface BranchLevel {
  timeStart: Float64Array;
  timeEnd: Float64Array;
  slotDuration: Float64Array;
  slotCount: Uint32Array;
}

interface DepthTree {
  depth: number;
  /** The leaves, ascending by timeStart. */
  rects: readonly PrecomputedRect[];
  /** `branches[k - 1]` is level `k`; the last holds the root. Empty when one rect is the root. */
  branches: BranchLevel[];
}

/** Group rectangles by depth, for a caller that has not already done it. */
function groupByDepth(
  rectsByCategory: Map<string, PrecomputedRect[]>,
): Map<number, PrecomputedRect[]> {
  const rectsByDepth = new Map<number, PrecomputedRect[]>();
  for (const rects of rectsByCategory.values()) {
    for (const rect of rects) {
      let depthRects = rectsByDepth.get(rect.depth);
      if (!depthRects) {
        depthRects = [];
        rectsByDepth.set(rect.depth, depthRects);
      }
      depthRects.push(rect);
    }
  }
  return rectsByDepth;
}

// The caller's array is used as is when sorted, as it is on a well-formed log.
function byStart(rects: readonly PrecomputedRect[]): readonly PrecomputedRect[] {
  for (let i = 1; i < rects.length; i++) {
    if (rects[i]!.timeStart < rects[i - 1]!.timeStart) {
      return [...rects].sort((a, b) => a.timeStart - b.timeStart);
    }
  }
  return rects;
}

function leafSpan(rect: PrecomputedRect): number {
  return Math.max(MIN_NODE_SPAN, rect.duration);
}

function levelWidth(tree: DepthTree, level: number): number {
  return level === 0 ? tree.rects.length : tree.branches[level - 1]!.timeStart.length;
}

export class TemporalSegmentTree {
  private treesByDepth = new Map<number, DepthTree>();

  /** Maximum depth in the tree */
  private maxDepth = 0;

  /** The category of each stats slot, in priority order, then any other category met. */
  private slotCategories: string[] = [...BUCKET_CONSTANTS.CATEGORY_PRIORITY];

  private slotOf = new Map<string, number>(this.slotCategories.map((cat, slot) => [cat, slot]));

  /**
   * Build segment trees from pre-computed rectangles.
   *
   * @param rectsByCategory - Rectangles grouped by category (from RectangleCache)
   * @param rectsByDepth - Optional pre-grouped by depth (from unified conversion, saves ~12ms)
   */
  constructor(
    rectsByCategory: Map<string, PrecomputedRect[]>,
    rectsByDepth?: Map<number, PrecomputedRect[]>,
  ) {
    // Every rect is slotted before any tree is built, as each tree is as wide as the slot count.
    const leaves: [number, readonly PrecomputedRect[], Uint16Array][] = [];
    for (const [depth, rects] of rectsByDepth ?? groupByDepth(rectsByCategory)) {
      if (depth > this.maxDepth) {
        this.maxDepth = depth;
      }
      if (rects.length) {
        const sorted = byStart(rects);
        leaves.push([
          depth,
          sorted,
          Uint16Array.from(sorted, (rect) => this.slotFor(rect.category)),
        ]);
      }
    }
    for (const [depth, rects, leafSlot] of leaves) {
      this.treesByDepth.set(depth, this.buildTree(depth, rects, leafSlot));
    }
  }

  /**
   * Query the segment tree for nodes to render at current viewport.
   *
   * @param viewport - Current viewport state
   * @param batchColors - Theme-aware category colors for bucket color resolution
   * @returns CulledRenderData compatible with existing rendering pipeline
   */
  public query(
    viewport: ViewportState,
    batchColors: Map<string, BatchColorInfo>,
  ): CulledRenderData {
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
      const baseColor = batchColors.get(category)?.color ?? UNKNOWN_CATEGORY_COLOR;
      categoryBaseColors.set(category, baseColor);
    }

    // Bucket aggregation map: keyed by (depth << 24) | bucketIndex
    const bucketMap = new Map<number, AggregationBucket>();

    // Stats tracking - using mutable object to avoid callback overhead
    const stats = { visibleCount: 0, bucketedEventCount: 0 };

    // Query each visible depth level
    const { depthStart, depthEnd, timeStart, timeEnd } = bounds;
    for (let depth = depthStart; depth <= depthEnd; depth++) {
      const tree = this.treesByDepth.get(depth);
      if (!tree) {
        continue;
      }

      this.queryTree(
        tree,
        timeStart,
        timeEnd,
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
      if (!categoryBuckets) {
        continue;
      }

      // Get cached base color (skip unknown categories)
      const baseColor = categoryBaseColors.get(dominantCategory);
      if (baseColor === undefined) {
        continue;
      }

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
        // Rects are expensive to collect - leave empty for multi-event buckets
        rects: [],
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
   * Query rectangles within a specific time and depth region.
   * Used for hit testing when bucket rects are empty.
   * O(log n + k) complexity where k = rectangles in region.
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
    const results: PrecomputedRect[] = [];

    for (let depth = depthStart; depth <= depthEnd; depth++) {
      const tree = this.treesByDepth.get(depth);
      if (tree) {
        this.collectRects(tree, tree.branches.length, 0, timeStart, timeEnd, results);
      }
    }

    return results;
  }

  private collectRects(
    tree: DepthTree,
    level: number,
    index: number,
    queryStart: number,
    queryEnd: number,
    results: PrecomputedRect[],
  ): void {
    if (level === 0) {
      const rect = tree.rects[index]!;
      if (rect.timeEnd > queryStart && rect.timeStart < queryEnd) {
        results.push(rect);
      }
      return;
    }

    const branch = tree.branches[level - 1]!;
    if (branch.timeEnd[index]! <= queryStart || branch.timeStart[index]! >= queryEnd) {
      return;
    }
    const first = index * BRANCHING_FACTOR;
    const last = Math.min(first + BRANCHING_FACTOR, levelWidth(tree, level - 1));
    for (let child = first; child < last; child++) {
      this.collectRects(tree, level - 1, child, queryStart, queryEnd, results);
    }
  }

  // ==========================================================================
  // TREE BUILDING
  // ==========================================================================

  private buildTree(
    depth: number,
    rects: readonly PrecomputedRect[],
    leafSlot: Uint16Array,
  ): DepthTree {
    const slots = this.slotCategories.length;
    const branches: BranchLevel[] = [];
    let width = rects.length;
    while (width > 1) {
      const below = branches.at(-1);
      const nodes = Math.ceil(width / BRANCHING_FACTOR);
      const level: BranchLevel = {
        timeStart: new Float64Array(nodes),
        timeEnd: new Float64Array(nodes),
        slotDuration: new Float64Array(nodes * slots),
        slotCount: new Uint32Array(nodes * slots),
      };

      for (let node = 0; node < nodes; node++) {
        const first = node * BRANCHING_FACTOR;
        const last = Math.min(first + BRANCHING_FACTOR, width);
        const at = node * slots;
        // Children are sorted by timeStart, but an earlier child may end later.
        // `>`, not Math.max: a NaN end must not spread to every ancestor.
        let timeEnd = below ? below.timeEnd[first]! : rects[first]!.timeEnd;
        if (below) {
          for (let child = first; child < last; child++) {
            const end = below.timeEnd[child]!;
            if (end > timeEnd) {
              timeEnd = end;
            }
            const from = child * slots;
            for (let slot = 0; slot < slots; slot++) {
              level.slotDuration[at + slot]! += below.slotDuration[from + slot]!;
              level.slotCount[at + slot]! += below.slotCount[from + slot]!;
            }
          }
          level.timeStart[node] = below.timeStart[first]!;
        } else {
          for (let child = first; child < last; child++) {
            const rect = rects[child]!;
            if (rect.timeEnd > timeEnd) {
              timeEnd = rect.timeEnd;
            }
            const offset = at + leafSlot[child]!;
            level.slotDuration[offset]! += leafSpan(rect);
            level.slotCount[offset]!++;
          }
          level.timeStart[node] = rects[first]!.timeStart;
        }
        level.timeEnd[node] = timeEnd;
      }

      branches.push(level);
      width = nodes;
    }

    return { depth, rects, branches };
  }

  private slotFor(category: string): number {
    let slot = this.slotOf.get(category);
    if (slot === undefined) {
      slot = this.slotCategories.push(category) - 1;
      this.slotOf.set(category, slot);
    }
    return slot;
  }

  // ==========================================================================
  // QUERY ALGORITHM
  // ==========================================================================

  /**
   * Iterative query traversal using explicit stack.
   * Stops at the first node whose span fits in one bucket.
   */
  private queryTree(
    tree: DepthTree,
    queryStart: number,
    queryEnd: number,
    bucketTimeWidth: number,
    viewport: ViewportState,
    visibleRects: Map<string, PrecomputedRect[]>,
    bucketMap: Map<number, AggregationBucket>,
    stats: { visibleCount: number; bucketedEventCount: number },
  ): void {
    const stack: number[] = [tree.branches.length, 0];

    let bucketedEventCount = 0;
    let visibleCount = 0;

    while (stack.length > 0) {
      const index = stack.pop()!;
      const level = stack.pop()!;

      if (level === 0) {
        const rect = tree.rects[index]!;
        if (rect.timeEnd <= queryStart || rect.timeStart >= queryEnd) {
          continue;
        }
        const span = leafSpan(rect);
        if (span <= bucketTimeWidth) {
          const bucket = this.bucketAt(tree.depth, rect.timeStart, bucketTimeWidth, bucketMap);
          bucket.eventCount++;
          addStats(bucket.categoryStats, rect.category, 1, span);
          bucketedEventCount++;
        } else {
          this.addVisibleRect(rect, viewport, visibleRects);
          ++visibleCount;
        }
        continue;
      }

      const branch = tree.branches[level - 1]!;
      const timeStart = branch.timeStart[index]!;
      const timeEnd = branch.timeEnd[index]!;
      if (timeEnd <= queryStart || timeStart >= queryEnd) {
        continue;
      }

      if (Math.max(MIN_NODE_SPAN, timeEnd - timeStart) <= bucketTimeWidth) {
        const bucket = this.bucketAt(tree.depth, timeStart, bucketTimeWidth, bucketMap);
        const slots = this.slotCategories.length;
        const at = index * slots;
        for (let slot = 0; slot < slots; slot++) {
          const count = branch.slotCount[at + slot]!;
          if (count) {
            bucket.eventCount += count;
            bucketedEventCount += count;
            addStats(
              bucket.categoryStats,
              this.slotCategories[slot]!,
              count,
              branch.slotDuration[at + slot]!,
            );
          }
        }
        continue;
      }

      // Pushed in reverse, so children pop left to right.
      const first = index * BRANCHING_FACTOR;
      const last = Math.min(first + BRANCHING_FACTOR, levelWidth(tree, level - 1));
      for (let child = last - 1; child >= first; child--) {
        stack.push(level - 1, child);
      }
    }

    stats.bucketedEventCount += bucketedEventCount;
    stats.visibleCount += visibleCount;
  }

  /**
   * The grid-aligned bucket a node starting at `timeStart` falls in.
   * Multiple nodes that fall into the same grid cell are merged into one bucket.
   * Dominant category is resolved after all nodes are aggregated.
   */
  private bucketAt(
    depth: number,
    timeStart: number,
    bucketTimeWidth: number,
    bucketMap: Map<number, AggregationBucket>,
  ): AggregationBucket {
    const bucketIndex = Math.floor(timeStart / bucketTimeWidth);
    // Composite integer key: depth in upper 8 bits, bucketIndex in lower 24 bits
    const bucketKey = (depth << 24) | (bucketIndex & 0xffffff);

    let bucket = bucketMap.get(bucketKey);
    if (!bucket) {
      bucket = {
        depth,
        bucketIndex,
        timeStart: bucketIndex * bucketTimeWidth,
        timeEnd: (bucketIndex + 1) * bucketTimeWidth,
        eventCount: 0,
        categoryStats: new Map(),
        dominantCategory: '', // Resolved after all nodes aggregated
      };
      bucketMap.set(bucketKey, bucket);
    }
    return bucket;
  }

  /**
   * Add a leaf as a visible rectangle.
   * Uses pre-initialized map - unknown categories return undefined and are skipped.
   */
  private addVisibleRect(
    rect: PrecomputedRect,
    viewport: ViewportState,
    visibleRects: Map<string, PrecomputedRect[]>,
  ): void {
    // Get pre-initialized category group (skip unknown categories)
    const group = visibleRects.get(rect.category);
    if (!group) {
      return;
    }

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

function addStats(
  target: Map<string, CategoryAggregation>,
  category: string,
  count: number,
  totalDuration: number,
): void {
  const existing = target.get(category);
  if (existing) {
    existing.count += count;
    existing.totalDuration += totalDuration;
  } else {
    target.set(category, { count, totalDuration });
  }
}
