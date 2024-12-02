import type { LogLine, TimedNode } from '../../../parsers/ApexLogParser';
import { type Metric } from '../../AnalysisView.js';

export function callStackSum(values: number[], data: Metric[], _calcParams: unknown) {
  // All filtered debug logs nodes
  const includedNodes = new Set<TimedNode>();
  data.forEach((row) => {
    row.nodes.forEach((node) => {
      includedNodes.add(node);
    });
  });

  let total = 0;
  data.forEach((row, i) => {
    // All the parents (to root) of the log nodes for this row.
    const parents = _getParentNodes(row.nodes);
    // If any of these parent are else where in the (filtered) stacks do not include in the sum.
    // This value will be included when the parent is summed e.g m1 -> m2 -> m3 (no need to include m2 + m3)
    if (!_containsAny(parents, includedNodes)) {
      total += values[i] ?? 0;
    }
  });

  return total;
}

const _getParentNodes = (nodes: TimedNode[]) => {
  const parents = new Set<LogLine>();
  nodes.forEach((node) => {
    let parent = node.parent;
    while (parent && !parents.has(parent)) {
      parents.add(parent);
      parent = parent.parent;
    }
  });
  return parents;
};

const _containsAny = (target: Set<LogLine>, toCheck: Set<LogLine>) => {
  for (const t of target) {
    if (toCheck.has(t)) {
      return true;
    }
  }
  return false;
};
