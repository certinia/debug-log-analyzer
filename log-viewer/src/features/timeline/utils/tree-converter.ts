/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * Tree Converter Utility
 *
 * Converts LogEvent hierarchies to generic TreeNode<EventNode> structures.
 * Enables FlameChart to work with generic event types while maintaining
 * backwards compatibility with existing LogEvent-based code.
 *
 * Also builds navigation maps during traversal to avoid duplicate O(n) work.
 *
 * Performance optimization: The unified `logEventToTreeAndRects` function
 * combines tree conversion with rectangle pre-computation in a single O(n) pass,
 * eliminating redundant traversals.
 */

import type { LogEvent } from '../../../core/log-parser/LogEvents.js';
import type { PrecomputedRect } from '../optimised/RectangleManager.js';
import { TIMELINE_CONSTANTS, type EventNode, type TreeNode } from '../types/flamechart.types.js';

// Re-export PrecomputedRect for consumers of this module
export type { PrecomputedRect };

/**
 * Sibling information for a node.
 */
export interface SiblingInfo {
  /** Index in parent's children array (or root array) */
  index: number;
  /** Reference to siblings array (parent.children or root array) */
  siblings: TreeNode<EventNode>[];
}

/**
 * Navigation maps built during tree conversion.
 * Used by TreeNavigator for O(1) lookups.
 */
export interface NavigationMaps {
  /** Maps original LogEvent to TreeNode for hit test lookup */
  originalMap: Map<LogEvent, TreeNode<EventNode>>;
  /** Maps event ID to its TreeNode */
  nodeMap: Map<string, TreeNode<EventNode>>;
  /** Maps event ID to its parent TreeNode (null for root nodes) */
  parentMap: Map<string, TreeNode<EventNode> | null>;
  /** Maps event ID to sibling info for efficient sibling navigation */
  siblingMap: Map<string, SiblingInfo>;
  /** Maps depth to nodes at that depth (unsorted, will be sorted by TreeNavigator) */
  depthMap: Map<number, TreeNode<EventNode>[]>;
  /** Maps event ID to its depth for quick lookup */
  depthLookup: Map<string, number>;
}

/**
 * Result of tree conversion including nodes and navigation maps.
 */
export interface TreeConversionResult {
  treeNodes: TreeNode<EventNode & { original: LogEvent }>[];
  maps: NavigationMaps;
}

/**
 * Converts LogEvent array to TreeNode array with navigation maps.
 *
 * Recursively traverses event.children to build tree structure.
 * Generates synthetic IDs using timestamp-depth-childIndex to match RectangleManager.
 * Builds all navigation maps during traversal to avoid duplicate O(n) work.
 *
 * **Important:** Events with zero duration are filtered out as they are invisible
 * in the flame chart and would cause navigation issues. Children of zero-duration
 * events are also excluded (branch is truncated).
 *
 * @param events - Array of LogEvent objects
 * @returns TreeConversionResult with tree nodes and navigation maps
 */
export function logEventToTreeNode(events: LogEvent[]): TreeConversionResult {
  const maps: NavigationMaps = {
    originalMap: new Map(),
    nodeMap: new Map(),
    parentMap: new Map(),
    siblingMap: new Map(),
    depthMap: new Map(),
    depthLookup: new Map(),
  };

  const treeNodes = convertEventsRecursive(events, 0, maps, null);

  return { treeNodes, maps };
}

/**
 * Internal recursive function that converts events and populates maps.
 *
 * @param events - Array of LogEvent objects
 * @param depth - Current depth in tree (0-indexed)
 * @param maps - Navigation maps to populate
 * @param parent - Parent TreeNode (null for root nodes)
 * @returns TreeNode array with EventNode data (excluding zero-duration events)
 */
function convertEventsRecursive(
  events: LogEvent[],
  depth: number,
  maps: NavigationMaps,
  parent: TreeNode<EventNode> | null,
): TreeNode<EventNode & { original: LogEvent }>[] {
  const result: TreeNode<EventNode & { original: LogEvent }>[] = [];

  const len = events.length;
  for (let index = 0; index < len; index++) {
    const event = events[index]!;

    // Skip events with zero duration - they are invisible and cause navigation issues
    // Also skip their children (truncate branch) since the parent won't be navigable
    const duration = event.duration.total;
    if (duration <= 0) {
      continue;
    }

    const id = event.timestamp + '-' + depth + '-' + index;
    const children = event.children;

    // Create node first (children will be set after recursive call)
    const node: TreeNode<EventNode & { original: LogEvent }> = {
      data: {
        id,
        timestamp: event.timestamp,
        duration: duration,
        type: event.type ?? event.subCategory ?? 'UNKNOWN',
        text: event.text,
        original: event,
      },
      children: undefined,
      depth,
    };

    // Recursively process children (passing current node as parent)
    if (children) {
      node.children = convertEventsRecursive(children, depth + 1, maps, node);
    }

    result.push(node);

    // Populate maps for this node
    maps.originalMap.set(event, node);
    maps.nodeMap.set(id, node);
    maps.parentMap.set(id, parent);
    maps.depthLookup.set(id, depth);

    // Add to depth map
    let nodesAtDepth = maps.depthMap.get(depth);
    if (!nodesAtDepth) {
      nodesAtDepth = [];
      maps.depthMap.set(depth, nodesAtDepth);
    }
    nodesAtDepth.push(node);
  }

  // Populate sibling map for all nodes in this result array
  // This must happen after the loop so we have the complete siblings array
  for (let i = 0; i < result.length; i++) {
    const node = result[i]!;
    maps.siblingMap.set(node.data.id, {
      index: i,
      siblings: result,
    });
  }

  return result;
}

// ============================================================================
// UNIFIED CONVERSION (Single-Pass Optimization)
// ============================================================================

/**
 * Unified result from single-pass tree conversion and rectangle pre-computation.
 * Contains all data structures needed for FlameChart initialization.
 */
export interface UnifiedConversionResult {
  /** TreeNode hierarchy for navigation and search */
  treeNodes: TreeNode<EventNode & { original: LogEvent }>[];
  /** Navigation maps for O(1) lookups */
  maps: NavigationMaps;
  /** Pre-computed rectangles grouped by category (for RectangleManager) */
  rectsByCategory: Map<string, PrecomputedRect[]>;
  /** Pre-computed rectangles grouped by depth (for TemporalSegmentTree) */
  rectsByDepth: Map<number, PrecomputedRect[]>;
  /** Map from LogEvent to PrecomputedRect (for search functionality) */
  rectMap: Map<LogEvent, PrecomputedRect>;
  /** Maximum depth in tree (tracked during traversal) */
  maxDepth: number;
  /** Total duration in nanoseconds (tracked during traversal) */
  totalDuration: number;
  /** Whether rectsByCategory arrays are pre-sorted by timeStart (skip sorting in RectangleManager) */
  preSorted: boolean;
}

/**
 * Work item for iterative tree conversion.
 * Represents a batch of events to process at a specific depth with a parent.
 */
interface ConversionWorkItem {
  events: LogEvent[];
  depth: number;
  parent: TreeNode<EventNode> | null;
  /** Result array to populate (shared reference for sibling linking) */
  resultArray: TreeNode<EventNode & { original: LogEvent }>[];
}

/**
 * Unified single-pass conversion that builds TreeNodes, navigation maps,
 * and PrecomputedRects in a single O(n) traversal.
 *
 * This eliminates redundant traversals that were previously done by:
 * - logEventToTreeNode (tree conversion + navigation maps)
 * - TimelineEventIndex.calculateMaxDepth (depth calculation)
 * - TimelineEventIndex.calculateTotalDuration (duration calculation)
 * - RectangleManager.flattenEvents (rectangle pre-computation)
 *
 * PERF optimizations in this version:
 * - Iterative with explicit stack (eliminates 500k function calls, ~65ms saved)
 * - Inline sibling map population (eliminates second pass per depth, ~25ms saved)
 * - Pre-groups rectsByDepth (eliminates grouping in TemporalSegmentTree, ~12ms saved)
 *
 * Performance improvement: ~300ms+ savings on 500k event logs.
 *
 * @param events - Array of LogEvent objects
 * @param categories - Set of valid categories for rectangle indexing
 * @returns UnifiedConversionResult with all data structures
 */
export function logEventToTreeAndRects(
  events: LogEvent[],
  categories: Set<string>,
): UnifiedConversionResult {
  const maps: NavigationMaps = {
    originalMap: new Map(),
    nodeMap: new Map(),
    parentMap: new Map(),
    siblingMap: new Map(),
    depthMap: new Map(),
    depthLookup: new Map(),
  };

  // Initialize category arrays for rectangles
  const rectsByCategory = new Map<string, PrecomputedRect[]>();
  for (const category of categories) {
    rectsByCategory.set(category, []);
  }

  // Pre-group by depth for TemporalSegmentTree (eliminates O(n) grouping later)
  const rectsByDepth = new Map<number, PrecomputedRect[]>();

  const rectMap = new Map<LogEvent, PrecomputedRect>();
  const eventHeight = TIMELINE_CONSTANTS.EVENT_HEIGHT;

  // Metrics tracked during traversal
  let maxDepth = 0;
  let totalDuration = 0;

  // Root result array
  const rootResult: TreeNode<EventNode & { original: LogEvent }>[] = [];

  // Track last node at each depth for incremental sibling linking
  // This eliminates the second pass per depth level
  const lastNodeAtDepth = new Map<number, TreeNode<EventNode>>();

  // Iterative traversal using explicit work stack
  // PERF: Eliminates 500k function calls (~65ms saved)
  const workStack: ConversionWorkItem[] = [
    { events, depth: 0, parent: null, resultArray: rootResult },
  ];

  while (workStack.length > 0) {
    const work = workStack.pop()!;
    const { events: currentEvents, depth, parent, resultArray } = work;

    const len = currentEvents.length;
    for (let index = 0; index < len; index++) {
      const event = currentEvents[index]!;

      // Skip events with zero duration - they are invisible and cause navigation issues
      const duration = event.duration.total;
      if (duration <= 0) {
        continue;
      }

      // Track metrics during traversal
      if (depth > maxDepth) {
        maxDepth = depth;
      }
      const exitStamp = event.exitStamp ?? event.timestamp;
      if (exitStamp > totalDuration) {
        totalDuration = exitStamp;
      }

      const id = event.timestamp + '-' + depth + '-' + index;

      // Create TreeNode
      const node: TreeNode<EventNode & { original: LogEvent }> = {
        data: {
          id,
          timestamp: event.timestamp,
          duration: duration,
          type: event.type ?? event.subCategory ?? 'UNKNOWN',
          text: event.text,
          original: event,
        },
        children: undefined,
        depth,
      };

      // Create PrecomputedRect if event has a valid category
      const subCategory = event.subCategory;
      if (subCategory) {
        const rects = rectsByCategory.get(subCategory);
        if (rects) {
          const rect: PrecomputedRect = {
            id,
            timeStart: event.timestamp,
            timeEnd: exitStamp,
            depth,
            duration,
            selfDuration: event.duration.self,
            category: subCategory,
            eventRef: event,
            x: 0,
            y: depth * eventHeight,
            width: 0,
            height: eventHeight,
          };
          rects.push(rect);
          rectMap.set(event, rect);

          // Also add to rectsByDepth (eliminates grouping in TemporalSegmentTree)
          let depthRects = rectsByDepth.get(depth);
          if (!depthRects) {
            depthRects = [];
            rectsByDepth.set(depth, depthRects);
          }
          depthRects.push(rect);
        }
      }

      // PERF: Inline sibling map population (~25ms saved)
      // Track current index in result array for sibling linking
      const currentIndex = resultArray.length;

      // Store sibling info for this node
      maps.siblingMap.set(id, {
        index: currentIndex,
        siblings: resultArray,
      });
      lastNodeAtDepth.set(depth, node);

      resultArray.push(node);

      // Populate navigation maps
      maps.originalMap.set(event, node);
      maps.nodeMap.set(id, node);
      maps.parentMap.set(id, parent);
      maps.depthLookup.set(id, depth);

      // Add to depth map
      let nodesAtDepth = maps.depthMap.get(depth);
      if (!nodesAtDepth) {
        nodesAtDepth = [];
        maps.depthMap.set(depth, nodesAtDepth);
      }
      nodesAtDepth.push(node);

      // Queue children for processing (instead of recursive call)
      const children = event.children;
      if (children && children.length > 0) {
        // Create children array that will be populated when children are processed
        const childrenResult: TreeNode<EventNode & { original: LogEvent }>[] = [];
        node.children = childrenResult;

        workStack.push({
          events: children,
          depth: depth + 1,
          parent: node,
          resultArray: childrenResult,
        });
      }
    }
  }

  // PERF: Pre-sort rectsByCategory arrays by timeStart (~15-20ms saved in RectangleManager)
  // Sort here during conversion to avoid redundant sorting later
  for (const rects of rectsByCategory.values()) {
    rects.sort((a, b) => a.timeStart - b.timeStart);
  }

  return {
    treeNodes: rootResult,
    maps,
    rectsByCategory,
    rectsByDepth,
    rectMap,
    maxDepth,
    totalDuration,
    preSorted: true, // Signal that arrays are pre-sorted
  };
}
