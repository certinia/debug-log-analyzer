/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

/**
 * SearchManager
 *
 * Generic search manager for timeline events.
 * Decoupled from LogEvent-specific implementation, works with any EventNode type.
 *
 * Responsibilities:
 * - Traverse tree structure using TreeNode
 * - Apply predicate function to find matches
 * - Build SearchCursor with matched events and rendering data
 * - Track current search state
 */

import type { EventNode, TreeNode } from '../../types/flamechart.types.js';
import type { SearchCursor, SearchMatch, SearchOptions } from '../../types/search.types.js';
import type { PrecomputedRect } from '../RectangleManager.js';
import { SearchCursorImpl } from './SearchCursor.js';

export class SearchManager<E extends EventNode> {
  private rectMap: Map<string, PrecomputedRect>;
  private currentCursor?: SearchCursorImpl<E>;
  private roots: TreeNode<E>[];

  constructor(roots: TreeNode<E>[], rectMap: Map<string, PrecomputedRect>) {
    this.roots = roots;
    this.rectMap = rectMap;
  }

  /**
   * Search events using predicate function.
   *
   * @param predicate - Function to test each event
   * @param options - Search options (caseSensitive, matchWholeWord)
   * @returns SearchCursor for navigating results
   */
  search(predicate: (event: E) => boolean, _options: SearchOptions = {}): SearchCursor<E> {
    const matches = this.traverse(this.roots, predicate);
    this.currentCursor = new SearchCursorImpl(matches);
    return this.currentCursor;
  }

  /**
   * Clear current search and reset cursor.
   */
  clear(): void {
    this.currentCursor = undefined;
  }

  /**
   * Get current search cursor (if any).
   *
   * @returns Current cursor or undefined if no active search
   */
  getCursor(): SearchCursor<E> | undefined {
    return this.currentCursor;
  }

  /**
   * Traverse tree and collect matches.
   *
   * Uses depth-first traversal to maintain event order.
   * Skips events without rendering data (culled or off-screen).
   *
   * @param nodes - Current level nodes
   * @param predicate - Function to test each event
   * @param depth - Current depth (for depth tracking)
   * @param matches - Accumulated matches
   * @returns Array of matches with rendering data
   */
  private traverse(
    nodes: TreeNode<E>[],
    predicate: (event: E) => boolean,
    depth = 0,
    matches: SearchMatch<E>[] = [],
  ): SearchMatch<E>[] {
    for (const node of nodes) {
      if (predicate(node.data)) {
        const rect = this.rectMap.get(node.data.id);
        if (rect) {
          matches.push({
            event: node.data,
            rect,
            depth: node.depth ?? depth,
            matchType: 'text',
          });
        }
      }

      if (node.children && node.children.length > 0) {
        this.traverse(node.children, predicate, depth + 1, matches);
      }
    }
    return matches;
  }
}
