/*
 * Copyright (c) 2024 Certinia Inc. All rights reserved.
 */

import type { LogEvent } from 'apex-log-parser';
import type { Metric } from '../../analysis/services/RowGrouper.js';

/**
 * Sums `duration.total` over the union of `eventGroups`, counting each event only
 * when no ancestor of that event is also in the union. This prevents double-counting
 * when multiple events from the same call chain are present in the filtered set.
 *
 * Used by both AnalysisView (rows = `Metric` with `nodes`) and BottomUpTable (rows
 * = `BottomUpRow` with `instances`).
 */
export function sumDurationTotalForRootEvents(eventGroups: Iterable<LogEvent[]>): number {
  const allNodes = new Set<LogEvent>();
  for (const group of eventGroups) {
    for (const node of group) {
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

/**
 * Tabulator `bottomCalc` adapter for AnalysisView: passes each `Metric.nodes` array
 * to {@link sumDurationTotalForRootEvents}. See that helper for the algorithm.
 */
export function sumRootNodesOnly(_values: number[], data: Metric[], _calcParams: unknown): number {
  return sumDurationTotalForRootEvents(data.map((row) => row.nodes));
}
