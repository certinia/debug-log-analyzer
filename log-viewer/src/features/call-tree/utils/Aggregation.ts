/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

import type { LogEvent, SelfTotal } from 'apex-log-parser';
import { getCallerNamespace } from '../../../core/utility/CallerNamespace.js';
import { Multiset } from '../../../core/utility/Multiset.js';
import { EXCLUDED_DETAIL_TYPES } from './DetailsFilter.js';

/**
 * Represents a row in the aggregated call tree view.
 * All calls to the same function signature are merged, with children also aggregated.
 */
export interface AggregatedRow {
  /** Unique identifier for the row */
  id: number;
  /** Unique grouping key for this function signature */
  key: string;
  /** Display name */
  text: string;
  /** Package namespace */
  namespace: string;
  /** Namespace of the direct caller (representative; used for grouping/filtering, not displayed) */
  callerNamespace: string;
  /** Number of times this function was called */
  callCount: number;
  /** Sum of self-time across all calls */
  totalSelfTime: number;
  /** Sum of total-time across all calls */
  totalTime: number;
  /** Average self-time per call */
  avgSelfTime: number;
  /** Total DML count */
  dmlCount: SelfTotal;
  /** Total SOQL count */
  soqlCount: SelfTotal;
  /** Total DML rows */
  dmlRowCount: SelfTotal;
  /** Total SOQL rows */
  soqlRowCount: SelfTotal;
  /** Total exceptions thrown */
  totalThrownCount: number;
  /** Aggregated children (callees grouped by signature) */
  _children?: AggregatedRow[] | null;
  /** References to original events for drill-down */
  instances: LogEvent[];
  /** Representative event for this row (used by formatters) */
  originalData: LogEvent;
  /** See {@link TimeOrderRow._hasDetailsDeep}. Precomputed during tree build. */
  _hasDetailsDeep: boolean;
}

/**
 * Represents a row in the bottom-up tree view.
 * Functions sorted by self-time, with callers (parents) as children.
 */
export interface BottomUpRow {
  /** Unique identifier for the row */
  id: number;
  /** Unique grouping key for this function signature */
  key: string;
  /** Internal interned int id matching {@link key}; used for fast child-bucket
   *  lookup during the trie build. Not consumed externally. */
  _keyId: number;
  /** Display name */
  text: string;
  /** Package namespace */
  namespace: string;
  /** Namespace of the direct caller (representative; used for grouping/filtering, not displayed) */
  callerNamespace: string;
  /** Event type (e.g., METHOD_ENTRY, CODE_UNIT_STARTED) */
  type: string;
  /** Number of times this function was called */
  callCount: number;
  /** Sum of self-time across all calls */
  totalSelfTime: number;
  /** Sum of total-time across all calls */
  totalTime: number;
  /** Average self-time per call */
  avgSelfTime: number;
  /** Total DML count */
  dmlCount: SelfTotal;
  /** Total SOQL count */
  soqlCount: SelfTotal;
  /** Total DML rows */
  dmlRowCount: SelfTotal;
  /** Total SOQL rows */
  soqlRowCount: SelfTotal;
  /** Total exceptions thrown */
  totalThrownCount: number;
  /** Callers (parent functions) as children - lazy loaded */
  _children?: BottomUpRow[] | null;
  /**
   * References to the displayed events for drill-down. Populated only on root
   * buckets (used by the table-level `bottomCalc`); deep buckets leave this
   * empty — use {@link originalData} when a single representative is needed.
   */
  instances: LogEvent[];
  /** Representative event for this row (used by formatters) */
  originalData: LogEvent;
  /** See {@link TimeOrderRow._hasDetailsDeep}. Precomputed during tree build. */
  _hasDetailsDeep: boolean;
}

/**
 * Generates a unique key for grouping events by signature.
 * Includes event type so different entry types (e.g. CODE_UNIT_STARTED vs METHOD_ENTRY)
 * are displayed as separate rows. Field order (type|namespace|text) is the shared
 * canonical bucket-key shape used by aggregated, bottom-up, and analysis views.
 */
export function getEventKey(event: LogEvent): string {
  return `${event.type ?? ''}|${event.namespace}|${event.text}`;
}

/**
 * Generates a key for call-stack tracking to detect recursive calls.
 * Excludes event type so the same method is recognised regardless of entry type
 * (e.g. CODE_UNIT_STARTED at the top level, METHOD_ENTRY for recursive calls).
 * Matches the approach used by the analysis view's RowGrouper.
 */
function getStackKey(event: LogEvent): string {
  return `${event.namespace}|${event.text}`;
}

/**
 * Creates an aggregated call tree where all calls to the same function signature
 * are merged together, with aggregated metrics.
 * Uses Multiset call-stack tracking to prevent double-counting of recursive calls.
 */
export function toAggregatedCallTree(rootChildren: LogEvent[]): AggregatedRow[] {
  if (rootChildren.length === 0) {
    return [];
  }

  // Per-build monotonic counter; row ids must be globally unique within this
  // tree so deepFilter caches don't collide across cascaded subtree passes.
  let next = 0;
  const idFor = (): number => ++next;

  // Group root-level events by signature with call stack tracking
  const rootMap = new Map<string, AggregatedRow>();
  const keyStack = new Multiset<string>();

  for (const event of rootChildren) {
    // Process every event so callCount/DML/SOQL/exception counts roll up even
    // when the event has no timing contribution.
    const key = getEventKey(event);
    let row = rootMap.get(key);

    if (!row) {
      row = createEmptyAggregatedRow(key, event, idFor);
      rootMap.set(key, row);
    }

    const stackKey = getStackKey(event);
    addEventToAggregatedRowWithStack(row, event, stackKey, keyStack);
  }

  // Recursively aggregate children for each row
  for (const row of rootMap.values()) {
    const firstInstance = row.instances[0];
    const stackKey = firstInstance ? getStackKey(firstInstance) : row.key;
    row._children = aggregateChildrenRecursive(row.instances, stackKey, idFor);
    calculateAverages(row);
    row._hasDetailsDeep = computeHasDetailsDeep(row, row.totalTime, row.originalData.type);
  }

  // Sort by total time descending
  return Array.from(rootMap.values()).sort((a, b) => b.totalTime - a.totalTime);
}

/**
 * Recursively aggregates children of all instances.
 * Tracks the parent key to detect recursive calls within the same aggregation context.
 */
function aggregateChildrenRecursive(
  instances: LogEvent[],
  parentStackKey: string,
  idFor: () => number,
): AggregatedRow[] | null {
  const childMap = new Map<string, AggregatedRow>();
  // Create a new stack for each aggregation level, starting with the parent stack key
  const keyStack = new Multiset<string>();
  keyStack.add(parentStackKey);

  for (const instance of instances) {
    for (const child of instance.children) {
      const key = getEventKey(child);
      let row = childMap.get(key);

      if (!row) {
        row = createEmptyAggregatedRow(key, child, idFor);
        childMap.set(key, row);
      }

      const stackKey = getStackKey(child);
      addEventToAggregatedRowWithStack(row, child, stackKey, keyStack);
    }
  }

  if (childMap.size === 0) {
    return null;
  }

  // Recursively aggregate children using stack key for recursion tracking
  for (const row of childMap.values()) {
    const firstInstance = row.instances[0];
    const stackKey = firstInstance ? getStackKey(firstInstance) : row.key;
    row._children = aggregateChildrenRecursive(row.instances, stackKey, idFor);
    calculateAverages(row);
    row._hasDetailsDeep = computeHasDetailsDeep(row, row.totalTime, row.originalData.type);
  }

  // Sort by total time descending
  return Array.from(childMap.values()).sort((a, b) => b.totalTime - a.totalTime);
}

/**
 * Adds an event to an aggregated row, using call stack tracking to prevent
 * double-counting of totalTime for recursive calls.
 */
function addEventToAggregatedRowWithStack(
  row: AggregatedRow,
  event: LogEvent,
  stackKey: string,
  keyStack: Multiset<string>,
): void {
  row.callCount++;
  row.totalSelfTime += event.duration.self; // Always add self time

  // Only add totalTime if this method is not already on the stack (avoids recursive double-counting)
  // Uses stackKey (text+namespace, no type) so CODE_UNIT_STARTED and METHOD_ENTRY for the same
  // method are recognised as the same function in the call stack.
  if (!keyStack.has(stackKey)) {
    row.totalTime += event.duration.total;
  }

  row.dmlCount.self += event.dmlCount.self;
  row.dmlCount.total += event.dmlCount.total;
  row.soqlCount.self += event.soqlCount.self;
  row.soqlCount.total += event.soqlCount.total;
  row.dmlRowCount.self += event.dmlRowCount.self;
  row.dmlRowCount.total += event.dmlRowCount.total;
  row.soqlRowCount.self += event.soqlRowCount.self;
  row.soqlRowCount.total += event.soqlRowCount.total;
  row.totalThrownCount += event.totalThrownCount;
  row.instances.push(event);
}

/**
 * Converts top-down call trees into bottom-up call trees.
 *
 * Bottom-up roots are callees; children are reversed callers.
 * For every metric pair M.self/M.total (for example time, soqlRows), values are
 * attributed once using deepest active frame assignment and then bucketed by
 * reversed caller path. At every node, child partitions must sum to parent for
 * both self and total. Totals are non-overlapping and recursion-safe.
 *
 * Input invariant expected from parser output for every metric pair M:
 *   M.total(node) = M.self(node) + Σ M.total(children)
 * This converter assumes that invariant and preserves it through partitioning.
 *
 * Algorithm:
 *   1. Compute per-frame attributed totals. For every frame F with name R,
 *      attr(F) = F.total - Σ T for each nearest same-name descendant T. The DFS
 *      maintains Map<name, deepest-active-frame> and subtracts descendant totals
 *      from their nearest same-name ancestor on entry.
 *   2. For every frame F, walk its ancestor chain and
 *      insert F into a trie keyed by [F.name, F.parent.name, F.grandparent.name, …].
 *      At every prefix, accumulate F.self (bucket.self) and attr(F) (bucket.total)
 *      plus the matching metric pairs.
 *   3. Finalize averages and sort deterministically (totalSelfTime desc, name asc).
 *
 * Supported metric pairs (same attribution logic for each pair):
 *   - duration.self / duration.total
 *   - dmlCount.self / dmlCount.total
 *   - soqlCount.self / soqlCount.total
 *   - dmlRowCount.self / dmlRowCount.total
 *   - soqlRowCount.self / soqlRowCount.total
 *   - totalThrownCount (treated like a total metric for attribution)
 */
type FrameContext = {
  frame: LogEvent;
  stackKey: string;
  prior: FrameContext | undefined;
  // Attribution accumulator — initialised to the frame's own totals and
  // decremented as same-name descendants are entered. Final when the frame
  // is popped at post-order exit.
  totalTime: number;
  dmlTotal: number;
  soqlTotal: number;
  dmlRowTotal: number;
  soqlRowTotal: number;
  thrownTotal: number;
};

type DfsEntry = {
  node: LogEvent;
  childIdx: number;
  ctx: FrameContext;
};

/**
 * Single iterative DFS that fuses attribution computation with trie insertion.
 *
 * Pre-order on entering N:
 *   - Intern N's event key to an int id; push onto the chain stack.
 *   - Look up `prior` same-name ancestor; build N's `FrameContext` initialised
 *     to N's own totals; decrement `prior.totalTime`/… by N's totals (the
 *     deepest-active-frame attribution rule).
 *
 * Post-order on leaving N:
 *   - N's `ctx` totals are now final. Insert N into the trie by walking the
 *     chain stack from top (= N) down to depth 0. The chain is the live DFS
 *     ancestor path, so no `frame.parent` walk and no per-step Map lookup is
 *     needed. Bucket-key comparisons are int equality on `_keyId`.
 *   - Restore `activeByName[stackKey]` from `ctx.prior`.
 *
 * Zero-delta guards on the DML/SOQL/row/thrown accumulators avoid the no-op
 * `bucket.x += 0` writes that dominate logs without heavy DB work.
 */
export function toBottomUpTree(rootChildren: LogEvent[]): BottomUpRow[] {
  if (rootChildren.length === 0) {
    return [];
  }

  const intern = new Map<string, number>();
  const idToKey: string[] = [];
  const rootBuckets = new Map<number, BottomUpRow>();
  const activeByName = new Map<string, FrameContext>();
  const dfs: DfsEntry[] = [];
  const chainIds: number[] = [];

  // Per-build monotonic counter; row ids must be globally unique within this
  // tree so deepFilter caches don't collide across cascaded subtree passes.
  let next = 0;
  const idFor = (): number => ++next;

  const enter = (node: LogEvent): void => {
    const eventKey = getEventKey(node);
    let id = intern.get(eventKey);
    if (id === undefined) {
      id = intern.size;
      intern.set(eventKey, id);
      idToKey.push(eventKey);
    }
    chainIds.push(id);

    const stackKey = getStackKey(node);
    const prior = activeByName.get(stackKey);
    const ctx: FrameContext = {
      frame: node,
      stackKey,
      prior,
      totalTime: node.duration.total,
      dmlTotal: node.dmlCount.total,
      soqlTotal: node.soqlCount.total,
      dmlRowTotal: node.dmlRowCount.total,
      soqlRowTotal: node.soqlRowCount.total,
      thrownTotal: node.totalThrownCount,
    };

    if (prior) {
      prior.totalTime -= node.duration.total;
      prior.dmlTotal -= node.dmlCount.total;
      prior.soqlTotal -= node.soqlCount.total;
      prior.dmlRowTotal -= node.dmlRowCount.total;
      prior.soqlRowTotal -= node.soqlRowCount.total;
      prior.thrownTotal -= node.totalThrownCount;
    }
    activeByName.set(stackKey, ctx);
    dfs.push({ node, childIdx: 0, ctx });
  };

  const exit = (): void => {
    const entry = dfs[dfs.length - 1]!;
    const { node, ctx } = entry;

    // Hoist invariants once for the chain walk.
    const selfTime = node.duration.self;
    const dmlSelf = node.dmlCount.self;
    const soqlSelf = node.soqlCount.self;
    const dmlRowSelf = node.dmlRowCount.self;
    const soqlRowSelf = node.soqlRowCount.self;
    const totalTime = ctx.totalTime;
    const dmlTotal = ctx.dmlTotal;
    const soqlTotal = ctx.soqlTotal;
    const dmlRowTotal = ctx.dmlRowTotal;
    const soqlRowTotal = ctx.soqlRowTotal;
    const thrownTotal = ctx.thrownTotal;

    // Closure captures the hoisted locals; zero-delta guards skip no-op writes
    // for logs without heavy DB work.
    const accumulate = (b: BottomUpRow): void => {
      b.callCount++;
      b.totalSelfTime += selfTime;
      b.totalTime += totalTime;
      if (dmlSelf) {
        b.dmlCount.self += dmlSelf;
      }
      if (dmlTotal) {
        b.dmlCount.total += dmlTotal;
      }
      if (soqlSelf) {
        b.soqlCount.self += soqlSelf;
      }
      if (soqlTotal) {
        b.soqlCount.total += soqlTotal;
      }
      if (dmlRowSelf) {
        b.dmlRowCount.self += dmlRowSelf;
      }
      if (dmlRowTotal) {
        b.dmlRowCount.total += dmlRowTotal;
      }
      if (soqlRowSelf) {
        b.soqlRowCount.self += soqlRowSelf;
      }
      if (soqlRowTotal) {
        b.soqlRowCount.total += soqlRowTotal;
      }
      if (thrownTotal) {
        b.totalThrownCount += thrownTotal;
      }
    };

    const top = chainIds.length - 1;
    const rootId = chainIds[top]!;
    let bucket = rootBuckets.get(rootId);
    if (!bucket) {
      bucket = createEmptyBottomUpRow(idToKey[rootId]!, rootId, node, idFor);
      rootBuckets.set(rootId, bucket);
    }
    accumulate(bucket);
    bucket.instances.push(node);

    // Deeper buckets are keyed by successive ancestors. The DFS stack already
    // holds them — dfs[i].node is N's ancestor at depth i.
    let parentBucket = bucket;
    for (let i = top - 1; i >= 0; i--) {
      const ancestorId = chainIds[i]!;
      const ancestor = dfs[i]!.node;
      const existingChildren = parentBucket._children ?? [];
      let childBucket = existingChildren.find((c) => c._keyId === ancestorId);
      if (!childBucket) {
        childBucket = createEmptyBottomUpRow(idToKey[ancestorId]!, ancestorId, ancestor, idFor);
        existingChildren.push(childBucket);
        parentBucket._children = existingChildren;
      }
      accumulate(childBucket);
      parentBucket = childBucket;
    }

    if (ctx.prior) {
      activeByName.set(ctx.stackKey, ctx.prior);
    } else {
      activeByName.delete(ctx.stackKey);
    }
    chainIds.pop();
    dfs.pop();
  };

  // Drive one root tree to completion at a time. Each root is fully entered,
  // descended, and exited before the next begins.
  for (const root of rootChildren) {
    enter(root);
    while (dfs.length > 0) {
      const cur = dfs[dfs.length - 1]!;
      if (cur.childIdx < cur.node.children.length) {
        const child = cur.node.children[cur.childIdx++]!;
        enter(child);
      } else {
        exit();
      }
    }
  }

  return finalizeBuckets(rootBuckets);
}

/**
 * Walks the bucket trie computing averages and applying deterministic ordering
 * (primary metric total-self desc, then name asc) at every level. Empty child
 * arrays are collapsed to null so Tabulator's dataTree renders a leaf indicator.
 */
function finalizeBuckets(rootBuckets: Map<number, BottomUpRow>): BottomUpRow[] {
  const roots = Array.from(rootBuckets.values());
  for (const row of roots) {
    finalizeBucketRecursive(row);
  }
  sortBuckets(roots);
  return roots;
}

function finalizeBucketRecursive(row: BottomUpRow): void {
  calculateBottomUpAverages(row);
  if (row._children && row._children.length > 0) {
    for (const child of row._children) {
      finalizeBucketRecursive(child);
    }
    sortBuckets(row._children);
  }
  row._hasDetailsDeep = computeHasDetailsDeep(row, row.totalTime, row.type);
}

function sortBuckets(rows: BottomUpRow[]): void {
  rows.sort((a, b) => {
    const delta = b.totalSelfTime - a.totalSelfTime;
    if (delta !== 0) {
      return delta;
    }
    return a.text.localeCompare(b.text);
  });
}

function createEmptyAggregatedRow(
  key: string,
  event: LogEvent,
  idFor: () => number,
): AggregatedRow {
  return {
    id: idFor(),
    key,
    text: event.text,
    namespace: event.namespace,
    callerNamespace: getCallerNamespace(event),
    callCount: 0,
    totalSelfTime: 0,
    totalTime: 0,
    avgSelfTime: 0,
    dmlCount: { self: 0, total: 0 },
    soqlCount: { self: 0, total: 0 },
    dmlRowCount: { self: 0, total: 0 },
    soqlRowCount: { self: 0, total: 0 },
    totalThrownCount: 0,
    _children: null,
    instances: [],
    originalData: event,
    _hasDetailsDeep: false,
  };
}

function createEmptyBottomUpRow(
  key: string,
  keyId: number,
  event: LogEvent,
  idFor: () => number,
): BottomUpRow {
  return {
    id: idFor(),
    key,
    _keyId: keyId,
    text: event.text,
    namespace: event.namespace,
    callerNamespace: getCallerNamespace(event),
    type: event.type ?? '',
    callCount: 0,
    totalSelfTime: 0,
    totalTime: 0,
    avgSelfTime: 0,
    dmlCount: { self: 0, total: 0 },
    soqlCount: { self: 0, total: 0 },
    dmlRowCount: { self: 0, total: 0 },
    soqlRowCount: { self: 0, total: 0 },
    totalThrownCount: 0,
    _children: null,
    instances: [],
    originalData: event,
    _hasDetailsDeep: false,
  };
}

function calculateAverages(row: AggregatedRow): void {
  if (row.callCount > 0) {
    row.avgSelfTime = row.totalSelfTime / row.callCount;
  }
}

function calculateBottomUpAverages(row: BottomUpRow): void {
  if (row.callCount > 0) {
    row.avgSelfTime = row.totalSelfTime / row.callCount;
  }
}

/**
 * Show-Details predicate, rolled up across children. Called post-order after
 * `_children` is set and each child's own `_hasDetailsDeep` is populated.
 * Generic over `AggregatedRow` (type lives on `originalData`) and `BottomUpRow`
 * (type lives on the row directly) — caller passes whichever applies.
 */
function computeHasDetailsDeep<T extends { _children?: T[] | null; _hasDetailsDeep: boolean }>(
  row: T,
  totalTime: number,
  type: string | null | undefined,
): boolean {
  if (totalTime > 0) {
    return true;
  }
  if (type && EXCLUDED_DETAIL_TYPES.has(type)) {
    return true;
  }
  const children = row._children;
  if (children) {
    for (let i = 0, len = children.length; i < len; i++) {
      if (children[i]!._hasDetailsDeep) {
        return true;
      }
    }
  }
  return false;
}
