/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { EventNode, TreeNode } from '../../features/timeline/types/flamechart.types.js';
import type { NavigationMaps } from '../../features/timeline/utils/tree-converter.js';

/** An `EventNode` whose id also sets its start time. */
export function eventNode(id: string, text: string = `Event ${id}`): EventNode {
  return {
    id,
    timestamp: parseInt(id) * 1000,
    duration: 1000,
    type: 'METHOD_ENTRY',
    text,
  };
}

/** A tree node wrapping `event`. */
export function createNode(
  event: EventNode,
  children?: TreeNode<EventNode>[],
  depth = 0,
): TreeNode<EventNode> {
  return {
    data: event,
    children,
    depth,
  };
}

/** The navigation maps `logEventToTreeNode` builds, for nodes made by hand. */
export function buildMapsFromNodes(rootNodes: TreeNode<EventNode>[]): NavigationMaps {
  const maps: NavigationMaps = {
    originalMap: new Map(),
    nodeMap: new Map(),
    parentMap: new Map(),
    siblingMap: new Map(),
    depthMap: new Map(),
    depthLookup: new Map(),
  };

  function processNode(
    node: TreeNode<EventNode>,
    parent: TreeNode<EventNode> | null,
    siblings: TreeNode<EventNode>[],
    siblingIndex: number,
  ): void {
    const depth = node.depth ?? 0;
    maps.nodeMap.set(node.data.id, node);
    maps.parentMap.set(node.data.id, parent);
    maps.siblingMap.set(node.data.id, { index: siblingIndex, siblings });
    maps.depthLookup.set(node.data.id, depth);

    let nodesAtDepth = maps.depthMap.get(depth);
    if (!nodesAtDepth) {
      nodesAtDepth = [];
      maps.depthMap.set(depth, nodesAtDepth);
    }
    nodesAtDepth.push(node);

    if (node.children) {
      for (let i = 0; i < node.children.length; i++) {
        processNode(node.children[i]!, node, node.children, i);
      }
    }
  }

  for (let i = 0; i < rootNodes.length; i++) {
    processNode(rootNodes[i]!, null, rootNodes, i);
  }

  return maps;
}
