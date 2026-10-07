/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * TreeNavigator
 *
 * Provides tree traversal for flame chart frame selection.
 */

import {
  type EventNode,
  NO_ROW,
  type TimelineFrames,
  type TreeNode,
} from '../../types/flamechart.types.js';

/**
 * TreeNavigator enables parent/child/sibling traversal of the shown frames.
 *
 * Usage:
 * ```typescript
 * const navigator = new TreeNavigator(frames);
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
  private frames: TimelineFrames<EventNode>;

  constructor(frames: TimelineFrames<EventNode>) {
    this.frames = frames;
  }

  /**
   * Find a TreeNode by its original reference.
   * Useful for mapping hit test results back to tree nodes.
   *
   * @param original - Original reference (e.g., LogEvent) from hit test
   * @returns The TreeNode, or null if not found
   */
  public findByOriginal(original: unknown): TreeNode<EventNode> | null {
    return this.nodeAt(this.frames.rowOfOriginal(original));
  }

  /**
   * Get the parent of a node (Arrow Up navigation).
   *
   * @param node - Current node
   * @returns Parent node, or null if node is a root
   */
  public getParent(node: TreeNode<EventNode>): TreeNode<EventNode> | null {
    return this.nodeAt(this.frames.parent[node.row]!);
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
    const row = node.row;
    const { start, total, subtreeEnd } = this.frames;
    const parentCenter = start[row]! + total[row]! / 2;

    let closest = NO_ROW;
    let minDistance = Infinity;
    for (let child = row + 1; child < subtreeEnd[row]!; child = subtreeEnd[child]!) {
      if (!this.frames.isVisible(child)) {
        continue;
      }
      const childStart = start[child]!;
      const childEnd = childStart + total[child]!;
      if (parentCenter >= childStart && parentCenter < childEnd) {
        return this.nodeAt(child);
      }
      const distance = Math.abs(childStart + total[child]! / 2 - parentCenter);
      if (distance < minDistance) {
        minDistance = distance;
        closest = child;
      }
    }
    return this.nodeAt(closest);
  }

  /**
   * Get the next sibling of a node (Arrow Right navigation).
   *
   * @param node - Current node
   * @returns Next sibling, or null if node is last sibling
   */
  public getNextSibling(node: TreeNode<EventNode>): TreeNode<EventNode> | null {
    const row = node.row;
    const { parent, subtreeEnd } = this.frames;
    const owner = parent[row]!;
    const end = owner === NO_ROW ? this.frames.rowCount : subtreeEnd[owner]!;
    for (let next = subtreeEnd[row]!; next < end; next = subtreeEnd[next]!) {
      if (this.frames.isVisible(next)) {
        return this.nodeAt(next);
      }
    }
    return null;
  }

  /**
   * Get the previous sibling of a node (Arrow Left navigation).
   *
   * @param node - Current node
   * @returns Previous sibling, or null if node is first sibling
   */
  public getPrevSibling(node: TreeNode<EventNode>): TreeNode<EventNode> | null {
    const row = node.row;
    const { parent, subtreeEnd } = this.frames;
    const owner = parent[row]!;
    // Siblings chain forward only, so walk them from the first up to this one.
    let prev = NO_ROW;
    for (let sibling = owner + 1; sibling < row; sibling = subtreeEnd[sibling]!) {
      if (this.frames.isVisible(sibling)) {
        prev = sibling;
      }
    }
    return this.nodeAt(prev);
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
    const row = node.row;
    const { start, total } = this.frames;
    const rows = this.frames.rowsAtDepth(this.frames.depth[row]!);

    // Binary search for first node that starts at or after current node ends
    // Using < (not <=) to include adjacent frames where one ends exactly where next starts
    const nodeEnd = start[row]! + total[row]!;
    let left = 0;
    let right = rows.length;
    while (left < right) {
      const mid = (left + right) >>> 1;
      if (start[rows[mid]!]! < nodeEnd) {
        left = mid + 1;
      } else {
        right = mid;
      }
    }

    const candidate = rows[left] ?? NO_ROW;
    return candidate === row ? null : this.nodeAt(candidate);
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
    const row = node.row;
    const { start, total } = this.frames;
    const rows = this.frames.rowsAtDepth(this.frames.depth[row]!);

    // Binary search for last node that ends at or before current node starts
    // Using <= to include adjacent frames where one ends exactly where next starts
    const nodeStart = start[row]!;
    let left = 0;
    let right = rows.length;
    while (left < right) {
      const mid = (left + right) >>> 1;
      const midRow = rows[mid]!;
      if (start[midRow]! + total[midRow]! <= nodeStart) {
        left = mid + 1;
      } else {
        right = mid;
      }
    }

    const candidate = rows[left - 1] ?? NO_ROW;
    return candidate === row ? null : this.nodeAt(candidate);
  }

  private nodeAt(row: number): TreeNode<EventNode> | null {
    return row === NO_ROW ? null : this.frames.node(row);
  }
}
