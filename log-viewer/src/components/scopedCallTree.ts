/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { LogEvent } from 'apex-log-parser';

import { DatabaseAccess } from '../features/database/services/Database.js';

/** Frame grouping key — same shape as the call-tree aggregation. */
function frameKey(event: LogEvent): string {
  return `${event.type ?? ''}|${event.namespace}|${event.text}`;
}

/**
 * A row in the scoped call tree. `duration` is attributed to the selection (see
 * {@link buildScopedCallTree}); `originalData` is the real event (used by the
 * name formatter / navigation), so its own duration may differ.
 */
export interface ScopedRow {
  id: number;
  originalData: LogEvent;
  text: string;
  type: string;
  duration: { total: number; self: number };
  callCount: number;
  _children: ScopedRow[] | null;
}

export interface ScopedCallTree {
  /** The selected node's total time (ns) — the % denominator for the bars. */
  rootTotal: number;
  timeOrder: ScopedRow[];
  aggregated: ScopedRow[];
  bottomUp: ScopedRow[];
}

/** The selected node + its real subtree, with real durations. */
function realSubtree(event: LogEvent): ScopedRow {
  const kids = event.children;
  return {
    id: event.eventIndex,
    originalData: event,
    text: event.text,
    type: event.type ?? '',
    duration: { total: event.duration.total, self: event.duration.self },
    callCount: 1,
    _children: kids.length ? kids.map(realSubtree) : null,
  };
}

/**
 * The call tree filtered to the selected statement: its ancestor path
 * (root→selected) + the selected node + its real subtree, with sibling branches
 * pruned. Ancestors are attributed to the selection (`total = selected.total`,
 * `self = 0`) so the selection's cost reads "all the way down"; the selected
 * node and its descendants keep their real durations. Returns the three views
 * (time-order / aggregated / bottom-up) or null when nothing is selected.
 */
export function buildScopedCallTree(eventIndex: number): ScopedCallTree | null {
  const db = DatabaseAccess.instance();
  const apexLog = db?.getApexLog();
  const selected = db && eventIndex >= 0 ? db.getEventByIndex(eventIndex) : null;
  if (!db || !apexLog || !selected) {
    return null;
  }

  const rootTotal = selected.duration.total;

  // Wrap the selected node in its ancestor chain, innermost first, attributing
  // the selection's total up the path with no self time.
  let node = realSubtree(selected);
  let parent = selected.parent;
  while (parent && parent !== apexLog) {
    node = {
      id: parent.eventIndex,
      originalData: parent,
      text: parent.text,
      type: parent.type ?? '',
      duration: { total: rootTotal, self: 0 },
      callCount: 1,
      _children: [node],
    };
    parent = parent.parent;
  }

  const timeOrder = [node];
  return {
    rootTotal,
    timeOrder,
    aggregated: aggregate(timeOrder),
    bottomUp: buildBottomUp(timeOrder),
  };
}

/** Top-down aggregation: merge sibling frames sharing a key, summing metrics. */
function aggregate(rows: ScopedRow[]): ScopedRow[] {
  let idSeq = 0;
  const nextId = () => (idSeq -= 1);

  function merge(input: ScopedRow[]): ScopedRow[] {
    const groups = new Map<string, ScopedRow>();
    const order: string[] = [];
    for (const row of input) {
      const key = frameKey(row.originalData);
      let group = groups.get(key);
      if (!group) {
        group = {
          id: nextId(),
          originalData: row.originalData,
          text: row.text,
          type: row.type,
          duration: { total: 0, self: 0 },
          callCount: 0,
          _children: [],
        };
        groups.set(key, group);
        order.push(key);
      }
      group.duration.total += row.duration.total;
      group.duration.self += row.duration.self;
      group.callCount += row.callCount;
      if (row._children) {
        (group._children as ScopedRow[]).push(...row._children);
      }
    }
    return order.map((key) => {
      const group = groups.get(key)!;
      const kids = group._children as ScopedRow[];
      group._children = kids.length ? merge(kids) : null;
      return group;
    });
  }

  return merge(rows);
}

interface BottomUpNode extends ScopedRow {
  _map: Map<string, BottomUpNode>;
}

/**
 * Bottom-up: each frame with self time seeds a top-level row (ranked by self),
 * and its callers nest beneath it up to the root — the reverse of the call
 * path, with the seed's self time attributed to every caller as `total`.
 */
function buildBottomUp(rows: ScopedRow[]): ScopedRow[] {
  let idSeq = 0;
  const nextId = () => (idSeq -= 1);
  const topMap = new Map<string, BottomUpNode>();
  const topOrder: BottomUpNode[] = [];

  const ensure = (map: Map<string, BottomUpNode>, order: BottomUpNode[] | null, src: ScopedRow) => {
    const key = frameKey(src.originalData);
    let node = map.get(key);
    if (!node) {
      node = {
        id: nextId(),
        originalData: src.originalData,
        text: src.text,
        type: src.type,
        duration: { total: 0, self: 0 },
        callCount: 0,
        _children: null,
        _map: new Map(),
      };
      map.set(key, node);
      order?.push(node);
    }
    return node;
  };

  function walk(list: ScopedRow[], path: ScopedRow[]) {
    for (const row of list) {
      if (row.duration.self > 0) {
        // Callee first, then its callers up to the root.
        const chain = [row, ...path.slice().reverse()];
        let map = topMap;
        let order: BottomUpNode[] | null = topOrder;
        for (let i = 0; i < chain.length; i++) {
          const node = ensure(map, order, chain[i]!);
          node.duration.total += row.duration.self;
          if (i === 0) {
            node.duration.self += row.duration.self;
            node.callCount += 1;
          }
          map = node._map;
          order = null;
        }
      }
      if (row._children) {
        walk(row._children, [...path, row]);
      }
    }
  }
  walk(rows, []);

  const finalize = (node: BottomUpNode): ScopedRow => {
    const children = [...node._map.values()].map(finalize);
    return {
      id: node.id,
      originalData: node.originalData,
      text: node.text,
      type: node.type,
      duration: node.duration,
      callCount: node.callCount,
      _children: children.length ? children : null,
    };
  };

  return topOrder.map(finalize).sort((a, b) => b.duration.self - a.duration.self);
}
