/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * TreeNavigator
 *
 * Provides tree traversal for flame chart frame selection.
 * Uses pre-built navigation maps for O(1) lookup operations.
 *
 * Maps are built during tree conversion (logEventToTreeNode) to avoid
 * duplicate O(n) traversal work.
 */

import type { EventNode, TreeNode } from '../../types/flamechart.types.js';
import type { NavigationMaps, SiblingInfo } from '../../utils/tree-converter.js';

/**
 * TreeNavigator enables parent/child/sibling traversal of TreeNode structures.
 *
 * Usage:
 * ```typescript
 * const { treeNodes, maps } = logEventToTreeNode(events);
 * const navigator = new TreeNavigator(treeNodes, maps);
 *
 * // Find a node by its event ID
 * const node = navigator.findById('event-123');
 *
 * // Get parent (for flame chart: Arrow Down = visually down to parent)
 * const parent = navigator.getParent(node);
 *
 * // Get child (for flame chart: Arrow Up = visually up to children)
 * const child = navigator.getChildAtCenter(node);
 *
 * // Navigate left/right (Arrow Left/Right)
 * const next = navigator.getNextSibling(node);
 * const prev = navigator.getPrevSibling(node);
 * ```
 */
export class TreeNavigator {
  /** Maps event ID to its TreeNode */
  private nodeMap: Map<string, TreeNode<EventNode>>;

  /** Maps event ID to its parent TreeNode (null for root nodes) */
  private parentMap: Map<string, TreeNode<EventNode> | null>;

  /** Maps event ID to sibling info for efficient sibling navigation */
  private siblingMap: Map<string, SiblingInfo>;

  /** Maps original reference to TreeNode for hit test lookup */
  private originalMap: Map<unknown, TreeNode<EventNode>>;

  /** Maps depth to nodes at that depth, sorted by timestamp for cross-parent navigation */
  private depthMap: Map<number, TreeNode<EventNode>[]>;

  /** Maps event ID to its depth for quick lookup */
  private depthLookup: Map<string, number>;

  /**
   * Construct a TreeNavigator from pre-built navigation maps.
   * Maps are built during tree conversion (logEventToTreeNode).
   *
   * @param rootNodes - Array of root-level TreeNodes (unused, kept for API compatibility)
   * @param maps - Pre-built navigation maps from tree conversion
   */
  constructor(_rootNodes: TreeNode<EventNode>[], maps: NavigationMaps) {
    this.originalMap = maps.originalMap;
    this.nodeMap = maps.nodeMap;
    this.parentMap = maps.parentMap;
    this.siblingMap = maps.siblingMap;
    this.depthMap = maps.depthMap;
    this.depthLookup = maps.depthLookup;

    // Sort each depth array by timestamp for efficient binary search
    for (const nodesAtDepth of this.depthMap.values()) {
      nodesAtDepth.sort((a, b) => a.data.timestamp - b.data.timestamp);
    }
  }

  /**
   * Find a TreeNode by its event ID.
   *
   * @param id - Event ID to search for
   * @returns The TreeNode, or null if not found
   */
  public findById(id: string): TreeNode<EventNode> | null {
    return this.nodeMap.get(id) ?? null;
  }

  /**
   * Find a TreeNode by its original reference.
   * Useful for mapping hit test results back to tree nodes.
   *
   * @param original - Original reference (e.g., LogEvent) from hit test
   * @returns The TreeNode, or null if not found
   */
  public findByOriginal(original: unknown): TreeNode<EventNode> | null {
    return this.originalMap.get(original) ?? null;
  }

  /**
   * Get the parent of a node (Arrow Up navigation).
   *
   * @param node - Current node
   * @returns Parent node, or null if node is a root
   */
  public getParent(node: TreeNode<EventNode>): TreeNode<EventNode> | null {
    return this.parentMap.get(node.data.id) ?? null;
  }

  /**
   * Get the first child of a node (Arrow Down navigation).
   *
   * @param node - Current node
   * @returns First child node, or null if node is a leaf
   */
  public getFirstChild(node: TreeNode<EventNode>): TreeNode<EventNode> | null {
    if (!node.children || node.children.length === 0) {
      return null;
    }
    return node.children[0] ?? null;
  }

  /**
   * Get the child whose time range contains the center of the parent's time range.
   * Falls back to closest child if no exact overlap.
   *
   * Chrome DevTools behavior: selects child that overlaps with the center of current frame,
   * rather than always selecting the leftmost child.
   *
   * @param node - Current node
   * @returns Child node at center, or null if node is a leaf
   */
  public getChildAtCenter(node: TreeNode<EventNode>): TreeNode<EventNode> | null {
    if (!node.children || node.children.length === 0) {
      return null;
    }

    const parentCenter = node.data.timestamp + node.data.duration / 2;

    // Find child containing the center point
    for (const child of node.children) {
      const childStart = child.data.timestamp;
      const childEnd = childStart + child.data.duration;
      if (parentCenter >= childStart && parentCenter < childEnd) {
        return child;
      }
    }

    // Fallback: find closest child to center
    let closest = node.children[0]!;
    let minDistance = Infinity;
    for (const child of node.children) {
      const childCenter = child.data.timestamp + child.data.duration / 2;
      const distance = Math.abs(childCenter - parentCenter);
      if (distance < minDistance) {
        minDistance = distance;
        closest = child;
      }
    }
    return closest;
  }

  /**
   * Get the next sibling of a node (Arrow Right navigation).
   *
   * @param node - Current node
   * @returns Next sibling, or null if node is last sibling
   */
  public getNextSibling(node: TreeNode<EventNode>): TreeNode<EventNode> | null {
    const siblingInfo = this.siblingMap.get(node.data.id);
    if (!siblingInfo) {
      return null;
    }

    const nextIndex = siblingInfo.index + 1;
    if (nextIndex >= siblingInfo.siblings.length) {
      return null;
    }

    return siblingInfo.siblings[nextIndex] ?? null;
  }

  /**
   * Get the previous sibling of a node (Arrow Left navigation).
   *
   * @param node - Current node
   * @returns Previous sibling, or null if node is first sibling
   */
  public getPrevSibling(node: TreeNode<EventNode>): TreeNode<EventNode> | null {
    const siblingInfo = this.siblingMap.get(node.data.id);
    if (!siblingInfo) {
      return null;
    }

    const prevIndex = siblingInfo.index - 1;
    if (prevIndex < 0) {
      return null;
    }

    return siblingInfo.siblings[prevIndex] ?? null;
  }

  /**
   * Get the next node at the same depth (cross-parent navigation).
   * Used when getNextSibling() returns null to continue navigation
   * to frames with different parents.
   *
   * @param node - Current node
   * @returns Next node at same depth, or null if at end
   */
  public getNextAtDepth(node: TreeNode<EventNode>): TreeNode<EventNode> | null {
    const depth = this.depthLookup.get(node.data.id);
    if (depth === undefined) {
      return null;
    }

    const nodesAtDepth = this.depthMap.get(depth);
    if (!nodesAtDepth || nodesAtDepth.length === 0) {
      return null;
    }

    // Binary search for first node that starts at or after current node ends
    // Using < (not <=) to include adjacent frames where one ends exactly where next starts
    const nodeEnd = node.data.timestamp + node.data.duration;
    let left = 0;
    let right = nodesAtDepth.length;

    while (left < right) {
      const mid = Math.floor((left + right) / 2);
      const midNode = nodesAtDepth[mid]!;
      if (midNode.data.timestamp < nodeEnd) {
        left = mid + 1;
      } else {
        right = mid;
      }
    }

    // left is now the index of the first node starting at or after nodeEnd
    if (left >= nodesAtDepth.length) {
      return null;
    }

    const candidate = nodesAtDepth[left];
    // Make sure we don't return the same node
    if (candidate && candidate.data.id !== node.data.id) {
      return candidate;
    }
    return null;
  }

  /**
   * Get the previous node at the same depth (cross-parent navigation).
   * Used when getPrevSibling() returns null to continue navigation
   * to frames with different parents.
   *
   * @param node - Current node
   * @returns Previous node at same depth, or null if at start
   */
  public getPrevAtDepth(node: TreeNode<EventNode>): TreeNode<EventNode> | null {
    const depth = this.depthLookup.get(node.data.id);
    if (depth === undefined) {
      return null;
    }

    const nodesAtDepth = this.depthMap.get(depth);
    if (!nodesAtDepth || nodesAtDepth.length === 0) {
      return null;
    }

    // Binary search for last node that ends at or before current node starts
    // Using <= to include adjacent frames where one ends exactly where next starts
    const nodeStart = node.data.timestamp;
    let left = 0;
    let right = nodesAtDepth.length;

    while (left < right) {
      const mid = Math.floor((left + right) / 2);
      const midNode = nodesAtDepth[mid]!;
      const midEnd = midNode.data.timestamp + midNode.data.duration;
      if (midEnd <= nodeStart) {
        left = mid + 1;
      } else {
        right = mid;
      }
    }

    // left-1 is the index of the last node ending at or before nodeStart
    const prevIndex = left - 1;
    if (prevIndex < 0) {
      return null;
    }

    const candidate = nodesAtDepth[prevIndex];
    // Make sure we don't return the same node
    if (candidate && candidate.data.id !== node.data.id) {
      return candidate;
    }
    return null;
  }
}
