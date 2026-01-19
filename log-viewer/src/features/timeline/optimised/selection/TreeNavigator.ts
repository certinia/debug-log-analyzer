/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

/**
 * TreeNavigator
 *
 * Provides tree traversal for flame chart frame selection.
 * Builds parent and sibling lookup maps during construction
 * to enable O(1) navigation operations.
 *
 * Since TreeNode only has children references (no parent),
 * this class builds the necessary reverse mappings.
 */

import type { LogEvent } from '../../../../core/log-parser/LogEvents.js';
import type { EventNode, TreeNode } from '../../types/flamechart.types.js';

/**
 * Extended EventNode with optional original LogEvent reference.
 */
interface EventNodeWithOriginal extends EventNode {
  original?: LogEvent;
}

/**
 * Stores sibling information for a node.
 */
interface SiblingInfo {
  /** Index in parent's children array (or root array) */
  index: number;
  /** Reference to siblings array (parent.children or root array) */
  siblings: TreeNode<EventNode>[];
}

/**
 * TreeNavigator enables parent/child/sibling traversal of TreeNode structures.
 *
 * Usage:
 * ```typescript
 * const navigator = new TreeNavigator(rootNodes);
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
  private nodeMap: Map<string, TreeNode<EventNode>> = new Map();

  /** Maps event ID to its parent TreeNode (null for root nodes) */
  private parentMap: Map<string, TreeNode<EventNode> | null> = new Map();

  /** Maps event ID to sibling info for efficient sibling navigation */
  private siblingMap: Map<string, SiblingInfo> = new Map();

  /** Maps original LogEvent to TreeNode for hit test lookup */
  private originalMap: Map<LogEvent, TreeNode<EventNode>> = new Map();

  /**
   * Construct a TreeNavigator from root nodes.
   * Builds all lookup maps during construction.
   *
   * @param rootNodes - Array of root-level TreeNodes
   */
  constructor(rootNodes: TreeNode<EventNode>[]) {
    this.buildMaps(rootNodes);
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
   * Find a TreeNode by its original LogEvent reference.
   * Useful for mapping hit test results back to tree nodes.
   *
   * @param logEvent - Original LogEvent from hit test
   * @returns The TreeNode, or null if not found
   */
  public findByOriginal(logEvent: LogEvent): TreeNode<EventNode> | null {
    return this.originalMap.get(logEvent) ?? null;
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
   * Build all lookup maps by traversing the tree.
   *
   * @param rootNodes - Array of root-level TreeNodes
   */
  private buildMaps(rootNodes: TreeNode<EventNode>[]): void {
    // Process root nodes (parent is null, siblings are the root array)
    for (let i = 0; i < rootNodes.length; i++) {
      const node = rootNodes[i];
      if (!node) continue;

      this.nodeMap.set(node.data.id, node);
      this.parentMap.set(node.data.id, null);
      this.siblingMap.set(node.data.id, {
        index: i,
        siblings: rootNodes,
      });

      // Map original LogEvent if available
      const nodeData = node.data as EventNodeWithOriginal;
      if (nodeData.original) {
        this.originalMap.set(nodeData.original, node);
      }

      // Recursively process children
      this.processChildren(node);
    }
  }

  /**
   * Recursively process children of a node.
   *
   * @param parent - Parent node whose children to process
   */
  private processChildren(parent: TreeNode<EventNode>): void {
    if (!parent.children || parent.children.length === 0) {
      return;
    }

    for (let i = 0; i < parent.children.length; i++) {
      const child = parent.children[i];
      if (!child) continue;

      this.nodeMap.set(child.data.id, child);
      this.parentMap.set(child.data.id, parent);
      this.siblingMap.set(child.data.id, {
        index: i,
        siblings: parent.children,
      });

      // Map original LogEvent if available
      const childData = child.data as EventNodeWithOriginal;
      if (childData.original) {
        this.originalMap.set(childData.original, child);
      }

      // Recursively process grandchildren
      this.processChildren(child);
    }
  }
}
