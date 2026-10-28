/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { currentLogStore, type LogStore } from '#core/log/LogStore.js';
import { childRows, type LogIndex, NO_ROW } from '#core/log/LogIndex.js';
import { type EventKind, eventKind, rowKinds } from '#core/log/eventKind.js';
import { ROOT_PATH_ID, type KeyPathIds } from '#core/log/keyPathIds.js';
import type { TimeWindow } from '#core/log/rangeScope.js';
import { type Signatures, signaturesOf } from '#core/log/signatures.js';
import { CallSpans, SpanIndex, frameIn, reaches } from '#core/log/windowedTime.js';
import { overlapOf } from '#core/log/windowStats.js';
import { outermostIds } from '#core/utility/EventTree.js';
import {
  CHECK_EVERY,
  frameBudget,
  type FrameBudgetOptions,
  type Tick,
} from '#core/utility/FrameBudget.js';

/**
 * A row in the scoped call tree. `duration` is the frame's own, summed across
 * the occurrences a merged row stands for; `eventId` is the first of them,
 * used by the name formatter and navigation.
 */
export interface ScopedRow {
  id: number;
  /** The event id of the frame, or of a merged row's first occurrence. */
  eventId: number;
  text: string;
  type: string;
  duration: { total: number; self: number };
  callCount: number;
  /** Every occurrence the row stands for, when it merges several. Null on a row
   *  that is one frame, whose single occurrence is `eventId` — the whole-log
   *  tree is all such rows, so a list each would cost one array per event. */
  eventIds: number[] | null;
  /** True on a caller row: one of the frames above the selection, which the two
   *  top-down views root at. Such a row is a route to the selection, not a call
   *  inside it, so it holds the time that reached the selection rather than its
   *  own total, its self time is 0, its `callCount` is the occurrences it led to,
   *  and it is outside `ScopedCallTree.calls`. The tree opens these rows so the
   *  selection is on screen, and leaves what ran inside it closed. */
  onPath?: boolean;
  /** The interned bucket path of a row in a view whose rows merge occurrences:
   *  what tells it apart from a same-named row under another parent. Absent
   *  where a row is one frame, which its event id names. */
  _pathId?: number;
  /** Where a bottom-up row reads its occurrences. A caller row stands for the
   *  calls its chain conducted, so it derives them from the top-level row rather
   *  than holding a copy of the list. */
  _seed?: OccurrenceSeed;
  /** The frames the row itself stands for, once derived. */
  _frameIds?: number[];
  _children: ScopedRow[] | null;
}

/** The occurrences of one top-level bottom-up row, shared by every caller row
 *  under it. */
export interface OccurrenceSeed {
  eventIds: number[];
  /** The interned caller chain that reached each one, in the same order. */
  chains: number[];
  /** The table those ids were minted from. */
  paths: KeyPathIds;
}

/**
 * The event a scoped row reveals, or null when it merges occurrences. Aggregated
 * and bottom-up rows carry a synthetic negative id and keep only the first
 * occurrence, so revealing one would misname which occurrence was clicked.
 */
export function revealableEventId(row: Partial<ScopedRow> | undefined): number | null {
  const { id, eventId } = row ?? {};
  return id !== undefined && id >= 0 && eventId !== undefined ? eventId : null;
}

/**
 * Every occurrence a scoped row stands for. A merged row can be pointed at even
 * though it cannot be revealed: there is no one frame to jump to, but all of
 * them can be marked at once.
 */
export function locatableEventIds(row: Partial<ScopedRow> | undefined): number[] {
  if (row?.eventIds) {
    return row.eventIds;
  }
  const seed = row?._seed;
  if (seed) {
    // `_seed` is only ever set alongside `_pathId`.
    const pathId = row._pathId!;
    const { chains, eventIds, paths } = seed;
    // A hot bucket has thousands of occurrences but few distinct chains, so the
    // verdict is answered per chain and the walk runs once each.
    const through = new Map<number, boolean>();
    const derived: number[] = [];
    for (let i = 0; i < chains.length; i++) {
      const chain = chains[i]!;
      let hit = through.get(chain);
      if (hit === undefined) {
        hit = paths.reaches(chain, pathId);
        through.set(chain, hit);
      }
      if (hit) {
        derived.push(eventIds[i]!);
      }
    }
    // Kept once derived: a pointer sweep re-enters a row, and the click that
    // follows asks again.
    row.eventIds = derived;
    return derived;
  }
  const single = revealableEventId(row);
  return single === null ? [] : [single];
}

/**
 * The frames a scoped row stands for, which is what a highlight elsewhere points
 * at: the flame chart dims to them, and the call tree selects one.
 *
 * A bottom-up caller row is one of the frames above a call, so it stands for the
 * callers at its own depth rather than the calls they conducted, and stepping
 * down the callers walks the highlight up the stack.
 *
 * {@link locatableEventIds} stays the calls the row counts, which is what its
 * totals describe.
 */
export function frameEventIds(row: Partial<ScopedRow> | undefined): number[] {
  if (row?._frameIds) {
    return row._frameIds;
  }
  const conducted = locatableEventIds(row);
  const seed = row?._seed;
  const store = currentLogStore();
  if (!seed || !store) {
    return conducted;
  }
  // `_seed` is only ever set alongside `_pathId`.
  const levels = seed.paths.depthOf(row._pathId!) - 1;
  if (levels <= 0) {
    return conducted;
  }
  return (row._frameIds = store.framesAbove(conducted, levels));
}

/**
 * The rows of one view keyed by the bucket path each stands for, so a frame
 * named elsewhere can be found behind the synthetic id of a row that merges
 * occurrences. Keyed by path rather than by occurrence: a frame names the rows
 * its own path runs through, which the occurrences behind the rows need not be
 * read to answer.
 */
export function rowIdsByPath(rows: readonly ScopedRow[]): Map<number, number> {
  const byPath = new Map<number, number>();
  const stack = [...rows];
  while (stack.length) {
    const row = stack.pop()!;
    if (row._pathId !== undefined) {
      // One row per path in a view: a bucket is minted per parent path and key.
      byPath.set(row._pathId, row.id);
    }
    if (row._children) {
      // Pushed one at a time: a spread (and `push.apply`) passes each element as
      // an argument, and a wide level would overrun the argument limit.
      for (const child of row._children) {
        stack.push(child);
      }
    }
  }
  return byPath;
}

export interface ScopedCallTree {
  /** The selected node's total time (ns) — the % denominator for the bars. */
  rootTotal: number;
  /** Every call the scope holds, the selection's own included, counted once. The
   *  callers above the selection are routes to it rather than calls inside it, so
   *  they are not in the figure — see `ScopedRow.onPath`. */
  calls: number;
  /** The whole log's total time (ns). It sizes the bar columns once for the log
   *  instead of per selection, so the widths stay put as the selection changes. */
  logTotal: number;
  /** True where Time Order merges the occurrences of one frame, so its rows carry
   *  synthetic ids like the grouped views rather than event ids. */
  timeOrderMerged: boolean;
  /**
   * True where the frame is one this tree stands for. Absent on the whole-log
   * tree, which stands for every frame.
   *
   * A merged row is named by its bucket path, and a frame elsewhere in the log
   * can sit at the same path — a second call of the same method, which a loop or
   * a trigger makes common. So a mark asks the tree rather than trusting the path.
   */
  holds?: (eventId: number) => boolean;
  /** The three views, built on first call and cached (only one is on screen).
   *  Each hands the frame back as it works, and returns null when abandoned. */
  timeOrder(options: FrameBudgetOptions): Promise<ScopedRow[] | null>;
  aggregated(options: FrameBudgetOptions): Promise<ScopedRow[] | null>;
  bottomUp(options: FrameBudgetOptions): Promise<ScopedRow[] | null>;
  /** Reads the rows inside a window of the log. Only the whole-log tree has it:
   *  a selection is never cut by a window. */
  liveWindow?(): LiveWindow;
}

/**
 * The whole-log tree's rows following a window. The rows stay the same objects;
 * a row is read into the window when it is admitted, so only the rows a table
 * shows are ever worked out.
 */
export interface LiveWindow {
  /**
   * Reads ahead what `rows` need to follow a window, a slice at a time, so the
   * first window costs no more than any other. False when abandoned. Until it
   * lands, `set` counts the calls of the whole log.
   */
  prepare(rows: readonly ScopedRow[], options: FrameBudgetOptions): Promise<boolean>;
  /** The figures the footer and the bars read for `window`, or the whole log on
   *  null. `self` is the self time of every row, shown or not, and `frameSelf`
   *  leaves out the pinned blocks Bottom-Up has no row for; both null until
   *  `prepare` lands. */
  figures(window: TimeWindow | null): {
    rootTotal: number;
    calls: number;
    self: number | null;
    frameSelf: number | null;
  };
  /** Moves to `window`, or back to the whole log on null, and returns its {@link figures}. */
  set(window: TimeWindow | null): ReturnType<LiveWindow['figures']>;
  /** Writes the row's time and calls inside the window into it, and says
   *  whether any of the row is there. A row of many calls not yet prepared,
   *  once a filter pass has spent its time, keeps its figures and is listed by
   *  {@link waiting}. */
  admit(row: ScopedRow): boolean;
  /** The rows `admit` left for `prepare` since the last call. */
  waiting(): ScopedRow[];
}

/** A built subtree and the frames it kept, so the scope can be counted without a
 *  second walk. */
interface Subtree {
  row: ScopedRow;
  calls: number;
}

/** What the walks read the shown rows by. */
interface Rows {
  index: LogIndex;
  signatures: Signatures;
  kindOf: (row: number) => EventKind;
}

function rowsOf(index: LogIndex): Rows {
  return {
    index,
    signatures: signaturesOf(index.log),
    kindOf: rowKinds(index),
  };
}

/** A row for the frame at index row `row`. */
function frameRow(rows: Rows, row: number, onPath: boolean): ScopedRow {
  const { index, signatures } = rows;
  const id = index.eventId[row]!;
  const signature = signatures.of(id);
  return {
    id,
    eventId: id,
    text: signatures.text(signature),
    type: signatures.type(signature),
    duration: onPath ? { total: 0, self: 0 } : { total: index.total[row]!, self: index.self[row]! },
    callCount: !onPath && rows.kindOf(row) === 'frame' ? 1 : 0,
    eventIds: null,
    ...(onPath ? { onPath: true } : {}),
    _children: onPath ? [] : null,
  };
}

/** `top` and its subtree less its details; null only when abandoned, as a selection is kept whatever it is. */
async function realSubtree(
  source: Rows,
  top: number,
  tick: Tick,
  rootsAreSelection: boolean,
): Promise<Subtree | null> {
  if (!(await tick())) {
    return null;
  }
  const { subtreeEnd } = source.index;
  const end = subtreeEnd[top]!;
  const root = frameRow(source, top, false);
  let calls = rootsAreSelection || source.kindOf(top) === 'frame' ? 1 : 0;
  root.callCount = calls;
  // The open rows above the current one, with the index row each ends before. The root ends last, so it never pops.
  const open: Array<{ row: ScopedRow; end: number }> = [{ row: root, end }];
  let steps = 1;
  for (let at = top + 1; at < end;) {
    if (steps++ % CHECK_EVERY === 0 && !(await tick())) {
      return null;
    }
    while (open.at(-1)!.end <= at) {
      open.pop();
    }
    const kind = source.kindOf(at);
    if (kind === 'detail') {
      at = subtreeEnd[at]!;
      continue;
    }
    const row = frameRow(source, at, false);
    (open.at(-1)!.row._children ??= []).push(row);
    // A pinned detail is a row, not a call.
    if (kind === 'frame') {
      calls += 1;
    }
    open.push({ row, end: subtreeEnd[at]! });
    at++;
  }
  return { row: root, calls };
}

/**
 * The selection with its callers above it: one branch per distinct path, joined
 * where they share an ancestor.
 *
 * A caller row holds the selected time that reached the selection through it,
 * not its own total, so the tree reads as the selection all the way down: 100%
 * at the top, still 100% at the selection, and the rows below it are shares of
 * it. Its self time is 0 — none of that time is the caller's own work — and its
 * call count is the occurrences it led to.
 *
 * The log root is not a row, as it is not one in the whole-log tree either, so a
 * selection at the top of the log has no path and stands as its own root.
 */
async function pathRoots(
  selectedIds: readonly number[],
  subtrees: readonly ScopedRow[],
  source: Rows,
  tick: Tick,
): Promise<ScopedRow[] | null> {
  const { index } = source;
  const roots: ScopedRow[] = [];
  // One row has one parent, so it sits at one place in the tree: a flat map
  // is enough to join the paths where they meet.
  const nodeByRow = new Map<number, ScopedRow>();

  // Counted per node, not per occurrence: one occurrence costs a walk of its
  // whole ancestor chain, so a deep stack would otherwise overrun the slice.
  let steps = 0;
  for (let i = 0; i < selectedIds.length; i++) {
    if (steps++ % CHECK_EVERY === 0 && !(await tick())) {
      return null;
    }
    const at = index.rowOf(selectedIds[i]!);
    const contributed = index.total[at]!;

    // Outermost first.
    const ancestors: number[] = [];
    for (let up = index.parent[at]!; up !== NO_ROW; up = index.parent[up]!) {
      ancestors.push(up);
    }

    let into = roots;
    for (let a = ancestors.length - 1; a >= 0; a--) {
      if (steps++ % CHECK_EVERY === 0 && !(await tick())) {
        return null;
      }
      const ancestor = ancestors[a]!;
      let node = nodeByRow.get(ancestor);
      if (!node) {
        node = frameRow(source, ancestor, true);
        nodeByRow.set(ancestor, node);
        into.push(node);
      }
      node.duration.total += contributed;
      node.callCount += 1;
      into = node._children as ScopedRow[];
    }
    into.push(subtrees[i]!);
  }
  return roots;
}

/** Each index row's real subtree as a root row, with the frames they hold between
 *  them; null when the walk is abandoned. */
async function subtreeRoots(
  source: Rows,
  tops: readonly number[],
  tick: Tick,
  { rootsAreSelection }: { rootsAreSelection: boolean },
): Promise<{ roots: ScopedRow[]; calls: number } | null> {
  const roots: ScopedRow[] = [];
  let calls = 0;
  for (const top of tops) {
    const subtree = await realSubtree(source, top, tick, rootsAreSelection);
    if (!subtree) {
      return null;
    }
    roots.push(subtree.row);
    calls += subtree.calls;
  }
  return { roots, calls };
}

/**
 * The call tree filtered to the selection. The two top-down views root at the
 * log and keep only the paths that reach the selection, so how it was called is
 * read with where its time went; bottom-up keeps the selection's subtree alone,
 * as ranking leaves by self time is what it is for. Returns the three views
 * (time-order / aggregated / bottom-up) or null when nothing is selected.
 *
 * An aggregate selection scopes to every occurrence, and a frame can occur tens
 * of thousands of times, so the walk is sliced: it hands the thread back through
 * `options.yieldSlice` rather than blocking on the whole selection at once.
 * Nothing is capped or sampled — every occurrence is counted, just not all in
 * one frame.
 */
export async function buildScopedCallTree(
  eventId: number,
  eventIds: number[] | null | undefined,
  options: FrameBudgetOptions,
): Promise<ScopedCallTree | null> {
  const store = currentLogStore();
  if (!store) {
    return null;
  }
  const apexLog = store.log;
  const index = await store.logIndex();
  const source = rowsOf(index);

  // An aggregate selection scopes to every occurrence of the frame; a single
  // selection to just itself.
  const askedIds = eventIds?.length ? eventIds : eventId >= 0 ? [eventId] : [];
  // An occurrence inside another would otherwise be walked once per enclosing call.
  const selectedIds = outermostIds(
    apexLog,
    askedIds.filter((id) => store.isShown(id)),
  );
  if (!selectedIds.length) {
    return null;
  }
  const selectedRows = selectedIds.map((id) => index.rowOf(id));

  // Percentages are relative to the whole selection (summed across occurrences).
  const rootTotal = selectedRows.reduce((sum, row) => sum + index.total[row]!, 0);

  const tick = frameBudget(options);
  const scope = await subtreeRoots(source, selectedRows, tick, { rootsAreSelection: true });
  if (!scope) {
    return null;
  }

  // The two top-down views root the selection under its callers, so a caller is
  // a row here too. Built on the first mark, since only a pointer needs it.
  let callers: Set<number> | null = null;
  const selected = new Set(selectedIds);
  const holds = (eventId: number): boolean => {
    if (selected.has(eventId)) {
      return true;
    }
    callers ??= callerIds(store, selectedIds);
    if (callers.has(eventId)) {
      return true;
    }
    if (!store.isShown(eventId)) {
      return false;
    }
    for (let id = store.parentOf(eventId); id > 0; id = store.parentOf(id)) {
      if (selected.has(id)) {
        return true;
      }
    }
    return false;
  };

  return lazyCallTree({
    holds,
    // Only the two top-down views read the callers, and bottom-up is what most
    // selections open on, so the spine is built on first read like the views are.
    topDown: (viewOptions) => pathRoots(selectedIds, scope.roots, source, frameBudget(viewOptions)),
    bottomUp: scope.roots,
    rootTotal,
    logTotal: apexLog.duration.total,
    calls: scope.calls,
    store,
    index,
    // Occurrences of one frame are the same call made again, so merge them into a
    // single root; a single occurrence is already that.
    mergeTimeOrder: scope.roots.length > 1,
    rootsAreSelection: true,
  });
}

/** Every frame above the selection: the rows the two top-down views root it in. */
function callerIds(store: LogStore, selectedIds: readonly number[]): Set<number> {
  const above = new Set<number>();
  for (const selectedId of selectedIds) {
    for (let id = store.parentOf(selectedId); id > 0; id = store.parentOf(id)) {
      if (above.has(id)) {
        break; // this chain, and every chain above it, is already in
      }
      above.add(id);
    }
  }
  return above;
}

/** What the three views are built from. */
interface CallTreeInput {
  /** The rows the two top-down views read: the selection under its callers. */
  topDown(options: FrameBudgetOptions): Promise<ScopedRow[] | null>;
  /** The rows bottom-up reads: the selection's own subtree, callers left out. */
  bottomUp: ScopedRow[];
  rootTotal: number;
  logTotal: number;
  calls: number;
  /** The log, which the merged views take their interned keys and paths from. */
  store: LogStore;
  /** The shown rows of `store`, which a row reads its frame's whole time from. */
  index: LogIndex;
  /** {@link ScopedCallTree.holds}, absent where the tree stands for the whole log. */
  holds?: (eventId: number) => boolean;
  /** Folds the occurrences of one frame into a single root (a scoped aggregate),
   *  which makes Time Order the same answer as Aggregated. The whole-log tree and
   *  a single occurrence keep their exact order. */
  mergeTimeOrder: boolean;
  /** Filled by the bottom-up walk where the tree follows a window: see {@link Holes}. */
  holes?: Holes;
  /** Bottom-up seeds each root whatever its kind, as a selection is kept whatever it is. */
  rootsAreSelection: boolean;
}

// Each recursive frame's nested calls of itself by event id, which bottom-up takes off its time.
type Holes = Map<number, number[]>;

// Time Order rows hold the window's figures once it is read, so the views built from them read the frame's.
function wholeTotal(index: LogIndex, row: ScopedRow): number {
  return row.onPath ? row.duration.total : index.total[index.rowOf(row.eventId)]!;
}

function wholeSelf(index: LogIndex, row: ScopedRow): number {
  return row.onPath ? row.duration.self : index.self[index.rowOf(row.eventId)]!;
}

/**
 * The three lazy views over a scope. Only one view is on screen, so each is
 * built on first read and cached — aggregate()/buildBottomUp() are full walks of
 * every retained subtree.
 */
function lazyCallTree(input: CallTreeInput): ScopedCallTree {
  const { rootTotal, calls, logTotal, mergeTimeOrder, store, index, holds } = input;
  let topDownRows: ScopedRow[] | null = null;
  let aggregatedRows: ScopedRow[] | null = null;
  let bottomUpRows: ScopedRow[] | null = null;
  const topDown = async (options: FrameBudgetOptions) =>
    (topDownRows ??= await input.topDown(options));
  return {
    rootTotal,
    calls,
    logTotal,
    timeOrderMerged: mergeTimeOrder,
    holds,
    async timeOrder(viewOptions) {
      // Merged, the two views are the same walk, so they share one answer.
      return mergeTimeOrder ? this.aggregated(viewOptions) : topDown(viewOptions);
    },
    async aggregated(viewOptions) {
      if (!aggregatedRows) {
        const rows = await topDown(viewOptions);
        aggregatedRows = rows && (await aggregate(rows, store, index, viewOptions));
      }
      return aggregatedRows;
    },
    async bottomUp(viewOptions) {
      bottomUpRows ??= await buildBottomUp(
        input.bottomUp,
        store,
        index,
        viewOptions,
        input.holes,
        input.rootsAreSelection,
      );
      return bottomUpRows;
    },
  };
}

/**
 * The whole log's call tree — every root event with its real subtree and real
 * durations. The scoped builder cannot answer this: it starts at a selection,
 * so it never reaches the roots above one.
 *
 * Same three views, same slicing, same details dropped as the scoped tree;
 * `rootTotal` and `logTotal` are both the log's total, so bars are percentages
 * of the whole log.
 */
export async function buildWholeLogCallTree(
  options: FrameBudgetOptions,
): Promise<ScopedCallTree | null> {
  const store = currentLogStore();
  const apexLog = store?.log;
  if (!store || !apexLog) {
    return null;
  }

  const index = await store.logIndex();
  const source = rowsOf(index);
  const tick = frameBudget(options);
  const roots = childRows(index, NO_ROW).filter((row) => source.kindOf(row) !== 'detail');
  const scope = await subtreeRoots(source, roots, tick, { rootsAreSelection: false });
  if (!scope) {
    return null;
  }

  const holes: Holes = new Map();
  // Already the log's own event order, with real durations — no merging.
  const tree = lazyCallTree({
    // Nothing is selected, so there is no path above anything.
    topDown: () => Promise.resolve(scope.roots),
    bottomUp: scope.roots,
    rootTotal: apexLog.duration.total,
    logTotal: apexLog.duration.total,
    calls: scope.calls,
    store,
    index,
    mergeTimeOrder: false,
    holes,
    rootsAreSelection: false,
  });
  tree.liveWindow = () => liveWindow(source, scope, holes);
  return tree;
}

// How long one filter pass may spend reading rows of many calls before it leaves them for prepare.
const PASS_MS = 8;

// Figures are written into the row itself, so the table's sort and footer read them unchanged.
function liveWindow(
  source: Rows,
  scope: { roots: ScopedRow[]; calls: number },
  holes: Holes,
): LiveWindow {
  const { index } = source;
  const { columns, duration } = index.log;
  let window: TimeWindow | null = null;
  const indexes = new WeakMap<ScopedRow, SpanIndex>();
  let spans: CallSpans | null = null;
  // Every instant inside a root is one row's self time, and inside a pinned block a pinned row's.
  let selfCover: { roots: SpanIndex; pinned: SpanIndex } | null = null;
  const waiting = new Set<ScopedRow>();
  // Shared, so two views reading ahead at once read the log once.
  let readingLog: Promise<boolean> | null = null;
  let passEnd: number | null = null;

  // A filter pass is one task, so it ends at the next microtask.
  const passHasTime = (): boolean => {
    if (passEnd === null) {
      passEnd = performance.now() + PASS_MS;
      queueMicrotask(() => {
        passEnd = null;
      });
    }
    return performance.now() < passEnd;
  };

  const readLog = async (tick: Tick): Promise<boolean> => {
    const walked = await framesOf(scope.roots, tick);
    const built = walked && (await CallSpans.build(index, walked.frameIds, tick));
    const roots = built && (await SpanIndex.build(index, walked.rootIds, undefined, tick));
    const pinned = roots && (await SpanIndex.build(index, walked.pinnedIds, undefined, tick));
    if (!pinned) {
      return false;
    }
    spans = built;
    selfCover = { roots, pinned };
    return true;
  };

  const figures = (at: TimeWindow | null) => {
    const self = selfCover ? selfCover.roots.in(at).total : null;
    const frameSelf = selfCover && self !== null ? self - selfCover.pinned.in(at).total : null;
    if (!at) {
      return { rootTotal: duration.total, calls: scope.calls, self, frameSelf };
    }
    return {
      // Row 0 of the columns is the log itself.
      rootTotal: overlapOf(columns.startTimestamp[0]!, columns.endTimestamp[0]!, at),
      calls: spans?.in(at) ?? scope.calls,
      self,
      frameSelf,
    };
  };

  const merges = (row: ScopedRow) => !!(row._seed || row.eventIds);
  const occurrenceBound = (row: ScopedRow) => (row._seed?.eventIds ?? row.eventIds ?? []).length;
  const indexOf = (row: ScopedRow): SpanIndex => {
    let spanIndex = indexes.get(row);
    if (!spanIndex) {
      spanIndex = SpanIndex.of(index, locatableEventIds(row), row._seed ? holes : undefined);
      indexes.set(row, spanIndex);
    }
    return spanIndex;
  };

  return {
    async prepare(rows, options) {
      const tick = frameBudget(options);
      if (!spans) {
        readingLog ??= readLog(tick);
        if (!(await readingLog)) {
          readingLog = null;
          return false;
        }
      }
      for (const row of rows) {
        if (!merges(row) || indexes.has(row)) {
          continue;
        }
        if (!(await tick())) {
          return false;
        }
        const spanIndex = await SpanIndex.build(
          index,
          locatableEventIds(row),
          row._seed ? holes : undefined,
          tick,
        );
        if (!spanIndex) {
          return false;
        }
        indexes.set(row, spanIndex);
      }
      return true;
    },

    figures,

    set(next) {
      window = next;
      return figures(next);
    },

    waiting() {
      const rows = [...waiting];
      waiting.clear();
      return rows;
    },

    admit(row) {
      if (!merges(row)) {
        const id = row.eventId;
        if (window) {
          const own = frameIn(index, id, window);
          row.duration.total = own.total;
          row.duration.self = own.self;
          return reaches(index, id, window);
        }
        row.duration.total = wholeTotal(index, row);
        row.duration.self = wholeSelf(index, row);
        return true;
      }
      if (!indexes.has(row)) {
        if (!window) {
          return true; // never read into a window, so it still holds the whole log's figures
        }
        if (occurrenceBound(row) > CHECK_EVERY && !passHasTime()) {
          waiting.add(row);
          return true;
        }
      }
      const held = indexOf(row).in(window);
      row.duration.total = held.total;
      // A caller row is a route to its seed's time; only the top-level row shares the seed's list.
      row.duration.self = row._seed && row.eventIds !== row._seed.eventIds ? 0 : held.self;
      // A pinned block is a row, not a call, as the footer counts it.
      row.callCount = eventKind(row.type) === 'frame' ? held.calls : 0;
      return held.calls > 0;
    },
  };
}

/** The event ids of the frames the rows hold, of the root rows, and of the outermost pinned rows. */
async function framesOf(
  roots: readonly ScopedRow[],
  tick: Tick,
): Promise<{ frameIds: number[]; rootIds: number[]; pinnedIds: number[] } | null> {
  const frameIds: number[] = [];
  const pinnedIds: number[] = [];
  const stack = [...roots];
  let steps = 0;
  while (stack.length) {
    if (steps++ % CHECK_EVERY === 0 && !(await tick())) {
      return null;
    }
    const row = stack.pop()!; // non-empty: the loop condition just checked
    const kind = eventKind(row.type);
    if (kind === 'pinned') {
      // What a pinned block holds is pinned too, and already inside its span.
      pinnedIds.push(row.eventId);
      continue;
    }
    if (kind === 'frame') {
      frameIds.push(row.eventId);
    }
    if (row._children) {
      for (const child of row._children) {
        stack.push(child);
      }
    }
  }
  return { frameIds, rootIds: roots.map((row) => row.eventId), pinnedIds };
}

/** Top-down aggregation: merge sibling frames sharing a key, summing metrics. */
async function aggregate(
  rows: ScopedRow[],
  store: LogStore,
  index: LogIndex,
  options: FrameBudgetOptions,
): Promise<ScopedRow[] | null> {
  const paths = store.keyPathIds();
  const tick = frameBudget(options);
  let idSeq = 0;
  const nextId = () => (idSeq -= 1);

  // The recursion follows the call depth, which is shallow; each level's input
  // is the wide dimension, so that is where the slicing goes.
  async function merge(input: ScopedRow[], parentPathId: number): Promise<ScopedRow[] | null> {
    // The occurrences behind each group are a set, so one frame cannot be listed
    // twice; `groups` keeps its own insertion order, so it is also the output
    // order.
    const groups = new Map<number, { row: ScopedRow; seen: Set<number> }>();
    for (let i = 0; i < input.length; i++) {
      if (i % CHECK_EVERY === 0 && !(await tick())) {
        return null;
      }
      const row = input[i]!;
      const key = paths.keyIdOf(row.eventId);
      let held = groups.get(key);
      if (!held) {
        const group: ScopedRow = {
          id: nextId(),
          eventId: row.eventId,
          text: row.text,
          type: row.type,
          duration: { total: 0, self: 0 },
          callCount: 0,
          eventIds: [],
          onPath: row.onPath,
          _pathId: paths.step(parentPathId, key),
          _children: [],
        };
        held = { row: group, seen: new Set() };
        groups.set(key, held);
      }
      const group = held.row;
      if (!row.onPath) {
        // A group holding one real call is not a route, so it stays closed.
        group.onPath = undefined;
      }
      group.duration.total += wholeTotal(index, row);
      group.duration.self += wholeSelf(index, row);
      group.callCount += row.callCount;
      // Every merged occurrence, so pointing at the group points at all of them.
      for (const eventId of locatableEventIds(row)) {
        held.seen.add(eventId);
      }
      if (row._children) {
        const kids = group._children as ScopedRow[];
        for (const child of row._children) {
          kids.push(child);
        }
      }
    }

    const merged: ScopedRow[] = [];
    for (const { row: group, seen } of groups.values()) {
      group.eventIds = [...seen];
      const kids = group._children as ScopedRow[];
      if (kids.length) {
        const mergedKids = await merge(kids, group._pathId!);
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

  return merge(rows, ROOT_PATH_ID);
}

interface BottomUpNode extends ScopedRow {
  _pathId: number;
  _seed: OccurrenceSeed;
}

/** A frame on the walk. Both visits share it, so each key is built once and the
 *  time the frame keeps survives from the first visit to the second. A child
 *  carries its parent's entry as its caller chain, so the ancestor path costs no
 *  link of its own. */
interface WalkEntry {
  row: ScopedRow;
  callers: WalkEntry | null;
  /** The frame's bucket key, interned: a chain link is stepped by id, and the
   *  key is built once for the log rather than once per visit. */
  keyId: number;
  /** The frame's stack key, interned: the walk only ever compares it. */
  stackId: number;
  leaving: boolean;
  /** The frame's time, less every call of the same frame inside it. */
  attributed: number;
  /** The enclosing call of the same frame, restored on the way out. */
  outer: WalkEntry | null;
}

/**
 * Bottom-up: a seed frame heads a top-level row and its callers nest beneath it
 * up to the root — the reverse of the call path, with the seed's time attributed
 * to every caller as `total`.
 *
 * Every frame seeds a row, ranked by self, so the view answers where the time
 * went inside whatever the rows cover: the selection when they are scoped to one,
 * else the whole log. A pinned detail seeds none unless it is the selection, as
 * the Call Tree tab's bottom-up hides them.
 *
 * A row's `total` is its frames' time with recursion counted once: a call of the
 * same frame inside another comes off the outer call, so the two never both
 * claim the time they share. This is the attribution the Call Tree tab's
 * bottom-up uses, so the two agree on a recursive frame.
 */
async function buildBottomUp(
  rows: ScopedRow[],
  store: LogStore,
  index: LogIndex,
  options: FrameBudgetOptions,
  holes: Holes | undefined,
  rootsAreSelection: boolean,
): Promise<ScopedRow[] | null> {
  const paths = store.keyPathIds();
  const tick = frameBudget(options);
  let idSeq = 0;
  const nextId = () => (idSeq -= 1);
  // An abandoned build left some behind.
  holes?.clear();
  const nodeByPath = new Map<number, BottomUpNode>();
  const topOrder: BottomUpNode[] = [];

  /**
   * The row for a path, minted on first use and linked under its caller as it is.
   * A path is unique to a row, so it is what the tree is keyed by.
   *
   * @param under - the row this one nests in, null for a top-level row
   */
  const ensure = (under: BottomUpNode | null, src: ScopedRow, pathId: number): BottomUpNode => {
    let node = nodeByPath.get(pathId);
    if (!node) {
      node = {
        id: nextId(),
        eventId: src.eventId,
        text: src.text,
        type: src.type,
        duration: { total: 0, self: 0 },
        callCount: 0,
        // A top-level row holds its occurrences; a caller row derives its own
        // from that row, so it stores none.
        eventIds: under ? null : [],
        _seed: under ? under._seed : { eventIds: [], chains: [], paths },
        _pathId: pathId,
        _children: null,
      };
      if (under) {
        (under._children ??= []).push(node);
      } else {
        node.eventIds = node._seed.eventIds;
        topOrder.push(node);
      }
      nodeByPath.set(pathId, node);
    }
    return node;
  };

  // The innermost call of each frame still open on the walk's current path. A
  // frame's own time is only final once every call of it inside has come off, so
  // a row is filled in on the way out rather than on the way in. Keyed as the
  // Call Tree tab keys recursion, without the event type, so a code unit that
  // recurses as a method entry is the same frame to both.
  const open = new Map<number, WalkEntry | null>();

  const entryFor = (row: ScopedRow, callers: WalkEntry | null): WalkEntry => ({
    row,
    callers,
    keyId: paths.keyIdOf(row.eventId),
    stackId: paths.stackIdOf(row.eventId),
    leaving: false,
    attributed: 0,
    outer: null,
  });

  // Iterative pre-order over every occurrence's subtree: both the occurrence
  // count and the subtree size grow, so one flat sliceable loop covers both.
  const stack: WalkEntry[] = [];
  for (let i = rows.length - 1; i >= 0; i--) {
    stack.push(entryFor(rows[i]!, null));
  }
  let steps = 0;
  while (stack.length) {
    if (steps++ % CHECK_EVERY === 0 && !(await tick())) {
      return null;
    }
    const entry = stack.pop()!;
    const { row, callers } = entry;
    if (!entry.leaving) {
      const outer = open.get(entry.stackId) ?? null;
      if (outer) {
        // Inside a call of the same frame, so this call's time is already part
        // of that one's.
        outer.attributed -= wholeTotal(index, row);
        if (holes) {
          const outerId = outer.row.eventId;
          const held = holes.get(outerId);
          if (held) {
            held.push(row.eventId);
          } else {
            holes.set(outerId, [row.eventId]);
          }
        }
      }
      entry.outer = outer;
      entry.attributed = wholeTotal(index, row);
      open.set(entry.stackId, entry);
      entry.leaving = true;
      stack.push(entry);
      if (row._children) {
        for (let i = row._children.length - 1; i >= 0; i--) {
          stack.push(entryFor(row._children[i]!, entry));
        }
      }
      continue;
    }

    open.set(entry.stackId, entry.outer);
    const attributed = entry.attributed;
    const ownSelf = wholeSelf(index, row);
    if (eventKind(row.type) === 'frame' || (rootsAreSelection && !callers)) {
      // The seed row, then its callers up to the root. The chain is already in
      // that order, so it is walked in place rather than copied and reversed.
      let pathId = paths.step(ROOT_PATH_ID, entry.keyId);
      const seed = ensure(null, row, pathId);
      seed.duration.total += attributed;
      seed.duration.self += ownSelf;
      seed.callCount += 1;
      let node = seed;
      for (let link = callers; link; link = link.callers) {
        pathId = paths.step(pathId, link.keyId);
        node = ensure(node, link.row, pathId);
        node.duration.total += attributed;
        // Callers count the call they contributed too, matching the Call Tree
        // tab's bottom-up (every bucket in the chain accumulates); counting
        // only the seed left every caller row reading "Calls 0".
        node.callCount += 1;
      }
      // Each occurrence is tagged with the chain that reached it, which is how a
      // caller row picks out the ones it stands for.
      const occurrences = seed._seed;
      const held = row.eventIds;
      if (held) {
        for (let i = 0; i < held.length; i++) {
          occurrences.eventIds.push(held[i]!);
          occurrences.chains.push(pathId);
        }
      } else {
        occurrences.eventIds.push(row.eventId);
        occurrences.chains.push(pathId);
      }
    }
  }

  return topOrder.sort((a, b) => b.duration.self - a.duration.self);
}
