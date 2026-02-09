/*
 * Copyright (c) 2024 Certinia Inc. All rights reserved.
 */

import type { LogEvent } from 'apex-log-parser';
import type { Metric } from '../../analysis/services/RowGrouper.js';

/**
 * Calculates the sum of total execution time for root nodes only (nodes without ancestors in the set).
 * This prevents double-counting when multiple nodes from the same call chain are present in the filtered set.
 *
 * For each node, walks up the parent chain to check if any ancestor is also in the node set.
 * Only nodes without ancestors contribute their totalTime to the sum.
 *
 * @param _values - Unused parameter (required by Tabulator's calc function signature)
 * @param data - Array of Metric objects containing the nodes to sum
 * @param _calcParams - Unused parameter (required by Tabulator's calc function signature)
 * @returns The sum of totalTime in nanoseconds for all root nodes (nodes without ancestors in the set)
 *
 * @example
 * ```typescript
 * // If we have nodes: A -> B -> C and the filtered set contains [B, C]
 * // Only B's time is counted (C is excluded because B is its ancestor)
 * const total = sumRootNodesOnly([], [metricB, metricC], {});
 * ```
 *
 * @remarks
 * This function is designed as a Tabulator column calc function, hence the unused parameters.
 * It's used to calculate accurate totals in analysis tables where filtered results may include
 * nodes from the same call stack.
 */
export function sumRootNodesOnly(_values: number[], data: Metric[], _calcParams: unknown) {
  const allNodes = new Set<LogEvent>();
  for (const row of data) {
    for (const node of row.nodes) {
      allNodes.add(node);
    }
  }

  let total = 0;
  for (const node of allNodes) {
    let parent = node.parent;
    let hasAncestor = false;

    while (parent) {
      if (allNodes.has(parent)) {
        hasAncestor = true;
        break;
      }
      parent = parent.parent;
    }

    if (!hasAncestor) {
      total += node.duration.total;
    }
  }

  return total;
}
