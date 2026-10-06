/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { LogEvent } from '@apexdevtools/apex-log-parser';

import {
  type EventNode,
  NO_ROW,
  type TimelineFrames,
  type TreeNode,
} from '../../features/timeline/types/flamechart.types.js';

/** A frame laid out by hand, with the children {@link navFrames} reads it by. */
export interface NavNode extends TreeNode<EventNode> {
  children?: NavNode[];
}

/** A frame with its own stand-in for the parsed event, as the adapter attaches one. */
export function navNode(
  id: string,
  timestamp: number,
  duration: number,
  depth: number,
  children?: NavNode[],
): NavNode {
  const original = { id } as unknown as LogEvent;
  return {
    data: { id, timestamp, duration, type: 'METHOD_ENTRY', text: id, original },
    children,
    depth,
    row: NO_ROW,
  };
}

/**
 * The frames for a tree a test lays out by hand, rows in pre-order. A frame is
 * shown when it and every parent have a duration, as the timeline's own are.
 * `node` hands back the test's own node, so a test can compare by identity.
 */
export function navFrames(roots: NavNode[]): TimelineFrames<EventNode> {
  const nodes: NavNode[] = [];
  const parents: number[] = [];
  const ends: number[] = [];
  const shown: boolean[] = [];
  const visit = (node: NavNode, parent: number): void => {
    const row = nodes.length;
    node.row = row;
    nodes.push(node);
    parents.push(parent);
    ends.push(row + 1);
    shown.push(node.data.duration > 0 && (parent === NO_ROW || shown[parent]!));
    node.children?.forEach((child) => visit(child, row));
    ends[row] = nodes.length;
  };
  roots.forEach((root) => visit(root, NO_ROW));

  const start = Float64Array.from(nodes, (node) => node.data.timestamp);
  const depth = Uint16Array.from(nodes, (node) => node.depth ?? 0);
  const byDepth: number[][] = [];
  nodes.forEach((_, row) => {
    if (shown[row]) {
      (byDepth[depth[row]!] ??= []).push(row);
    }
  });
  const byOriginal = new Map(nodes.map((node, row) => [node.data.original, row]));

  return {
    rowCount: nodes.length,
    maxDepth: Math.max(0, ...depth),
    totalDuration: 0,
    start,
    total: Float64Array.from(nodes, (node) => node.data.duration),
    depth,
    parent: Int32Array.from(parents),
    subtreeEnd: Int32Array.from(ends),
    rectsByCategory: new Map(),
    rectsByDepth: new Map(),
    isVisible: (row) => shown[row] ?? false,
    rowsAtDepth: (d) => Int32Array.from((byDepth[d] ?? []).sort((x, y) => start[x]! - start[y]!)),
    node: (row) => nodes[row]!,
    text: (row) => nodes[row]!.data.text,
    type: (row) => nodes[row]!.data.type,
    rowOfOriginal: (original) => {
      const row = byOriginal.get(original) ?? NO_ROW;
      return shown[row] ? row : NO_ROW;
    },
    rectOf: () => undefined,
  };
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
  return { roots, frames: navFrames(roots), nodes: { a, b, c, d, e, f, g } };
}

export type NavName = keyof ReturnType<typeof navFixture>['nodes'];
