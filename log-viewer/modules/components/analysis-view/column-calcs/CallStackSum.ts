import type { LogLine } from '../../../parsers/ApexLogParser';
import type { Metric } from '../AnalysisView.js';

export function callStackSum(_values: number[], data: Metric[], _calcParams: unknown) {
  const nodes: LogLine[] = [];
  for (const row of data) {
    Array.prototype.push.apply(nodes, row.nodes);
  }
  const allNodes = new Set<LogLine>(nodes);

  let total = 0;
  for (const node of nodes) {
    if (!_isChildOfOther(node, allNodes)) {
      total += node.duration.total;
    }
  }

  return total;
}

function _isChildOfOther(node: LogLine, filteredNodes: Set<LogLine>) {
  let parent = node.parent;
  while (parent) {
    if (filteredNodes.has(parent)) {
      return true;
    }
    parent = parent.parent;
  }

  return false;
}
