/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { LogEvent } from '@apexdevtools/apex-log-parser';

import type { EventNode, TreeNode } from '../../features/timeline/types/flamechart.types.js';
import type { NavigationMaps } from '../../features/timeline/utils/tree-converter.js';

/** A frame with its own stand-in for the parsed event, as the adapter attaches one. */
export function navNode(
  id: string,
  timestamp: number,
  duration: number,
  depth: number,
  children?: TreeNode<EventNode>[],
): TreeNode<EventNode> {
  const original = { id } as unknown as LogEvent;
  return {
    data: { id, timestamp, duration, type: 'METHOD_ENTRY', text: id, original },
    children,
    depth,
  };
}

/**
 * The maps the tree converters build, for a tree a test lays out by hand. Each depth list is
 * kept newest first, since the converters leave it unsorted and `TreeNavigator` sorts it.
 */
export function navMaps(roots: TreeNode<EventNode>[]): NavigationMaps {
  const maps: NavigationMaps = {
    originalMap: new Map(),
    nodeMap: new Map(),
    parentMap: new Map(),
    siblingMap: new Map(),
    depthMap: new Map(),
    depthLookup: new Map(),
  };

  const visit = (
    node: TreeNode<EventNode>,
    parent: TreeNode<EventNode> | null,
    siblings: TreeNode<EventNode>[],
    index: number,
  ): void => {
    const depth = node.depth ?? 0;
    const { id, original } = node.data;
    maps.nodeMap.set(id, node);
    maps.parentMap.set(id, parent);
    maps.siblingMap.set(id, { index, siblings });
    maps.depthLookup.set(id, depth);
    maps.depthMap.set(depth, [node, ...(maps.depthMap.get(depth) ?? [])]);
    maps.originalMap.set(original as LogEvent, node);
    node.children?.forEach((child, i, all) => visit(child, node, all, i));
  };
  roots.forEach((root, i) => visit(root, null, roots, i));

  return maps;
}

/**
 * Two roots, each with two children; one grandchild under `c`.
 *
 * ```
 * depth 2:  [g]
 * depth 1: [c ][d ]      [e ][f ]
 * depth 0: [   a   ]     [   b   ]
 *          0  100  200  300 400  500
 * ```
 */
export function navFixture() {
  const g = navNode('g', 30, 40, 2);
  const c = navNode('c', 0, 100, 1, [g]);
  const d = navNode('d', 100, 100, 1);
  const e = navNode('e', 300, 100, 1);
  const f = navNode('f', 400, 100, 1);
  const a = navNode('a', 0, 200, 0, [c, d]);
  const b = navNode('b', 300, 200, 0, [e, f]);
  const roots = [a, b];
  return { roots, maps: navMaps(roots), nodes: { a, b, c, d, e, f, g } };
}

export type NavName = keyof ReturnType<typeof navFixture>['nodes'];
