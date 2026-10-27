/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

import type { LogCategory } from '#core/log/category.js';
import { ROOT_PATH_ID, type KeyPathIds } from '#core/log/keyPathIds.js';
import { categoryName, type LogIndex, NO_ROW } from '#core/log/LogIndex.js';
import type { LogStore } from '#core/log/LogStore.js';
import { rowMetrics, type RowMetrics, type SelfTotalColumns } from '#core/log/rowMetrics.js';
import { type Signatures, signaturesOf } from '#core/log/signatures.js';
import { getCallerNamespace } from '#core/utility/CallerNamespace.js';
import { CHECK_EVERY, frameBudget, type FrameBudgetOptions } from '#core/utility/FrameBudget.js';
import { computeHasDetailsDeep } from './DetailsFilter.js';
import { type CostLimits, costLimitsOf, setGovernorCost } from './GovernorCost.js';
import {
  addReported,
  emptyReported,
  type ReportedCounts,
  type ReportedUsage,
  type TimeSpan,
  WHOLE_LOG,
} from './reportedUsage.js';

/** A metric's own part and total, summed over a row's calls. */
export interface Tally {
  self: number;
  total: number;
}

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
  dmlCount: Tally;
  /** Total SOQL count */
  soqlCount: Tally;
  /** Total SOSL count */
  soslCount: Tally;
  /** Total DML rows */
  dmlRowCount: Tally;
  /** Total SOQL rows */
  soqlRowCount: Tally;
  /** Total SOSL rows */
  soslRowCount: Tally;
  /** Total + self exceptions thrown */
  thrownCount: Tally;
  /** Total + self signed NET heap bytes (alloc − free; may be negative) — retention */
  heapAllocated: Tally;
  /** Total + self GROSS heap bytes allocated (frees ignored) — churn */
  heapGross: Tally;
  /** Peak live heap (bytes) reached across this row's calls — the limit-comparable value */
  heapPeak: number;
  /** Average governor consumption across all reported governors (0–100%); null if none. */
  governorCost: number | null;
  /** The single tightest governor consumed on this path (0–100+%). */
  governorCostMax: number | null;
  /** What these calls used of each limit, counted as the Seen totals are. */
  reported: ReportedCounts;
  /** Aggregated children (callees grouped by signature) */
  _children?: AggregatedRow[] | null;
  /** The event ids of the calls this row merges, for drill-down */
  instances: number[];
  /** The event id of this row's first call (used by formatters) */
  eventIndex: number;
  /** The timeline category of this row's calls */
  category: LogCategory;
  /** See {@link computeHasDetailsDeep}. Precomputed during tree build. */
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
  dmlCount: Tally;
  /** Total SOQL count */
  soqlCount: Tally;
  /** Total SOSL count */
  soslCount: Tally;
  /** Total DML rows */
  dmlRowCount: Tally;
  /** Total SOQL rows */
  soqlRowCount: Tally;
  /** Total SOSL rows */
  soslRowCount: Tally;
  /** Total + self exceptions thrown */
  thrownCount: Tally;
  /** Total + self signed NET heap bytes (alloc − free; may be negative) — retention */
  heapAllocated: Tally;
  /** Total + self GROSS heap bytes allocated (frees ignored) — churn */
  heapGross: Tally;
  /** Peak live heap (bytes) reached across this row's calls — the limit-comparable value */
  heapPeak: number;
  /** Average governor consumption across all reported governors (0–100%); null if none. */
  governorCost: number | null;
  /** The single tightest governor consumed on this path (0–100+%). */
  governorCostMax: number | null;
  /** What these calls used of each limit, counted as the Seen totals are. */
  reported: ReportedCounts;
  /** Callers (parent functions) as children - lazy loaded */
  _children?: BottomUpRow[] | null;
  /**
   * The event ids of the displayed calls, for drill-down. Populated only on root
   * buckets (used by the table-level `bottomCalc`); deep buckets leave this
   * empty — use {@link eventIndex} when a single representative is needed.
   */
  instances: number[];
  /** The event id of this row's first call (used by formatters) */
  eventIndex: number;
  /** The timeline category of this row's calls */
  category: LogCategory;
  /** See {@link computeHasDetailsDeep}. Precomputed during tree build. */
  _hasDetailsDeep: boolean;
}

/**
 * Creates an aggregated call tree where all calls to the same function signature
 * are merged together, with aggregated metrics. A recursive call adds no total
 * time of its own: the frame open above it already holds the time they share.
 *
 * @param index - the shown rows of `store`
 */
export function toAggregatedCallTree(
  index: LogIndex,
  store: LogStore,
  reported: ReportedUsage | null = null,
): AggregatedRow[] {
  return runSteps(aggregatedSteps(buildContext(index, store, reported)));
}

/**
 * {@link toAggregatedCallTree} of the store's shown rows, in slices that hand the
 * thread back between them (see {@link FrameBudgetOptions}). Returns null once
 * `options.signal` aborts.
 */
export async function buildAggregatedTree(
  store: LogStore,
  options: FrameBudgetOptions = {},
  reported: ReportedUsage | null = null,
): Promise<AggregatedRow[] | null> {
  const index = await store.logIndex();
  return driveSteps(aggregatedSteps(buildContext(index, store, reported)), options);
}

function runSteps<T>(steps: Generator<void, T, void>): T {
  let step = steps.next();
  while (!step.done) {
    step = steps.next();
  }
  return step.value;
}

async function driveSteps<T>(
  steps: Generator<void, T, void>,
  options: FrameBudgetOptions,
): Promise<T | null> {
  const tick = frameBudget(options);
  let step = steps.next();
  while (!step.done) {
    if (!(await tick())) {
      return null;
    }
    step = steps.next();
  }
  return step.value;
}

/** What every row of one build reads. */
interface BuildContext {
  index: LogIndex;
  metrics: RowMetrics;
  paths: KeyPathIds;
  signatures: Signatures;
  store: LogStore;
  costLimits: CostLimits;
  reported: ReportedUsage | null;
  /** Per-build monotonic counter; row ids must be globally unique within this
   *  tree so deepFilter caches don't collide across cascaded subtree passes. */
  idFor: () => number;
}

function buildContext(
  index: LogIndex,
  store: LogStore,
  reported: ReportedUsage | null,
): BuildContext {
  let next = 0;
  return {
    index,
    metrics: rowMetrics(index),
    paths: store.keyPathIds(),
    signatures: signaturesOf(store.log),
    store,
    costLimits: costLimitsOf(store.log.limits),
    reported,
    idFor: () => ++next,
  };
}

/** The time of an index row, or of the whole log for {@link NO_ROW}. */
function spanOf(index: LogIndex, row: number): TimeSpan {
  return row === NO_ROW
    ? WHOLE_LOG
    : { startTimestamp: index.start[row]!, endTimestamp: index.end[row]! };
}

type AggregateFrame = {
  // null on the frame that holds the roots.
  row: AggregatedRow | null;
  callees: AggregatedRow[];
  next: number;
};

/** The event ids a level groups the callees of; the log, which heads no row, is id 0. */
const LOG_CALLS: readonly number[] = [0];

function* aggregatedSteps(ctx: BuildContext): Generator<void, AggregatedRow[], void> {
  if (ctx.index.rowCount === 0) {
    return [];
  }
  let budget = CHECK_EVERY;

  // The grouping loop runs outside the generator: run inside it, it is about 15% slower.
  function* group(
    calls: readonly number[],
    pathId: number,
    openStackId: number,
  ): Generator<void, AggregatedRow[], void> {
    const grouping: CalleeGrouping = {
      calls,
      pathId,
      openStackId,
      byKey: new Map(),
      call: 0,
      child: NOT_STARTED,
    };
    for (;;) {
      budget -= groupCallees(grouping, ctx, budget);
      if (budget > 0) {
        return Array.from(grouping.byKey.values());
      }
      yield;
      budget = CHECK_EVERY;
    }
  }

  // Nothing is open above a root child, so no call of one is recursive here.
  const roots = yield* group(LOG_CALLS, ROOT_PATH_ID, NO_STACK);
  // Descend callees in grouping order, not sorted order: the row ids depend on it.
  const stack: AggregateFrame[] = [{ row: null, callees: roots, next: 0 }];
  while (stack.length > 0) {
    const frame = stack[stack.length - 1]!; // the loop guard keeps it non-empty
    if (frame.next < frame.callees.length) {
      const row = frame.callees[frame.next++]!; // next is in range
      // The row's own frame is open over its callees, so a call of it there is recursive.
      const callees = yield* group(row.instances, row._pathId, ctx.paths.stackIdOf(row.eventIndex));
      stack.push({ row, callees, next: 0 });
      if (--budget === 0) {
        yield;
        budget = CHECK_EVERY;
      }
      continue;
    }

    stack.pop();
    if (frame.row) {
      frame.row._children = frame.callees.length > 0 ? frame.callees.sort(byTotalTimeDesc) : null;
      finaliseAggregatedRow(frame.row, ctx.costLimits);
    }
  }

  return roots.sort(byTotalTimeDesc);
}

/** {@link CalleeGrouping.child} before the call's first child is read. */
const NOT_STARTED = -2;

type CalleeGrouping = {
  /** Event ids. */
  calls: readonly number[];
  pathId: number;
  openStackId: number;
  byKey: Map<number, AggregatedRow>;
  call: number;
  /** The next index row to group under `calls[call]`. */
  child: number;
};

// Returns how many callees it grouped, at most `budget`.
function groupCallees(grouping: CalleeGrouping, ctx: BuildContext, budget: number): number {
  const { index, paths, reported } = ctx;
  const { subtreeEnd, eventIndex } = index;
  const { calls, pathId, openStackId, byKey } = grouping;
  let done = 0;
  let i = grouping.call;
  let child = grouping.child;
  for (; i < calls.length; i++, child = NOT_STARTED) {
    const callRow = index.rowOf(calls[i]!); // i is in range; the log's id 0 reads NO_ROW
    const end = callRow === NO_ROW ? index.rowCount : subtreeEnd[callRow]!;
    if (child === NOT_STARTED) {
      child = callRow + 1;
    }
    // A callee's span sits inside its call's, so a call that holds no point skips the search.
    const usage = child < end && reported?.span(spanOf(index, callRow)) ? reported : null;
    for (; child < end; child = subtreeEnd[child]!) {
      if (done === budget) {
        grouping.call = i;
        grouping.child = child;
        return done;
      }
      // Keyed by interned ids: the ones a mark matches rows on, hashed once per log.
      const id = eventIndex[child]!; // child is a row
      const keyId = paths.keyIdOf(id);
      let row = byKey.get(keyId);
      if (!row) {
        row = createEmptyAggregatedRow(ctx, paths.keyText(keyId), paths.step(pathId, keyId), child);
        byKey.set(keyId, row);
      }
      addCallToAggregatedRow(row, ctx, child, paths.stackIdOf(id), openStackId, usage);
      done++;
    }
  }
  grouping.call = i;
  grouping.child = NOT_STARTED;
  return done;
}

function byTotalTimeDesc(a: AggregatedRow, b: AggregatedRow): number {
  return b.totalTime - a.totalTime;
}

/** No frame open above the level, so nothing in it can be a recursive call. */
const NO_STACK = -1;

/** Averages, governor cost and the Show Details roll-up, once `_children` is set. */
function finaliseAggregatedRow(row: AggregatedRow, costLimits: CostLimits): void {
  calculateAverages(row);
  setGovernorCost(row, costLimits);
  row._hasDetailsDeep = computeHasDetailsDeep(row, row.totalTime, row.type);
}

function addTally(
  into: Tally,
  from: SelfTotalColumns<Int32Array | Float64Array>,
  row: number,
): void {
  into.self += from.self[row]!;
  into.total += from.total[row]!;
}

/** Adds the call on index row `call` to an aggregated row, leaving `totalTime` alone
 *  where the call is recursive: the frame open above this level already holds that time. */
function addCallToAggregatedRow(
  row: AggregatedRow,
  ctx: BuildContext,
  call: number,
  stackId: number,
  openStackId: number,
  reported: ReportedUsage | null,
): void {
  const m = ctx.metrics;
  row.callCount++;
  row.totalSelfTime += m.duration.self[call]!; // Always add self time

  // The stack id reads through the entry type, so CODE_UNIT_STARTED and
  // METHOD_ENTRY for the same method are one frame on the call stack.
  if (stackId !== openStackId) {
    row.totalTime += m.duration.total[call]!;
  }

  addTally(row.dmlCount, m.dmlCount, call);
  addTally(row.soqlCount, m.soqlCount, call);
  addTally(row.soslCount, m.soslCount, call);
  addTally(row.dmlRowCount, m.dmlRowCount, call);
  addTally(row.soqlRowCount, m.soqlRowCount, call);
  addTally(row.soslRowCount, m.soslRowCount, call);
  addTally(row.thrownCount, m.thrownCount, call);
  addTally(row.heapAllocated, m.heapAllocated, call);
  addTally(row.heapGross, m.heapGross, call);
  // Peak live heap aggregates by max (the worst single call), not sum.
  row.heapPeak = Math.max(row.heapPeak, m.heapPeak[call]!);
  const span = reported?.span(spanOf(ctx.index, call));
  if (span) {
    addReported(row.reported, span);
  }
  row.instances.push(ctx.index.eventIndex[call]!);
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
  /** The frame's index row. */
  row: number;
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
  /** Null where the span holds no reported point, or the log has no reported usage. */
  reported: ReportedCounts | null;
};

/**
 * One pass over the index rows in pre-order that fuses attribution computation
 * with trie insertion. The rows are in log order, so a frame closes when a row
 * past its subtree comes up: no tree walk.
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
 *     chain stack from top (= N) down to depth 0. The chain is the live
 *     ancestor path, so no parent walk and no per-step Map lookup is
 *     needed. Bucket-key comparisons are int equality on `_keyId`.
 *   - Restore `activeByStack[stackId]` from `ctx.prior`.
 *
 * Zero-delta guards on the DML/SOQL/row/thrown accumulators avoid the no-op
 * `bucket.x += 0` writes that dominate logs without heavy DB work.
 *
 * Yields after every {@link CHECK_EVERY} rows, so a caller can hand
 * the thread back between slices.
 */
function* bottomUpSteps(build: BuildContext): Generator<void, BottomUpRow[], void> {
  const { index, metrics: m, paths, reported } = build;
  if (index.rowCount === 0) {
    return [];
  }

  const { eventIndex, subtreeEnd } = index;
  const rootBuckets = new Map<number, BottomUpRow>();
  const activeByStack = new Map<number, FrameContext>();
  // The frames open above the next row, outermost first.
  const open: FrameContext[] = [];
  const chainIds: number[] = [];

  const enter = (row: number): void => {
    const id = eventIndex[row]!; // row < rowCount
    const keyId = paths.keyIdOf(id);
    chainIds.push(keyId);

    const stackId = paths.stackIdOf(id);
    const prior = activeByStack.get(stackId);
    const parent = open[open.length - 1];
    // A span sits inside its parent's, so under a parent that holds no point the search is skipped.
    const usage = !parent || parent.reported ? reported : null;
    const totalTime = m.duration.total[row]!;
    const dmlTotal = m.dmlCount.total[row]!;
    const soqlTotal = m.soqlCount.total[row]!;
    const soslTotal = m.soslCount.total[row]!;
    const dmlRowTotal = m.dmlRowCount.total[row]!;
    const soqlRowTotal = m.soqlRowCount.total[row]!;
    const soslRowTotal = m.soslRowCount.total[row]!;
    const thrownTotal = m.thrownCount.total[row]!;
    const heapTotal = m.heapAllocated.total[row]!;
    const heapGrossTotal = m.heapGross.total[row]!;
    const ctx: FrameContext = {
      row,
      stackId,
      prior,
      totalTime,
      dmlTotal,
      soqlTotal,
      soslTotal,
      dmlRowTotal,
      soqlRowTotal,
      soslRowTotal,
      thrownTotal,
      heapTotal,
      heapGrossTotal,
      reported: usage?.span(spanOf(index, row)) ?? null,
    };

    if (prior) {
      prior.totalTime -= totalTime;
      prior.dmlTotal -= dmlTotal;
      prior.soqlTotal -= soqlTotal;
      prior.soslTotal -= soslTotal;
      prior.dmlRowTotal -= dmlRowTotal;
      prior.soqlRowTotal -= soqlRowTotal;
      prior.soslRowTotal -= soslRowTotal;
      prior.thrownTotal -= thrownTotal;
      prior.heapTotal -= heapTotal;
      prior.heapGrossTotal -= heapGrossTotal;
      if (prior.reported && ctx.reported) {
        addReported(prior.reported, ctx.reported, -1);
      }
    }
    activeByStack.set(stackId, ctx);
    open.push(ctx);
  };

  const exit = (): void => {
    const ctx = open[open.length - 1]!;
    const { row } = ctx;

    // Hoist invariants once for the chain walk.
    const selfTime = m.duration.self[row]!;
    const dmlSelf = m.dmlCount.self[row]!;
    const soqlSelf = m.soqlCount.self[row]!;
    const soslSelf = m.soslCount.self[row]!;
    const dmlRowSelf = m.dmlRowCount.self[row]!;
    const soqlRowSelf = m.soqlRowCount.self[row]!;
    const soslRowSelf = m.soslRowCount.self[row]!;
    const thrownSelf = m.thrownCount.self[row]!;
    const heapSelf = m.heapAllocated.self[row]!;
    const heapGrossSelf = m.heapGross.self[row]!;
    // Peak live heap composes by max, so (unlike the additive totals) it needs no
    // deepest-frame subtraction — just max this node's peak into every chain row.
    const heapPeak = m.heapPeak[row]!;
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
    const frameReported = ctx.reported;

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
      if (frameReported) {
        addReported(b.reported, frameReported);
      }
    };

    const top = chainIds.length - 1;
    const rootId = chainIds[top]!;
    let bucket = rootBuckets.get(rootId);
    if (!bucket) {
      const pathId = paths.step(ROOT_PATH_ID, rootId);
      bucket = createEmptyBottomUpRow(build, paths.keyText(rootId), rootId, pathId, row);
      rootBuckets.set(rootId, bucket);
    }
    accumulate(bucket);
    bucket.instances.push(eventIndex[row]!);

    // Deeper buckets are keyed by successive ancestors. The open stack already
    // holds them — open[i].row is N's ancestor at depth i.
    let parentBucket = bucket;
    for (let i = top - 1; i >= 0; i--) {
      const ancestorId = chainIds[i]!;
      const existingChildren = parentBucket._children ?? [];
      let childBucket = existingChildren.find((c) => c._keyId === ancestorId);
      if (!childBucket) {
        const pathId = paths.step(parentBucket._pathId, ancestorId);
        childBucket = createEmptyBottomUpRow(
          build,
          paths.keyText(ancestorId),
          ancestorId,
          pathId,
          open[i]!.row,
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
    open.pop();
  };

  for (let row = 0; row < index.rowCount; row++) {
    // Close every frame whose subtree ended before this row.
    while (open.length > 0 && subtreeEnd[open[open.length - 1]!.row]! <= row) {
      exit();
    }
    enter(row);
    if ((row + 1) % CHECK_EVERY === 0) {
      yield;
    }
  }
  while (open.length > 0) {
    exit();
  }

  return yield* finalizeBuckets(rootBuckets, build.costLimits);
}

/**
 * {@link bottomUpSteps} run to the end in one task.
 *
 * @param index - the shown rows of `store`
 */
export function toBottomUpTree(
  index: LogIndex,
  store: LogStore,
  reported: ReportedUsage | null = null,
): BottomUpRow[] {
  return runSteps(bottomUpSteps(buildContext(index, store, reported)));
}

/**
 * {@link toBottomUpTree} of the store's shown rows, in slices that hand the thread
 * back between them (see {@link FrameBudgetOptions}). Returns null once
 * `options.signal` aborts.
 */
export async function buildBottomUpTree(
  store: LogStore,
  options: FrameBudgetOptions = {},
  reported: ReportedUsage | null = null,
): Promise<BottomUpRow[] | null> {
  const index = await store.logIndex();
  return driveSteps(bottomUpSteps(buildContext(index, store, reported)), options);
}

/**
 * Walks the bucket trie computing averages and applying deterministic ordering
 * (primary metric total-self desc, then name asc) at every level. Empty child
 * arrays are collapsed to null so a row with no children reads as a leaf.
 */
function* finalizeBuckets(
  rootBuckets: Map<number, BottomUpRow>,
  costLimits: CostLimits,
): Generator<void, BottomUpRow[], void> {
  const roots = Array.from(rootBuckets.values());
  // Pre-order, so walking it backwards meets every row after its children:
  // _hasDetailsDeep reads theirs.
  const order: BottomUpRow[] = [];
  const pending = roots.slice();
  while (pending.length > 0) {
    const row = pending.pop()!; // the loop guard keeps it non-empty
    order.push(row);
    for (const child of row._children ?? []) {
      pending.push(child);
    }
    if (order.length % CHECK_EVERY === 0) {
      yield;
    }
  }
  for (let i = order.length - 1; i >= 0; i--) {
    const row = order[i]!; // i is in range
    calculateBottomUpAverages(row);
    setGovernorCost(row, costLimits);
    if (row._children && row._children.length > 0) {
      sortBuckets(row._children);
    }
    row._hasDetailsDeep = computeHasDetailsDeep(row, row.totalTime, row.type);
    if (i % CHECK_EVERY === 0) {
      yield;
    }
  }
  sortBuckets(roots);
  return roots;
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

/** What a new row shows of its first call, on index row `row`. */
function rowLabels(build: BuildContext, row: number) {
  const { index, signatures } = build;
  const eventIndex = index.eventIndex[row]!; // row < rowCount
  const signature = signatures.of(eventIndex);
  return {
    text: signatures.text(signature),
    namespace: signatures.namespace(signature),
    callerNamespace: getCallerNamespace(build.store, eventIndex),
    type: signatures.type(signature),
    eventIndex,
    category: categoryName(index, row),
  };
}

function createEmptyAggregatedRow(
  build: BuildContext,
  key: string,
  pathId: number,
  row: number,
): AggregatedRow {
  // Copied field by field: a spread here made a 270k-event build 39% slower.
  const labels = rowLabels(build, row);
  return {
    id: build.idFor(),
    key,
    _pathId: pathId,
    text: labels.text,
    namespace: labels.namespace,
    callerNamespace: labels.callerNamespace,
    type: labels.type,
    eventIndex: labels.eventIndex,
    category: labels.category,
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
    reported: emptyReported(),
    _children: null,
    instances: [],
    _hasDetailsDeep: false,
  };
}

function createEmptyBottomUpRow(
  build: BuildContext,
  key: string,
  keyId: number,
  pathId: number,
  row: number,
): BottomUpRow {
  // Copied field by field: a spread here made a 270k-event build 39% slower.
  const labels = rowLabels(build, row);
  return {
    id: build.idFor(),
    key,
    _keyId: keyId,
    _pathId: pathId,
    text: labels.text,
    namespace: labels.namespace,
    callerNamespace: labels.callerNamespace,
    type: labels.type,
    eventIndex: labels.eventIndex,
    category: labels.category,
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
    reported: emptyReported(),
    _children: null,
    instances: [],
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
