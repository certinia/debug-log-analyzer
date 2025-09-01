import type { LogEvent } from '../../../parsers/LogEvents.js';
import type { Metric } from '../AnalysisView.js';

export function callStackSum(_values: number[], data: Metric[], _calcParams: unknown) {
  const nodes: LogEvent[] = [];
  for (const row of data) {
    Array.prototype.push.apply(nodes, row.nodes);
  }
  const allNodes = new Set<LogEvent>(nodes);

  let total = 0;
  for (const node of nodes) {
    if (!_isChildOfOther(node, allNodes)) {
      total += node.duration.total;
    }
  }

  return total;
}

function _isChildOfOther(node: LogEvent, filteredNodes: Set<LogEvent>) {
  let parent = node.parent;
  while (parent) {
    if (filteredNodes.has(parent)) {
      return true;
    }
    parent = parent.parent;
  }

  return false;
}
