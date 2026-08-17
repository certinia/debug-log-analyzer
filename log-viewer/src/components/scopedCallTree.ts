/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { LogEvent } from 'apex-log-parser';

import { EXCLUDED_DETAIL_TYPES } from '../features/call-tree/utils/DetailsFilter.js';
import { DatabaseAccess } from '../features/database/services/Database.js';
import {
  CHECK_EVERY,
  frameBudget,
  type FrameBudgetOptions,
  type Tick,
} from '../core/utility/FrameBudget.js';

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
  /** Every occurrence the row stands for, when it merges several. Null on a row
   *  that is one frame, whose single occurrence is `originalData` — the whole-log
   *  tree is all such rows, so a list each would cost one array per event. */
  eventIndexes: number[] | null;
  _children: ScopedRow[] | null;
}

/**
 * The event a scoped row reveals, or null when it merges occurrences. Aggregated
 * and bottom-up rows carry a synthetic negative id and keep only the first
 * occurrence, so revealing one would misname which occurrence was clicked.
 */
export function revealableEventIndex(row: Partial<ScopedRow> | undefined): number | null {
  const { id, originalData } = row ?? {};
  return id !== undefined && id >= 0 && originalData ? originalData.eventIndex : null;
}

/**
 * Every occurrence a scoped row stands for. A merged row can be pointed at even
 * though it cannot be revealed: there is no one frame to jump to, but all of
 * them can be marked at once.
 */
export function locatableEventIndexes(row: Partial<ScopedRow> | undefined): number[] {
  if (row?.eventIndexes) {
    return row.eventIndexes;
  }
  const single = revealableEventIndex(row);
  return single === null ? [] : [single];
}

/**
 * The rows of one view keyed by each occurrence they stand for, so a frame named
 * elsewhere can be found in a view whose rows merge occurrences behind a
 * synthetic id. One frame can name several rows — in bottom-up it appears once
 * per caller chain it sits in.
 */
export function rowIdsByEvent(rows: readonly ScopedRow[]): Map<number, number[]> {
  const byEvent = new Map<number, number[]>();
  const stack = [...rows];
  while (stack.length) {
    const row = stack.pop()!;
    for (const eventIndex of locatableEventIndexes(row)) {
      const ids = byEvent.get(eventIndex);
      if (ids) {
        ids.push(row.id);
      } else {
        byEvent.set(eventIndex, [row.id]);
      }
    }
    if (row._children) {
      stack.push(...row._children);
    }
  }
  return byEvent;
}

export interface ScopedCallTree {
  /** The selected node's total time (ns) — the % denominator for the bars. */
  rootTotal: number;
  /** The whole log's total time (ns). It sizes the bar columns once for the log
   *  instead of per selection, so the widths stay put as the selection changes.
   *  An aggregate `rootTotal` sums nested occurrences, so it can read wider than
   *  this; the column carries enough padding to absorb that. */
  logTotal: number;
  /** The three views, built on first call and cached (only one is on screen).
   *  Each hands the frame back as it works, and returns null when abandoned. */
  timeOrder(options: FrameBudgetOptions): Promise<ScopedRow[] | null>;
  aggregated(options: FrameBudgetOptions): Promise<ScopedRow[] | null>;
  bottomUp(options: FrameBudgetOptions): Promise<ScopedRow[] | null>;
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
      eventIndexes: null,
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
  options: FrameBudgetOptions,
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
        eventIndexes: null,
        _children: [node],
      };
      parent = parent.parent;
    }
    roots.push(node);
  }

  // Many occurrences usually share ancestors, so merge the paths for a
  // readable tree; a single occurrence keeps its exact chain.
  return lazyCallTree(roots, rootTotal, apexLog.duration.total, roots.length > 1);
}

/**
 * The three lazy views over a built set of roots. Only one view is on screen,
 * so each is built on first read and cached — aggregate()/buildBottomUp() are
 * full walks of every retained subtree. `mergeTimeOrder` folds occurrences that
 * share ancestors (a scoped aggregate); the whole-log tree and a single
 * occurrence keep their exact order.
 */
function lazyCallTree(
  roots: ScopedRow[],
  rootTotal: number,
  logTotal: number,
  mergeTimeOrder: boolean,
): ScopedCallTree {
  let timeOrderRows: ScopedRow[] | null = null;
  let aggregatedRows: ScopedRow[] | null = null;
  let bottomUpRows: ScopedRow[] | null = null;
  return {
    rootTotal,
    logTotal,
    async timeOrder(viewOptions) {
      timeOrderRows ??= mergeTimeOrder ? await aggregate(roots, viewOptions) : roots;
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

/**
 * The whole log's call tree — every root event with its real subtree and real
 * durations, nothing clamped or attributed. The scoped builder cannot answer
 * this: it exists to model a selection, so it rewrites ancestor durations. Here
 * there is no selection and no ancestors, so every figure is the event's own.
 *
 * Same three views, same slicing, same zero-duration-detail pruning as the
 * scoped tree; `rootTotal` and `logTotal` are both the log's total, so bars are
 * percentages of the whole log.
 */
export async function buildWholeLogCallTree(
  options: FrameBudgetOptions,
): Promise<ScopedCallTree | null> {
  const apexLog = DatabaseAccess.instance()?.getApexLog();
  if (!apexLog) {
    return null;
  }

  const tick = frameBudget(options);
  const roots: ScopedRow[] = [];
  for (const event of apexLog.children) {
    const subtree = await realSubtree(event, tick);
    if (!subtree) {
      return null;
    }
    roots.push(subtree);
  }

  // Already the log's own event order, with real durations — no merging.
  return lazyCallTree(roots, apexLog.duration.total, apexLog.duration.total, false);
}

/** Top-down aggregation: merge sibling frames sharing a key, summing metrics. */
async function aggregate(
  rows: ScopedRow[],
  options: FrameBudgetOptions,
): Promise<ScopedRow[] | null> {
  const tick = frameBudget(options);
  let idSeq = 0;
  const nextId = () => (idSeq -= 1);

  // The recursion follows the call depth, which is shallow; each level's input
  // is the wide dimension, so that is where the slicing goes.
  async function merge(input: ScopedRow[]): Promise<ScopedRow[] | null> {
    const groups = new Map<string, ScopedRow>();
    const order: string[] = [];
    // The occurrences behind each group. A set, because the ancestors of the
    // instances of one frame are the same frame, met once per instance.
    const indexes = new Map<string, Set<number>>();
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
          eventIndexes: [],
          _children: [],
        };
        groups.set(key, group);
        order.push(key);
        indexes.set(key, new Set());
      }
      group.duration.total += row.duration.total;
      group.duration.self += row.duration.self;
      group.callCount += row.callCount;
      // Every merged occurrence, so pointing at the group points at all of them.
      const seen = indexes.get(key)!;
      for (const index of locatableEventIndexes(row)) {
        seen.add(index);
      }
      if (row._children) {
        (group._children as ScopedRow[]).push(...row._children);
      }
    }

    const merged: ScopedRow[] = [];
    for (const key of order) {
      const group = groups.get(key)!;
      group.eventIndexes = [...indexes.get(key)!];
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
  /** The occurrences behind the row. A set, because a caller is met once per
   *  seed beneath it, and a hot caller has many. */
  _indexes: Set<number>;
}

/** A row's ancestors, innermost first. Siblings share the whole tail, so the
 *  walk carries a link per node instead of a copy of the path. */
interface CallerChain {
  row: ScopedRow;
  caller: CallerChain | null;
}

/**
 * Bottom-up: each frame with self time seeds a top-level row (ranked by self),
 * and its callers nest beneath it up to the root — the reverse of the call
 * path, with the seed's self time attributed to every caller as `total`.
 */
async function buildBottomUp(
  rows: ScopedRow[],
  options: FrameBudgetOptions,
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
        eventIndexes: [],
        _children: null,
        _map: new Map(),
        _indexes: new Set(),
      };
      map.set(key, node);
      order?.push(node);
      everyNode.push(node);
    }
    return node;
  };

  // Iterative pre-order over every occurrence's subtree: both the occurrence
  // count and the subtree size grow, so one flat sliceable loop covers both.
  const stack: Array<{ row: ScopedRow; callers: CallerChain | null }> = [];
  for (let i = rows.length - 1; i >= 0; i--) {
    stack.push({ row: rows[i]!, callers: null });
  }
  let steps = 0;
  while (stack.length) {
    if (steps++ % CHECK_EVERY === 0 && !(await tick())) {
      return null;
    }
    const { row, callers } = stack.pop()!;
    if (row.duration.self > 0) {
      // The seed row, then its callers up to the root. The chain is already in
      // that order, so it is walked in place rather than copied and reversed.
      const seed = ensure(topMap, topOrder, row);
      seed.duration.total += row.duration.self;
      seed.duration.self += row.duration.self;
      seed.callCount += 1;
      for (const index of locatableEventIndexes(row)) {
        seed._indexes.add(index);
      }
      let map = seed._map;
      for (let link = callers; link; link = link.caller) {
        const node = ensure(map, null, link.row);
        node.duration.total += row.duration.self;
        for (const index of locatableEventIndexes(link.row)) {
          node._indexes.add(index);
        }
        // Callers count the call they contributed too, matching the Call Tree
        // tab's bottom-up (every bucket in the chain accumulates); counting
        // only the seed left every caller row reading "Calls 0".
        node.callCount += 1;
        map = node._map;
      }
    }
    if (row._children) {
      // Shared by every child, so the ancestor path costs one link per node
      // rather than a copy of the whole path.
      const childCallers: CallerChain = { row, caller: callers };
      for (let i = row._children.length - 1; i >= 0; i--) {
        stack.push({ row: row._children[i]!, callers: childCallers });
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
    node._map.clear(); // its entries live in `_children` now
    node.eventIndexes = [...node._indexes];
    node._indexes.clear(); // its entries live in `eventIndexes` now
  }
  return topOrder.sort((a, b) => b.duration.self - a.duration.self);
}
