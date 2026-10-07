/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { LogEvent } from '@apexdevtools/apex-log-parser';

import { currentLogStore, type LogStore } from '../core/log/LogStore.js';
import { ROOT_PATH_ID, type KeyPathIds } from '../core/log/keyPathIds.js';
import type { TimeWindow } from '../core/log/rangeScope.js';
import { CallSpans, SpanIndex, frameIn, reaches } from '../core/log/windowedTime.js';
import { endOf, overlapOf } from '../core/log/windowStats.js';
import { outermostEvents } from '../core/utility/EventTree.js';
import { EXCLUDED_DETAIL_TYPES } from '../features/call-tree/utils/DetailsFilter.js';
import {
  CHECK_EVERY,
  frameBudget,
  type FrameBudgetOptions,
  type Tick,
} from '../core/utility/FrameBudget.js';

/**
 * A row in the scoped call tree. `duration` is the frame's own, summed across
 * the occurrences a merged row stands for; `originalData` is the first of them,
 * used by the name formatter and navigation.
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
  /** True on a caller row: one of the frames above the selection, which the two
   *  top-down views root at. Such a row is a route to the selection, not a call
   *  inside it, so it holds the time that reached the selection rather than its
   *  own total, its self time is 0, its `callCount` is the occurrences it led to,
   *  and it is outside `ScopedCallTree.calls`. The tree opens these rows so the
   *  selection is on screen, and leaves what ran inside it closed. */
  onPath?: boolean;
  /** The interned bucket path of a row in a view whose rows merge occurrences:
   *  what tells it apart from a same-named row under another parent. Absent
   *  where a row is one frame, which its event index names. */
  _pathId?: number;
  /** Where a bottom-up row reads its occurrences. A caller row stands for the
   *  calls its chain conducted, so it derives them from the top-level row rather
   *  than holding a copy of the list. */
  _seed?: OccurrenceSeed;
  /** The frames the row itself stands for, once derived. */
  _frameIndexes?: number[];
  _children: ScopedRow[] | null;
}

/** The occurrences of one top-level bottom-up row, shared by every caller row
 *  under it. */
export interface OccurrenceSeed {
  eventIndexes: number[];
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
  const seed = row?._seed;
  if (seed) {
    // `_seed` is only ever set alongside `_pathId`.
    const pathId = row._pathId!;
    const { chains, eventIndexes, paths } = seed;
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
        derived.push(eventIndexes[i]!);
      }
    }
    // Kept once derived: a pointer sweep re-enters a row, and the click that
    // follows asks again.
    row.eventIndexes = derived;
    return derived;
  }
  const single = revealableEventIndex(row);
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
 * {@link locatableEventIndexes} stays the calls the row counts, which is what its
 * totals describe.
 */
export function frameEventIndexes(row: Partial<ScopedRow> | undefined): number[] {
  if (row?._frameIndexes) {
    return row._frameIndexes;
  }
  const conducted = locatableEventIndexes(row);
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
  return (row._frameIndexes = store.framesAbove(conducted, levels));
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
   *  synthetic ids like the grouped views rather than event indexes. */
  timeOrderMerged: boolean;
  /**
   * True where the frame is one this tree stands for. Absent on the whole-log
   * tree, which stands for every frame.
   *
   * A merged row is named by its bucket path, and a frame elsewhere in the log
   * can sit at the same path — a second call of the same method, which a loop or
   * a trigger makes common. So a mark asks the tree rather than trusting the path.
   */
  holds?: (eventIndex: number) => boolean;
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
   *  null. `self` is the self time of every row, shown or not; null until
   *  `prepare` lands. */
  figures(window: TimeWindow | null): { rootTotal: number; calls: number; self: number | null };
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

/**
 * The selected node + its real subtree, with real durations. Zero-duration
 * bookkeeping rows (heap allocations, statements, assignments) are dropped —
 * the Inspector is a summary, and the Call Tree tab is where those details are
 * read. So are the limit and profiling blocks, which report governor figures
 * rather than time; the Call stack already drops the same four types. The
 * selection itself is kept whatever it is, so null means the build was
 * abandoned rather than "nothing worth showing".
 *
 * Iterative rather than recursive: subtree size is the second unbounded
 * dimension (the occurrence count is the first), and both have to be sliceable.
 */
async function realSubtree(event: LogEvent, tick: Tick): Promise<Subtree | null> {
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
      const child = current.children[i]!;
      // Not walked at all: what hangs off a limit block is limit lines, which
      // the prune below would drop one at a time.
      if (!EXCLUDED_DETAIL_TYPES.has(child.type ?? '')) {
        stack.push({ event: child, parent: row });
      }
    }
  }

  let calls = 1; // the selection itself
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
    // A zero-duration frame stays only as the path to a kept descendant.
    if (row.duration.total > 0 || row._children) {
      const parent = parents[i]!;
      (parent._children ??= []).push(row);
      calls += 1;
    }
  }
  return { row: rows[0]!, calls };
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
  selected: readonly LogEvent[],
  subtrees: readonly ScopedRow[],
  store: LogStore,
  tick: Tick,
): Promise<ScopedRow[] | null> {
  const roots: ScopedRow[] = [];
  // One event has one parent, so it sits at one place in the tree: a flat index
  // is enough to join the paths where they meet.
  const rowByEvent = new Map<number, ScopedRow>();

  // Counted per node, not per occurrence: one occurrence costs a walk of its
  // whole ancestor chain, so a deep stack would otherwise overrun the slice.
  let steps = 0;
  for (let i = 0; i < selected.length; i++) {
    if (steps++ % CHECK_EVERY === 0 && !(await tick())) {
      return null;
    }
    const event = selected[i]!;
    const contributed = event.duration.total;

    // Outermost first, and the selection itself last where it is a parent.
    const ancestors = store.stackByEventIndex(event.eventIndex);
    if (ancestors.at(-1) === event) {
      ancestors.pop();
    }

    let into = roots;
    for (const ancestor of ancestors) {
      if (steps++ % CHECK_EVERY === 0 && !(await tick())) {
        return null;
      }
      let row = rowByEvent.get(ancestor.eventIndex);
      if (!row) {
        row = {
          id: ancestor.eventIndex,
          originalData: ancestor,
          text: ancestor.text,
          type: ancestor.type ?? '',
          duration: { total: 0, self: 0 },
          callCount: 0,
          eventIndexes: null,
          onPath: true,
          _children: [],
        };
        rowByEvent.set(ancestor.eventIndex, row);
        into.push(row);
      }
      row.duration.total += contributed;
      row.callCount += 1;
      into = row._children as ScopedRow[];
    }
    into.push(subtrees[i]!);
  }
  return roots;
}

/** Each event's real subtree as a root row, with the frames they hold between
 *  them; null when the walk is abandoned. */
async function subtreeRoots(
  events: readonly LogEvent[],
  tick: Tick,
): Promise<{ roots: ScopedRow[]; calls: number } | null> {
  const roots: ScopedRow[] = [];
  let calls = 0;
  for (const event of events) {
    const subtree = await realSubtree(event, tick);
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
  eventIndex: number,
  instances: number[] | null | undefined,
  options: FrameBudgetOptions,
): Promise<ScopedCallTree | null> {
  const store = currentLogStore();
  if (!store) {
    return null;
  }
  const apexLog = store.log;

  // An aggregate selection scopes to every occurrence of the frame; a single
  // selection to just itself.
  const indexes = instances?.length ? instances : eventIndex >= 0 ? [eventIndex] : [];
  const resolved = indexes
    .map((i) => store.eventByIndex(i))
    .filter((e): e is LogEvent => e !== null);
  // An occurrence inside another would otherwise be walked once per enclosing call.
  const selectedEvents = outermostEvents(resolved);
  if (!selectedEvents.length) {
    return null;
  }

  // Percentages are relative to the whole selection (summed across occurrences).
  const rootTotal = selectedEvents.reduce((sum, e) => sum + e.duration.total, 0);

  const tick = frameBudget(options);
  const scope = await subtreeRoots(selectedEvents, tick);
  if (!scope) {
    return null;
  }

  // The two top-down views root the selection under its callers, so a caller is
  // a row here too. Built on the first mark, since only a pointer needs it.
  let callers: Set<number> | null = null;
  const selected = new Set(selectedEvents.map((event) => event.eventIndex));
  const holds = (eventIndex: number): boolean => {
    if (selected.has(eventIndex)) {
      return true;
    }
    callers ??= callerIndexes(selectedEvents);
    if (callers.has(eventIndex)) {
      return true;
    }
    for (let node = store.eventByIndex(eventIndex)?.parent; node; node = node.parent) {
      if (selected.has(node.eventIndex)) {
        return true;
      }
    }
    return false;
  };

  return lazyCallTree({
    holds,
    // Only the two top-down views read the callers, and bottom-up is what most
    // selections open on, so the spine is built on first read like the views are.
    topDown: (viewOptions) =>
      pathRoots(selectedEvents, scope.roots, store, frameBudget(viewOptions)),
    bottomUp: scope.roots,
    rootTotal,
    logTotal: apexLog.duration.total,
    calls: scope.calls,
    store,
    // Occurrences of one frame are the same call made again, so merge them into a
    // single root; a single occurrence is already that.
    mergeTimeOrder: scope.roots.length > 1,
  });
}

/** Every frame above the selection: the rows the two top-down views root it in. */
function callerIndexes(selectedEvents: readonly LogEvent[]): Set<number> {
  const above = new Set<number>();
  for (const event of selectedEvents) {
    for (let node = event.parent; node; node = node.parent) {
      if (above.has(node.eventIndex)) {
        break; // this chain, and every chain above it, is already in
      }
      above.add(node.eventIndex);
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
  /** {@link ScopedCallTree.holds}, absent where the tree stands for the whole log. */
  holds?: (eventIndex: number) => boolean;
  /** Folds the occurrences of one frame into a single root (a scoped aggregate),
   *  which makes Time Order the same answer as Aggregated. The whole-log tree and
   *  a single occurrence keep their exact order. */
  mergeTimeOrder: boolean;
  /** Filled by the bottom-up walk where the tree follows a window: see {@link Holes}. */
  holes?: Holes;
}

// Each recursive frame's nested calls of itself, which bottom-up takes off its time.
type Holes = Map<LogEvent, LogEvent[]>;

// Time Order rows hold the window's figures once it is read, so the views built from them read the frame's.
function wholeOf(row: ScopedRow): { total: number; self: number } {
  return row.onPath ? row.duration : row.originalData.duration;
}

/**
 * The three lazy views over a scope. Only one view is on screen, so each is
 * built on first read and cached — aggregate()/buildBottomUp() are full walks of
 * every retained subtree.
 */
function lazyCallTree(input: CallTreeInput): ScopedCallTree {
  const { rootTotal, calls, logTotal, mergeTimeOrder, store, holds } = input;
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
        aggregatedRows = rows && (await aggregate(rows, store, viewOptions));
      }
      return aggregatedRows;
    },
    async bottomUp(viewOptions) {
      bottomUpRows ??= await buildBottomUp(input.bottomUp, store, viewOptions, input.holes);
      return bottomUpRows;
    },
  };
}

/**
 * The whole log's call tree — every root event with its real subtree and real
 * durations. The scoped builder cannot answer this: it starts at a selection,
 * so it never reaches the roots above one.
 *
 * Same three views, same slicing, same zero-duration-detail pruning as the
 * scoped tree; `rootTotal` and `logTotal` are both the log's total, so bars are
 * percentages of the whole log.
 */
export async function buildWholeLogCallTree(
  options: FrameBudgetOptions,
): Promise<ScopedCallTree | null> {
  const store = currentLogStore();
  const apexLog = store?.log;
  if (!store || !apexLog) {
    return null;
  }

  const tick = frameBudget(options);
  // A profiling block sits after EXECUTION_FINISHED, so it is a root here rather
  // than a descendant `realSubtree` would skip.
  const roots = apexLog.children.filter((child) => !EXCLUDED_DETAIL_TYPES.has(child.type ?? ''));
  const scope = await subtreeRoots(roots, tick);
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
    mergeTimeOrder: false,
    holes,
  });
  tree.liveWindow = () => liveWindow(apexLog, scope, store, holes);
  return tree;
}

// How long one filter pass may spend reading rows of many calls before it leaves them for prepare.
const PASS_MS = 8;

// Figures are written into the row itself, so the table's sort and footer read them unchanged.
function liveWindow(
  log: LogEvent,
  scope: { roots: ScopedRow[]; calls: number },
  store: LogStore,
  holes: Holes,
): LiveWindow {
  let window: TimeWindow | null = null;
  const indexes = new WeakMap<ScopedRow, SpanIndex>();
  let spans: CallSpans | null = null;
  // Every instant inside a root is one frame's self time, except inside a block the tree leaves out.
  let selfCover: { roots: SpanIndex; cut: SpanIndex } | null = null;
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
    const built = walked && (await CallSpans.build(walked.frames, tick));
    const roots = built && (await SpanIndex.build(walked.roots, undefined, tick));
    const cut = roots && (await SpanIndex.build(walked.cut, undefined, tick));
    if (!cut) {
      return false;
    }
    spans = built;
    selfCover = { roots, cut };
    return true;
  };

  const figures = (at: TimeWindow | null) => {
    const self = selfCover && selfCover.roots.in(at).total - selfCover.cut.in(at).total;
    if (!at) {
      return { rootTotal: log.duration.total, calls: scope.calls, self };
    }
    return {
      rootTotal: overlapOf(log.timestamp, endOf(log), at),
      calls: spans?.in(at) ?? scope.calls,
      self,
    };
  };

  const merges = (row: ScopedRow) => !!(row._seed || row.eventIndexes);
  const occurrenceBound = (row: ScopedRow) =>
    (row._seed?.eventIndexes ?? row.eventIndexes ?? []).length;
  const occurrencesOf = (row: ScopedRow) =>
    locatableEventIndexes(row).map((i) => store.eventByIndex(i)!); // ids from this log
  const indexOf = (row: ScopedRow): SpanIndex => {
    let index = indexes.get(row);
    if (!index) {
      index = SpanIndex.of(occurrencesOf(row), row._seed ? holes : undefined);
      indexes.set(row, index);
    }
    return index;
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
        const index = await SpanIndex.build(
          occurrencesOf(row),
          row._seed ? holes : undefined,
          tick,
        );
        if (!index) {
          return false;
        }
        indexes.set(row, index);
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
        const event = row.originalData;
        const own = window ? frameIn(event, window) : event.duration;
        row.duration.total = own.total;
        row.duration.self = own.self;
        return !window || reaches(event, window);
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
      row.duration.self = row._seed && row.eventIndexes !== row._seed.eventIndexes ? 0 : held.self;
      row.callCount = held.calls;
      return held.calls > 0;
    },
  };
}

async function framesOf(
  roots: readonly ScopedRow[],
  tick: Tick,
): Promise<{ frames: LogEvent[]; roots: LogEvent[]; cut: LogEvent[] } | null> {
  const frames: LogEvent[] = [];
  const cut: LogEvent[] = [];
  const stack = [...roots];
  while (stack.length) {
    if (frames.length % CHECK_EVERY === 0 && !(await tick())) {
      return null;
    }
    const row = stack.pop()!; // non-empty: the loop condition just checked
    const event = row.originalData;
    frames.push(event);
    for (const child of event.children) {
      if (EXCLUDED_DETAIL_TYPES.has(child.type ?? '')) {
        cut.push(child);
      }
    }
    if (row._children) {
      for (const child of row._children) {
        stack.push(child);
      }
    }
  }
  return { frames, roots: roots.map((row) => row.originalData), cut };
}

/** Top-down aggregation: merge sibling frames sharing a key, summing metrics. */
async function aggregate(
  rows: ScopedRow[],
  store: LogStore,
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
      const key = paths.keyIdOf(row.originalData);
      let held = groups.get(key);
      if (!held) {
        const group: ScopedRow = {
          id: nextId(),
          originalData: row.originalData,
          text: row.text,
          type: row.type,
          duration: { total: 0, self: 0 },
          callCount: 0,
          eventIndexes: [],
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
      const own = wholeOf(row);
      group.duration.total += own.total;
      group.duration.self += own.self;
      group.callCount += row.callCount;
      // Every merged occurrence, so pointing at the group points at all of them.
      for (const index of locatableEventIndexes(row)) {
        held.seen.add(index);
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
      group.eventIndexes = [...seen];
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
 * Every frame with self time seeds a row, ranked by self, so the view answers
 * where the time went inside whatever the rows cover: the selection when they
 * are scoped to one, else the whole log.
 *
 * A row's `total` is its frames' time with recursion counted once: a call of the
 * same frame inside another comes off the outer call, so the two never both
 * claim the time they share. This is the attribution the Call Tree tab's
 * bottom-up uses, so the two agree on a recursive frame.
 */
async function buildBottomUp(
  rows: ScopedRow[],
  store: LogStore,
  options: FrameBudgetOptions,
  holes?: Holes,
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
        originalData: src.originalData,
        text: src.text,
        type: src.type,
        duration: { total: 0, self: 0 },
        callCount: 0,
        // A top-level row holds its occurrences; a caller row derives its own
        // from that row, so it stores none.
        eventIndexes: under ? null : [],
        _seed: under ? under._seed : { eventIndexes: [], chains: [], paths },
        _pathId: pathId,
        _children: null,
      };
      if (under) {
        (under._children ??= []).push(node);
      } else {
        node.eventIndexes = node._seed.eventIndexes;
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
    keyId: paths.keyIdOf(row.originalData),
    stackId: paths.stackIdOf(row.originalData),
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
        outer.attributed -= wholeOf(row).total;
        if (holes) {
          const outerEvent = outer.row.originalData;
          const held = holes.get(outerEvent);
          if (held) {
            held.push(row.originalData);
          } else {
            holes.set(outerEvent, [row.originalData]);
          }
        }
      }
      entry.outer = outer;
      entry.attributed = wholeOf(row).total;
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
    const ownSelf = wholeOf(row).self;
    if (ownSelf > 0) {
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
      const held = row.eventIndexes;
      if (held) {
        for (let i = 0; i < held.length; i++) {
          occurrences.eventIndexes.push(held[i]!);
          occurrences.chains.push(pathId);
        }
      } else {
        occurrences.eventIndexes.push(row.originalData.eventIndex);
        occurrences.chains.push(pathId);
      }
    }
  }

  return topOrder.sort((a, b) => b.duration.self - a.duration.self);
}
