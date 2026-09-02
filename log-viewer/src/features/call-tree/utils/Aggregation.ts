/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

import type { GovernorLimits, LogEvent, SelfTotal } from 'apex-log-parser';
import { ROOT_PATH_ID, type KeyPathIds } from '../../../core/log/keyPathIds.js';
import { getCallerNamespace } from '../../../core/utility/CallerNamespace.js';
import { computeHasDetailsDeep } from './DetailsFilter.js';
import { setGovernorCost } from './GovernorCost.js';

/**
 * Represents a row in the aggregated call tree view.
 * All calls to the same function signature are merged, with children also aggregated.
 */
export interface AggregatedRow {
  /** Unique identifier for the row */
  id: number;
  /** Unique grouping key for this function signature */
  key: string;
  /** The interned bucket path that names this row, which the mark matches on. */
  _pathId: number;
  /** Display name */
  text: string;
  /** Package namespace */
  namespace: string;
  /** Namespace of the direct caller (representative; used for grouping/filtering, not displayed) */
  callerNamespace: string;
  /** Event type (e.g. METHOD_ENTRY) — an optional column, off by default. */
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
  /** Total SOSL count */
  soslCount: SelfTotal;
  /** Total DML rows */
  dmlRowCount: SelfTotal;
  /** Total SOQL rows */
  soqlRowCount: SelfTotal;
  /** Total SOSL rows */
  soslRowCount: SelfTotal;
  /** Total + self exceptions thrown */
  thrownCount: SelfTotal;
  /** Total + self signed NET heap bytes (alloc − free; may be negative) — retention */
  heapAllocated: SelfTotal;
  /** Total + self GROSS heap bytes allocated (frees ignored) — churn */
  heapGross: SelfTotal;
  /** Peak live heap (bytes) reached across this row's calls — the limit-comparable value */
  heapPeak: number;
  /** Average governor consumption across all reported governors (0–100%). */
  governorCost: number;
  /** The single tightest governor consumed on this path (0–100+%). */
  governorCostMax: number;
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
  /** The interned bucket path that names this row, which the mark matches on. */
  _pathId: number;
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
  /** Total SOSL count */
  soslCount: SelfTotal;
  /** Total DML rows */
  dmlRowCount: SelfTotal;
  /** Total SOQL rows */
  soqlRowCount: SelfTotal;
  /** Total SOSL rows */
  soslRowCount: SelfTotal;
  /** Total + self exceptions thrown */
  thrownCount: SelfTotal;
  /** Total + self signed NET heap bytes (alloc − free; may be negative) — retention */
  heapAllocated: SelfTotal;
  /** Total + self GROSS heap bytes allocated (frees ignored) — churn */
  heapGross: SelfTotal;
  /** Peak live heap (bytes) reached across this row's calls — the limit-comparable value */
  heapPeak: number;
  /** Average governor consumption across all reported governors (0–100%). */
  governorCost: number;
  /** The single tightest governor consumed on this path (0–100+%). */
  governorCostMax: number;
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
 * Creates an aggregated call tree where all calls to the same function signature
 * are merged together, with aggregated metrics. A recursive call adds no total
 * time of its own: the frame open above it already holds the time they share.
 */
export function toAggregatedCallTree(
  rootChildren: LogEvent[],
  paths: KeyPathIds,
  governorLimits?: GovernorLimits,
): AggregatedRow[] {
  if (rootChildren.length === 0) {
    return [];
  }

  // Per-build monotonic counter; row ids must be globally unique within this
  // tree so deepFilter caches don't collide across cascaded subtree passes.
  let next = 0;
  const idFor = (): number => ++next;

  // Group root-level events by signature with call stack tracking. Keyed by the
  // log's interned ids: a bucket key is hashed once for the log rather than once
  // per event, and the ids are the ones a mark matches rows on.
  const rootMap = new Map<number, AggregatedRow>();

  for (const event of rootChildren) {
    // Process every event so callCount/DML/SOQL/exception counts roll up even
    // when the event has no timing contribution.
    const keyId = paths.keyIdOf(event);
    let row = rootMap.get(keyId);

    if (!row) {
      row = createEmptyAggregatedRow(
        paths.keyText(keyId),
        paths.step(ROOT_PATH_ID, keyId),
        event,
        idFor,
      );
      rootMap.set(keyId, row);
    }

    // Nothing is open above a root child, so no call of one is recursive here.
    addEventToAggregatedRow(row, event, paths.stackIdOf(event, keyId), NO_STACK);
  }

  // Recursively aggregate children for each row
  for (const row of rootMap.values()) {
    row._children = aggregateChildrenRecursive(row, paths, idFor, governorLimits);
    finaliseAggregatedRow(row, governorLimits);
  }

  // Sort by total time descending
  return Array.from(rootMap.values()).sort((a, b) => b.totalTime - a.totalTime);
}

/** No frame open above the level, so nothing in it can be a recursive call. */
const NO_STACK = -1;

/** Averages, governor cost and the Show Details roll-up, once `_children` is set. */
function finaliseAggregatedRow(row: AggregatedRow, governorLimits?: GovernorLimits): void {
  calculateAverages(row);
  if (governorLimits) {
    setGovernorCost(row, governorLimits);
  }
  row._hasDetailsDeep = computeHasDetailsDeep(row, row.totalTime, row.originalData.type);
}

/**
 * Recursively aggregates children of all instances.
 * Tracks the parent key to detect recursive calls within the same aggregation context.
 */
function aggregateChildrenRecursive(
  parent: AggregatedRow,
  paths: KeyPathIds,
  idFor: () => number,
  governorLimits?: GovernorLimits,
): AggregatedRow[] | null {
  const childMap = new Map<number, AggregatedRow>();
  // The parent's frame is open over every call in it, so a call of that same
  // frame inside is recursive. `originalData` is the bucket's own first call.
  const parentStackId = paths.stackIdOf(parent.originalData);

  for (const instance of parent.instances) {
    for (const child of instance.children) {
      const keyId = paths.keyIdOf(child);
      let row = childMap.get(keyId);

      if (!row) {
        row = createEmptyAggregatedRow(
          paths.keyText(keyId),
          paths.step(parent._pathId, keyId),
          child,
          idFor,
        );
        childMap.set(keyId, row);
      }

      addEventToAggregatedRow(row, child, paths.stackIdOf(child, keyId), parentStackId);
    }
  }

  if (childMap.size === 0) {
    return null;
  }

  // Recursively aggregate children using stack key for recursion tracking
  for (const row of childMap.values()) {
    row._children = aggregateChildrenRecursive(row, paths, idFor, governorLimits);
    finaliseAggregatedRow(row, governorLimits);
  }

  // Sort by total time descending
  return Array.from(childMap.values()).sort((a, b) => b.totalTime - a.totalTime);
}

/** Adds an event to an aggregated row, leaving `totalTime` alone where the call
 *  is recursive: the frame open above this level already holds that time. */
function addEventToAggregatedRow(
  row: AggregatedRow,
  event: LogEvent,
  stackId: number,
  openStackId: number,
): void {
  row.callCount++;
  row.totalSelfTime += event.duration.self; // Always add self time

  // The stack id reads through the entry type, so CODE_UNIT_STARTED and
  // METHOD_ENTRY for the same method are one frame on the call stack.
  if (stackId !== openStackId) {
    row.totalTime += event.duration.total;
  }

  row.dmlCount.self += event.dmlCount.self;
  row.dmlCount.total += event.dmlCount.total;
  row.soqlCount.self += event.soqlCount.self;
  row.soqlCount.total += event.soqlCount.total;
  row.soslCount.self += event.soslCount.self;
  row.soslCount.total += event.soslCount.total;
  row.dmlRowCount.self += event.dmlRowCount.self;
  row.dmlRowCount.total += event.dmlRowCount.total;
  row.soqlRowCount.self += event.soqlRowCount.self;
  row.soqlRowCount.total += event.soqlRowCount.total;
  row.soslRowCount.self += event.soslRowCount.self;
  row.soslRowCount.total += event.soslRowCount.total;
  row.thrownCount.self += event.thrownCount.self;
  row.thrownCount.total += event.thrownCount.total;
  row.heapAllocated.self += event.heapAllocated.self;
  row.heapAllocated.total += event.heapAllocated.total;
  row.heapGross.self += event.heapGross.self;
  row.heapGross.total += event.heapGross.total;
  // Peak live heap aggregates by max (the worst single call), not sum.
  row.heapPeak = Math.max(row.heapPeak, event.heapPeak);
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
 *   - soslCount.self / soslCount.total
 *   - dmlRowCount.self / dmlRowCount.total
 *   - soqlRowCount.self / soqlRowCount.total
 *   - soslRowCount.self / soslRowCount.total
 *   - thrownCount.self / thrownCount.total
 */
type FrameContext = {
  frame: LogEvent;
  stackId: number;
  prior: FrameContext | undefined;
  // Attribution accumulator — initialised to the frame's own totals and
  // decremented as same-name descendants are entered. Final when the frame
  // is popped at post-order exit.
  totalTime: number;
  dmlTotal: number;
  soqlTotal: number;
  soslTotal: number;
  dmlRowTotal: number;
  soqlRowTotal: number;
  soslRowTotal: number;
  thrownTotal: number;
  heapTotal: number;
  heapGrossTotal: number;
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
 *   - Take N's interned bucket key id from the log's table; push it onto the
 *     chain stack.
 *   - Look up `prior` same-name ancestor; build N's `FrameContext` initialised
 *     to N's own totals; decrement `prior.totalTime`/… by N's totals (the
 *     deepest-active-frame attribution rule).
 *
 * Post-order on leaving N:
 *   - N's `ctx` totals are now final. Insert N into the trie by walking the
 *     chain stack from top (= N) down to depth 0. The chain is the live DFS
 *     ancestor path, so no `frame.parent` walk and no per-step Map lookup is
 *     needed. Bucket-key comparisons are int equality on `_keyId`.
 *   - Restore `activeByStack[stackId]` from `ctx.prior`.
 *
 * Zero-delta guards on the DML/SOQL/row/thrown accumulators avoid the no-op
 * `bucket.x += 0` writes that dominate logs without heavy DB work.
 */
export function toBottomUpTree(
  rootChildren: LogEvent[],
  paths: KeyPathIds,
  governorLimits?: GovernorLimits,
): BottomUpRow[] {
  if (rootChildren.length === 0) {
    return [];
  }

  const rootBuckets = new Map<number, BottomUpRow>();
  const activeByStack = new Map<number, FrameContext>();
  const dfs: DfsEntry[] = [];
  const chainIds: number[] = [];

  // Per-build monotonic counter; row ids must be globally unique within this
  // tree so deepFilter caches don't collide across cascaded subtree passes.
  let next = 0;
  const idFor = (): number => ++next;

  const enter = (node: LogEvent): void => {
    const keyId = paths.keyIdOf(node);
    chainIds.push(keyId);

    const stackId = paths.stackIdOf(node, keyId);
    const prior = activeByStack.get(stackId);
    const ctx: FrameContext = {
      frame: node,
      stackId,
      prior,
      totalTime: node.duration.total,
      dmlTotal: node.dmlCount.total,
      soqlTotal: node.soqlCount.total,
      soslTotal: node.soslCount.total,
      dmlRowTotal: node.dmlRowCount.total,
      soqlRowTotal: node.soqlRowCount.total,
      soslRowTotal: node.soslRowCount.total,
      thrownTotal: node.thrownCount.total,
      heapTotal: node.heapAllocated.total,
      heapGrossTotal: node.heapGross.total,
    };

    if (prior) {
      prior.totalTime -= node.duration.total;
      prior.dmlTotal -= node.dmlCount.total;
      prior.soqlTotal -= node.soqlCount.total;
      prior.soslTotal -= node.soslCount.total;
      prior.dmlRowTotal -= node.dmlRowCount.total;
      prior.soqlRowTotal -= node.soqlRowCount.total;
      prior.soslRowTotal -= node.soslRowCount.total;
      prior.thrownTotal -= node.thrownCount.total;
      prior.heapTotal -= node.heapAllocated.total;
      prior.heapGrossTotal -= node.heapGross.total;
    }
    activeByStack.set(stackId, ctx);
    dfs.push({ node, childIdx: 0, ctx });
  };

  const exit = (): void => {
    const entry = dfs[dfs.length - 1]!;
    const { node, ctx } = entry;

    // Hoist invariants once for the chain walk.
    const selfTime = node.duration.self;
    const dmlSelf = node.dmlCount.self;
    const soqlSelf = node.soqlCount.self;
    const soslSelf = node.soslCount.self;
    const dmlRowSelf = node.dmlRowCount.self;
    const soqlRowSelf = node.soqlRowCount.self;
    const soslRowSelf = node.soslRowCount.self;
    const thrownSelf = node.thrownCount.self;
    const heapSelf = node.heapAllocated.self;
    const heapGrossSelf = node.heapGross.self;
    // Peak live heap composes by max, so (unlike the additive totals) it needs no
    // deepest-frame subtraction — just max this node's peak into every chain row.
    const heapPeak = node.heapPeak;
    const totalTime = ctx.totalTime;
    const dmlTotal = ctx.dmlTotal;
    const soqlTotal = ctx.soqlTotal;
    const soslTotal = ctx.soslTotal;
    const dmlRowTotal = ctx.dmlRowTotal;
    const soqlRowTotal = ctx.soqlRowTotal;
    const soslRowTotal = ctx.soslRowTotal;
    const thrownTotal = ctx.thrownTotal;
    const heapTotal = ctx.heapTotal;
    const heapGrossTotal = ctx.heapGrossTotal;

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
      if (soslSelf) {
        b.soslCount.self += soslSelf;
      }
      if (soslTotal) {
        b.soslCount.total += soslTotal;
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
      if (soslRowSelf) {
        b.soslRowCount.self += soslRowSelf;
      }
      if (soslRowTotal) {
        b.soslRowCount.total += soslRowTotal;
      }
      if (thrownSelf) {
        b.thrownCount.self += thrownSelf;
      }
      if (thrownTotal) {
        b.thrownCount.total += thrownTotal;
      }
      if (heapSelf) {
        b.heapAllocated.self += heapSelf;
      }
      if (heapTotal) {
        b.heapAllocated.total += heapTotal;
      }
      if (heapGrossSelf) {
        b.heapGross.self += heapGrossSelf;
      }
      if (heapGrossTotal) {
        b.heapGross.total += heapGrossTotal;
      }
      if (heapPeak > b.heapPeak) {
        b.heapPeak = heapPeak;
      }
    };

    const top = chainIds.length - 1;
    const rootId = chainIds[top]!;
    let bucket = rootBuckets.get(rootId);
    if (!bucket) {
      const pathId = paths.step(ROOT_PATH_ID, rootId);
      bucket = createEmptyBottomUpRow(paths.keyText(rootId), rootId, pathId, node, idFor);
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
        const pathId = paths.step(parentBucket._pathId, ancestorId);
        childBucket = createEmptyBottomUpRow(
          paths.keyText(ancestorId),
          ancestorId,
          pathId,
          ancestor,
          idFor,
        );
        existingChildren.push(childBucket);
        parentBucket._children = existingChildren;
      }
      accumulate(childBucket);
      parentBucket = childBucket;
    }

    if (ctx.prior) {
      activeByStack.set(ctx.stackId, ctx.prior);
    } else {
      activeByStack.delete(ctx.stackId);
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

  return finalizeBuckets(rootBuckets, governorLimits);
}

/**
 * Walks the bucket trie computing averages and applying deterministic ordering
 * (primary metric total-self desc, then name asc) at every level. Empty child
 * arrays are collapsed to null so Tabulator's dataTree renders a leaf indicator.
 */
function finalizeBuckets(
  rootBuckets: Map<number, BottomUpRow>,
  governorLimits?: GovernorLimits,
): BottomUpRow[] {
  const roots = Array.from(rootBuckets.values());
  for (const row of roots) {
    finalizeBucketRecursive(row, governorLimits);
  }
  sortBuckets(roots);
  return roots;
}

function finalizeBucketRecursive(row: BottomUpRow, governorLimits?: GovernorLimits): void {
  calculateBottomUpAverages(row);
  if (governorLimits) {
    setGovernorCost(row, governorLimits);
  }
  if (row._children && row._children.length > 0) {
    for (const child of row._children) {
      finalizeBucketRecursive(child, governorLimits);
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
  pathId: number,
  event: LogEvent,
  idFor: () => number,
): AggregatedRow {
  return {
    id: idFor(),
    key,
    _pathId: pathId,
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
    soslCount: { self: 0, total: 0 },
    dmlRowCount: { self: 0, total: 0 },
    soqlRowCount: { self: 0, total: 0 },
    soslRowCount: { self: 0, total: 0 },
    thrownCount: { self: 0, total: 0 },
    heapAllocated: { self: 0, total: 0 },
    heapGross: { self: 0, total: 0 },
    heapPeak: 0,
    governorCost: 0,
    governorCostMax: 0,
    _children: null,
    instances: [],
    originalData: event,
    _hasDetailsDeep: false,
  };
}

function createEmptyBottomUpRow(
  key: string,
  keyId: number,
  pathId: number,
  event: LogEvent,
  idFor: () => number,
): BottomUpRow {
  return {
    id: idFor(),
    key,
    _keyId: keyId,
    _pathId: pathId,
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
    soslCount: { self: 0, total: 0 },
    dmlRowCount: { self: 0, total: 0 },
    soqlRowCount: { self: 0, total: 0 },
    soslRowCount: { self: 0, total: 0 },
    thrownCount: { self: 0, total: 0 },
    heapAllocated: { self: 0, total: 0 },
    heapGross: { self: 0, total: 0 },
    heapPeak: 0,
    governorCost: 0,
    governorCostMax: 0,
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
