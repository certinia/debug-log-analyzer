/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

/**
 * Tree Converter Utility
 *
 * Converts LogEvent hierarchies to generic TreeNode<EventNode> structures.
 * Enables FlameChart to work with generic event types while maintaining
 * backwards compatibility with existing LogEvent-based code.
 *
 * Also builds navigation maps during traversal to avoid duplicate O(n) work.
 */

import type { LogEvent } from '../../../core/log-parser/LogEvents.js';
import type { EventNode, TreeNode } from '../types/flamechart.types.js';

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
