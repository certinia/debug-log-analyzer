/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { LogEvent } from 'apex-log-parser';

import { EXCLUDED_DETAIL_TYPES } from '../features/call-tree/utils/DetailsFilter.js';
import { DatabaseAccess } from '../features/database/services/Database.js';

/** Frame grouping key — same shape as the call-tree aggregation. */
function frameKey(event: LogEvent): string {
  return `${event.type ?? ''}|${event.namespace}|${event.text}`;
}

/** Work slice before the frame is handed back (ms) — half a 60fps frame, so a
 *  build never takes more than half of any frame it runs in. */
const SLICE_MS = 8;
/** Items between deadline checks. Reading the clock per item costs more than
 *  the odd overrun it saves. */
const CHECK_EVERY = 256;

export interface ScopedBuildOptions {
  /** Hands the frame back between work slices. */
  yieldFrame: () => Promise<void>;
  /** Polled after each yield; true abandons the build, which then returns null. */
  cancelled?: () => boolean;
}

/** Returns false once the build has been abandoned. */
type Tick = () => Promise<boolean>;

/** A slice timer: cheap while the slice has time left, yields once it doesn't. */
function frameBudget(options: ScopedBuildOptions): Tick {
  let deadline = performance.now() + SLICE_MS;
  return async () => {
    if (performance.now() < deadline) {
      return true;
    }
    await options.yieldFrame();
    deadline = performance.now() + SLICE_MS;
    return !options.cancelled?.();
  };
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
  /** The whole log's total time (ns). Every selection's `rootTotal` fits inside
   *  it, so it sizes the bar columns once for the log instead of per selection —
   *  the widths then stay put as the selection changes. */
  logTotal: number;
  /** The three views, built on first call and cached (only one is on screen).
   *  Each hands the frame back as it works, and returns null when abandoned. */
  timeOrder(options: ScopedBuildOptions): Promise<ScopedRow[] | null>;
  aggregated(options: ScopedBuildOptions): Promise<ScopedRow[] | null>;
  bottomUp(options: ScopedBuildOptions): Promise<ScopedRow[] | null>;
}

/**
 * The selected node + its real subtree, with real durations. Zero-duration
 * bookkeeping rows (heap allocations, statements, assignments) are dropped —
 * the Inspector is a summary, and the Call Tree tab is where those details are
 * read. The selection itself is kept whatever its duration, so null means the
 * build was abandoned rather than "nothing worth showing".
 *
 * Iterative rather than recursive: subtree size is the second unbounded
 * dimension (the occurrence count is the first), and both have to be sliceable.
 */
async function realSubtree(event: LogEvent, tick: Tick): Promise<ScopedRow | null> {
  // Pre-order, so a node always precedes its descendants and the prune below
  // can walk it backwards to reach every child before its parent.
  const rows: ScopedRow[] = [];
  const parents: Array<ScopedRow | null> = [];
  const stack: Array<{ event: LogEvent; parent: ScopedRow | null }> = [{ event, parent: null }];
  let steps = 0;
  while (stack.length) {
    if (steps++ % CHECK_EVERY === 0 && !(await tick())) {
      return null;
    }
    const { event: current, parent } = stack.pop()!;
    const row: ScopedRow = {
      id: current.eventIndex,
      originalData: current,
      text: current.text,
      type: current.type ?? '',
      duration: { total: current.duration.total, self: current.duration.self },
      callCount: 1,
      _children: null,
    };
    rows.push(row);
    parents.push(parent);
    for (let i = current.children.length - 1; i >= 0; i--) {
      stack.push({ event: current.children[i]!, parent: row });
    }
  }

  for (let i = rows.length - 1; i >= 0; i--) {
    if (i % CHECK_EVERY === 0 && !(await tick())) {
      return null;
    }
    const row = rows[i]!;
    // Deepest first, so every child has attached itself by now — appended in
    // reverse, hence the flip.
    row._children?.reverse();
    if (i === 0) {
      break; // the selection stays whatever its duration
    }
    // A zero-duration frame stays only as the path to a kept descendant, or
    // because its type reports limits rather than time.
    if (row.duration.total > 0 || row._children || EXCLUDED_DETAIL_TYPES.has(row.type)) {
      const parent = parents[i]!;
      (parent._children ??= []).push(row);
    }
  }
  return rows[0]!;
}

/**
 * The call tree filtered to the selected statement: its ancestor path
 * (root→selected) + the selected node + its real subtree, with sibling branches
 * pruned. Ancestors are attributed to the selection (`total = selected.total`,
 * `self = 0`) so the selection's cost reads "all the way down"; the selected
 * node and its descendants keep their real durations. Returns the three views
 * (time-order / aggregated / bottom-up) or null when nothing is selected.
 *
 * An aggregate selection scopes to every occurrence, and a frame can occur tens
 * of thousands of times, so the walk is sliced: it hands the frame back through
 * `options.yieldFrame` rather than blocking on the whole selection at once.
 * Nothing is capped or sampled — every occurrence is counted, just not all in
 * one frame.
 */
export async function buildScopedCallTree(
  eventIndex: number,
  instances: number[] | null | undefined,
  options: ScopedBuildOptions,
): Promise<ScopedCallTree | null> {
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
  const tick = frameBudget(options);
  const roots: ScopedRow[] = [];
  for (let i = 0; i < selectedEvents.length; i++) {
    if (i % CHECK_EVERY === 0 && !(await tick())) {
      return null;
    }
    const selected = selectedEvents[i]!;
    const subtree = await realSubtree(selected, tick);
    if (!subtree) {
      return null;
    }
    let node = subtree;
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
    roots.push(node);
  }

  // Only one view is on screen, so build each on first read and cache it —
  // aggregate()/buildBottomUp() are full walks of every retained subtree.
  let timeOrderRows: ScopedRow[] | null = null;
  let aggregatedRows: ScopedRow[] | null = null;
  let bottomUpRows: ScopedRow[] | null = null;
  return {
    rootTotal,
    logTotal: apexLog.duration.total,
    async timeOrder(viewOptions) {
      // Many occurrences usually share ancestors, so merge the paths for a
      // readable tree; a single occurrence keeps its exact chain.
      timeOrderRows ??= roots.length > 1 ? await aggregate(roots, viewOptions) : roots;
      return timeOrderRows;
    },
    async aggregated(viewOptions) {
      aggregatedRows ??= await aggregate(roots, viewOptions);
      return aggregatedRows;
    },
    async bottomUp(viewOptions) {
      bottomUpRows ??= await buildBottomUp(roots, viewOptions);
      return bottomUpRows;
    },
  };
}

/** Top-down aggregation: merge sibling frames sharing a key, summing metrics. */
async function aggregate(
  rows: ScopedRow[],
  options: ScopedBuildOptions,
): Promise<ScopedRow[] | null> {
  const tick = frameBudget(options);
  let idSeq = 0;
  const nextId = () => (idSeq -= 1);

  // The recursion follows the call depth, which is shallow; each level's input
  // is the wide dimension, so that is where the slicing goes.
  async function merge(input: ScopedRow[]): Promise<ScopedRow[] | null> {
    const groups = new Map<string, ScopedRow>();
    const order: string[] = [];
    for (let i = 0; i < input.length; i++) {
      if (i % CHECK_EVERY === 0 && !(await tick())) {
        return null;
      }
      const row = input[i]!;
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

    const merged: ScopedRow[] = [];
    for (const key of order) {
      const group = groups.get(key)!;
      const kids = group._children as ScopedRow[];
      if (kids.length) {
        const mergedKids = await merge(kids);
        if (!mergedKids) {
          return null;
        }
        group._children = mergedKids;
      } else {
        group._children = null;
      }
      merged.push(group);
    }
    return merged;
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
async function buildBottomUp(
  rows: ScopedRow[],
  options: ScopedBuildOptions,
): Promise<ScopedRow[] | null> {
  const tick = frameBudget(options);
  let idSeq = 0;
  const nextId = () => (idSeq -= 1);
  const topMap = new Map<string, BottomUpNode>();
  const topOrder: BottomUpNode[] = [];
  const everyNode: BottomUpNode[] = [];

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
      everyNode.push(node);
    }
    return node;
  };

  // Iterative pre-order over every occurrence's subtree: both the occurrence
  // count and the subtree size grow, so one flat sliceable loop covers both.
  const stack: Array<{ row: ScopedRow; path: ScopedRow[] }> = [];
  for (let i = rows.length - 1; i >= 0; i--) {
    stack.push({ row: rows[i]!, path: [] });
  }
  let steps = 0;
  while (stack.length) {
    if (steps++ % CHECK_EVERY === 0 && !(await tick())) {
      return null;
    }
    const { row, path } = stack.pop()!;
    if (row.duration.self > 0) {
      // Callee first, then its callers up to the root.
      const chain = [row, ...path.slice().reverse()];
      let map = topMap;
      let order: BottomUpNode[] | null = topOrder;
      for (let i = 0; i < chain.length; i++) {
        const node = ensure(map, order, chain[i]!);
        node.duration.total += row.duration.self;
        // Callers count the call they contributed too, matching the Call Tree
        // tab's bottom-up (every bucket in the chain accumulates); counting
        // only the seed left every caller row reading "Calls 0".
        node.callCount += 1;
        if (i === 0) {
          node.duration.self += row.duration.self;
        }
        map = node._map;
        order = null;
      }
    }
    if (row._children) {
      const childPath = [...path, row];
      for (let i = row._children.length - 1; i >= 0; i--) {
        stack.push({ row: row._children[i]!, path: childPath });
      }
    }
  }

  // The nodes are already ScopedRows; publishing each caller map as `_children`
  // in place saves a second tree's worth of allocation.
  for (let i = 0; i < everyNode.length; i++) {
    if (i % CHECK_EVERY === 0 && !(await tick())) {
      return null;
    }
    const node = everyNode[i]!;
    node._children = node._map.size ? [...node._map.values()] : null;
  }
  return topOrder.sort((a, b) => b.duration.self - a.duration.self);
}
