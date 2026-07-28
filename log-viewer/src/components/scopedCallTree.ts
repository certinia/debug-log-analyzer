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
  /** The three views are built on first read and cached (only one is visible). */
  readonly timeOrder: ScopedRow[];
  readonly aggregated: ScopedRow[];
  readonly bottomUp: ScopedRow[];
  /** True when a subtree hit {@link NODE_BUDGET} and was cut short. */
  truncated: boolean;
}

/**
 * Cap on materialised nodes per selection. A broad frame selected as an
 * aggregate would otherwise expand `occurrences × whole subtree` — millions of
 * nodes on a large log — blocking the UI thread well past the 50ms budget.
 */
const NODE_BUDGET = 20_000;

interface Budget {
  left: number;
  truncated: boolean;
}

/** The selected node + its real subtree, with real durations, within `budget`. */
function realSubtree(event: LogEvent, budget: Budget): ScopedRow {
  const row: ScopedRow = {
    id: event.eventIndex,
    originalData: event,
    text: event.text,
    type: event.type ?? '',
    duration: { total: event.duration.total, self: event.duration.self },
    callCount: 1,
    _children: null,
  };
  budget.left -= 1;

  // Check the budget per child, not just before descending: a single node can
  // have more direct children than the whole budget allows.
  const children: ScopedRow[] = [];
  for (const kid of event.children) {
    if (budget.left <= 0) {
      // Keep the nodes built so far (their totals are intact) and stop.
      budget.truncated = true;
      break;
    }
    children.push(realSubtree(kid, budget));
  }
  row._children = children.length ? children : null;
  return row;
}

/**
 * The call tree filtered to the selected statement: its ancestor path
 * (root→selected) + the selected node + its real subtree, with sibling branches
 * pruned. Ancestors are attributed to the selection (`total = selected.total`,
 * `self = 0`) so the selection's cost reads "all the way down"; the selected
 * node and its descendants keep their real durations. Returns the three views
 * (time-order / aggregated / bottom-up) or null when nothing is selected.
 */
export function buildScopedCallTree(
  eventIndex: number,
  instances?: number[] | null,
): ScopedCallTree | null {
  const db = DatabaseAccess.instance();
  const apexLog = db?.getApexLog();
  if (!db || !apexLog) {
    return null;
  }

  // An aggregate selection scopes to every occurrence of the frame; a single
  // selection to just itself.
  const indexes = instances?.length ? instances : eventIndex >= 0 ? [eventIndex] : [];
  const selectedEvents = indexes
    .map((i) => db.getEventByIndex(i))
    .filter((e): e is LogEvent => e !== null);
  if (!selectedEvents.length) {
    return null;
  }

  // Percentages are relative to the whole selection (summed across occurrences).
  const rootTotal = selectedEvents.reduce((sum, e) => sum + e.duration.total, 0);

  // Wrap each occurrence in its ancestor chain, innermost first, attributing that
  // occurrence's total up its path with no self time. Aggregation then merges
  // paths that share frames.
  const budget: Budget = { left: NODE_BUDGET, truncated: false };
  const roots = selectedEvents.map((selected) => {
    let node = realSubtree(selected, budget);
    let parent = selected.parent;
    while (parent && parent !== apexLog) {
      node = {
        id: parent.eventIndex,
        originalData: parent,
        text: parent.text,
        type: parent.type ?? '',
        duration: { total: selected.duration.total, self: 0 },
        callCount: 1,
        _children: [node],
      };
      parent = parent.parent;
    }
    return node;
  });

  // Only one view is on screen, so build each on first read and cache it —
  // aggregate()/buildBottomUp() are full walks of every retained subtree.
  let timeOrder: ScopedRow[] | null = null;
  let aggregated: ScopedRow[] | null = null;
  let bottomUp: ScopedRow[] | null = null;
  return {
    rootTotal,
    truncated: budget.truncated,
    get timeOrder(): ScopedRow[] {
      // Many occurrences usually share ancestors, so merge the paths for a
      // readable tree; a single occurrence keeps its exact chain.
      timeOrder ??= roots.length > 1 ? aggregate(roots) : roots;
      return timeOrder;
    },
    get aggregated(): ScopedRow[] {
      aggregated ??= aggregate(roots);
      return aggregated;
    },
    get bottomUp(): ScopedRow[] {
      bottomUp ??= buildBottomUp(roots);
      return bottomUp;
    },
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
