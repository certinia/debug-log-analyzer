/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

/**
 * SelectionManager
 *
 * Owns selection state and logic for flame chart frame selection.
 * Encapsulates TreeNavigator and provides a clean API for selection operations.
 *
 * Responsibilities:
 * - Owns selectedNode state
 * - Owns TreeNavigator instance (internal)
 * - Provides selection lifecycle (select, clear, navigate)
 * - Maps LogEvent to TreeNode for hit test integration
 */

import type { LogEvent } from '../../../../core/log-parser/LogEvents.js';
import type { EventNode, TreeNode } from '../../types/flamechart.types.js';
import type { NavigationMaps } from '../../utils/tree-converter.js';
import type { FrameNavDirection } from '../interaction/KeyboardHandler.js';
import { TreeNavigator } from './TreeNavigator.js';

export class SelectionManager<E extends EventNode> {
  /** Currently selected node */
  private selectedNode: TreeNode<E> | null = null;

  /** Tree navigator for traversal operations */
  private navigator: TreeNavigator;

  /**
   * Create a SelectionManager from tree nodes and pre-built maps.
   *
   * @param treeNodes - Root-level TreeNodes to navigate
   * @param maps - Pre-built navigation maps from tree conversion
   */
  constructor(treeNodes: TreeNode<E>[], maps: NavigationMaps) {
    this.navigator = new TreeNavigator(treeNodes as TreeNode<EventNode>[], maps);
  }

  /**
   * Select a tree node.
   *
   * @param node - TreeNode to select
   */
  public select(node: TreeNode<E>): void {
    this.selectedNode = node;
  }

  /**
   * Clear the current selection.
   */
  public clear(): void {
    this.selectedNode = null;
  }

  /**
   * Navigate from current selection in the specified direction.
   * Returns the new node if navigation was successful, null if at boundary.
   *
   * For left/right navigation: tries siblings first, then falls back to
   * cross-parent navigation at the same depth (Chrome DevTools behavior).
   *
   * @param direction - Navigation direction ('up', 'down', 'left', 'right')
   * @returns New selected node, or null if at boundary or no selection
   */
  public navigate(direction: FrameNavDirection): TreeNode<E> | null {
    if (!this.selectedNode) {
      return null;
    }

    const currentNode = this.selectedNode as TreeNode<EventNode>;
    let nextNode: TreeNode<EventNode> | null = null;

    switch (direction) {
      case 'up':
        // Visual up = into children (flame charts render depth 0 at bottom)
        nextNode = this.navigator.getChildAtCenter(currentNode);
        break;
      case 'down':
        // Visual down = to parent
        nextNode = this.navigator.getParent(currentNode);
        break;
      case 'left':
        // Try sibling first, then cross-parent at same depth
        nextNode = this.navigator.getPrevSibling(currentNode);
        if (!nextNode) {
          nextNode = this.navigator.getPrevAtDepth(currentNode);
        }
        break;
      case 'right':
        // Try sibling first, then cross-parent at same depth
        nextNode = this.navigator.getNextSibling(currentNode);
        if (!nextNode) {
          nextNode = this.navigator.getNextAtDepth(currentNode);
        }
        break;
    }

    if (nextNode) {
      this.selectedNode = nextNode as TreeNode<E>;
      return this.selectedNode;
    }

    return null;
  }

  /**
   * Get the currently selected node.
   *
   * @returns Currently selected TreeNode, or null if none
   */
  public getSelected(): TreeNode<E> | null {
    return this.selectedNode;
  }

  /**
   * Check if there is an active selection.
   *
   * @returns true if a node is selected
   */
  public hasSelection(): boolean {
    return this.selectedNode !== null;
  }

  /**
   * Find a TreeNode by its original LogEvent reference.
   * Used to map hit test results back to tree nodes for selection.
   *
   * @param logEvent - Original LogEvent from hit test
   * @returns The TreeNode, or null if not found
   */
  public findByOriginal(logEvent: LogEvent): TreeNode<E> | null {
    return this.navigator.findByOriginal(logEvent) as TreeNode<E> | null;
  }

  /**
   * Find a TreeNode by its event ID.
   *
   * @param id - Event ID to search for
   * @returns The TreeNode, or null if not found
   */
  public findById(id: string): TreeNode<E> | null {
    return this.navigator.findById(id) as TreeNode<E> | null;
  }
}
