/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ReactiveControllerHost } from 'lit';

import { DEFAULT_NAMESPACE, namespaceOf } from '../utility/CallerNamespace.js';
import { CHECK_EVERY, frameBudget, type FrameBudgetOptions } from '../utility/FrameBudget.js';
import { firstIndexWhere } from '../utility/Util.js';
import { categoryName, childRows, type LogIndex, NO_ROW } from './LogIndex.js';
import type { LogStore } from './LogStore.js';
import { RangeScopeController, sameWindow, type TimeWindow } from './rangeScope.js';
import { statementSelves } from './rowMetrics.js';

/** The statement counters an event carries for itself. */
export interface WindowCounts {
  soqlCount: number;
  soqlRowCount: number;
  dmlCount: number;
  dmlRowCount: number;
  soslCount: number;
}

/** Everything the inspector's sections read for one stretch of the log. */
export interface WindowStats {
  /** Keyed by the timeline category, which is empty where an event has none. */
  selfByCategory: Map<string, number>;
  selfByNamespace: Map<string, number>;
  counts: WindowCounts;
}

/** Only the yield matters here: the build is never abandoned, so it accepts no
 *  signal. */
type BuildOptions = Pick<FrameBudgetOptions, 'yieldSlice'>;

const COUNTERS: ReadonlyArray<keyof WindowCounts> = [
  'soqlCount',
  'soqlRowCount',
  'dmlCount',
  'dmlRowCount',
  'soslCount',
];

function byCounter<T>(value: (counter: keyof WindowCounts) => T): Record<keyof WindowCounts, T> {
  return Object.fromEntries(COUNTERS.map((counter) => [counter, value(counter)])) as Record<
    keyof WindowCounts,
    T
  >;
}

/** Buckets across the log's span. A window's whole buckets are read from a
 *  running total, so its width costs nothing; only the part bucket at each edge
 *  is read event by event, and 4,096 buckets leave about a hundred events in
 *  one on the largest logs. */
const BUCKETS = 4_096;

/**
 * The events carrying one counter: when they started and when they ended, each
 * ascending with its running total.
 *
 * Only the events carrying the counter are held, so the five runs together are
 * about as long as the statements in the log rather than five times its events.
 */
interface CounterRun {
  startedAt: Float64Array;
  /** One longer than `startedAt`: the total before each entry, then all of it. */
  startedTotal: Float64Array;
  endedAt: Float64Array;
  endedTotal: Float64Array;
}

type CounterRuns = Readonly<Record<keyof WindowCounts, CounterRun>>;

/** One counter's events as the pass finds them, in three parallel columns. */
interface Gathered {
  starts: number[];
  ends: number[];
  values: number[];
}

/**
 * The log read once, so any stretch of it can be read at once afterwards.
 *
 * Self time is bucketed by time and kept as a running total, so a window's
 * whole buckets are one subtraction each however wide the window is. Statement
 * counts come from running totals by start and by end, so a count is exact with
 * no walk at all.
 */
export class WindowIndex {
  /** Every section asks for the same window, so one answer serves them all. */
  private _held: { window: TimeWindow; stats: WindowStats } | null = null;

  private readonly _index: LogIndex;
  /** The rows at the top of the log, in log order. */
  private readonly _roots: readonly number[];
  private readonly _start: number;
  private readonly _width: number;
  private readonly _selfByCategory: ReadonlyMap<string, Float64Array>;
  private readonly _selfByNamespace: ReadonlyMap<string, Float64Array>;
  private readonly _runs: CounterRuns;

  /**
   * The statements the whole log reports one by one.
   *
   * A counter reading zero here has no windowed value at all: the log names no
   * statement for it, so a whole-log figure from the cumulative block cannot be
   * cut into windows.
   */
  readonly logCounts: WindowCounts;

  private constructor(
    index: LogIndex,
    start: number,
    width: number,
    selfByCategory: ReadonlyMap<string, Float64Array>,
    selfByNamespace: ReadonlyMap<string, Float64Array>,
    runs: CounterRuns,
  ) {
    this._index = index;
    this._roots = childRows(index, NO_ROW);
    this._start = start;
    this._width = width;
    this._selfByCategory = selfByCategory;
    this._selfByNamespace = selfByNamespace;
    this._runs = runs;
    this.logCounts = byCounter((counter) => runs[counter].startedTotal.at(-1)!); // a run always holds the opening 0
  }

  /** Reads every row once, yielding between slices so the chart keeps its
   *  frames (see {@link FrameBudgetOptions}). */
  static async build(index: LogIndex, options: BuildOptions): Promise<WindowIndex> {
    const tick = frameBudget(options);
    const { log, rowCount, start: starts, end: ends, categoryId, categoryNames } = index;
    const start = log.startTimestamp;
    const logEnd = log.endTimestamp;
    // A log with no span still needs one bucket for its events to land in.
    const width = logEnd > start ? (logEnd - start) / BUCKETS : 1;
    const namespaceIds = index.column(log.columns.namespace.ids);
    // By category id, and by namespace id + 1 so the -1 of no namespace has a slot.
    const byCategory: Float64Array[] = [];
    const byNamespace: Float64Array[] = [];
    const { soql, soqlRows, dml, dmlRows, sosl } = statementSelves(index);
    const gathered = byCounter(gatherer);

    // Reassigned per row, so the gap visitor below is allocated once for the
    // whole pass rather than once per row.
    let intoCategory = slot(byCategory, 0);
    let intoNamespace = slot(byNamespace, 0);
    const bucket = (from: number, to: number): void => {
      spread(intoCategory, intoNamespace, from, to, start, width);
    };

    const children: number[] = [];
    for (let row = 0; row < rowCount; row++) {
      if (row % CHECK_EVERY === 0) {
        await tick();
      }
      intoCategory = slot(byCategory, categoryId[row]!);
      intoNamespace = slot(byNamespace, namespaceIds[row]! + 1);
      childRows(index, row, children);
      eachSelfGap(index, row, children, 0, children.length, bucket);

      const from = starts[row]!;
      const to = ends[row]!;
      // Spelt out, not looped over COUNTERS: a computed key per row costs the build ~18%.
      gather(gathered.soqlCount, from, to, soql[row] ?? 0);
      gather(gathered.soqlRowCount, from, to, soqlRows[row] ?? 0);
      gather(gathered.dmlCount, from, to, dml[row] ?? 0);
      gather(gathered.dmlRowCount, from, to, dmlRows[row] ?? 0);
      gather(gathered.soslCount, from, to, sosl[row] ?? 0);
    }

    const namespaceNames = [
      DEFAULT_NAMESPACE,
      ...log.columns.namespace.values.map((name) => name ?? DEFAULT_NAMESPACE),
    ];
    const selfByCategory = named(byCategory, (id) => categoryNames[id]!);
    const selfByNamespace = named(byNamespace, (id) => namespaceNames[id]!);
    for (const buckets of selfByCategory.values()) {
      cumulate(buckets);
    }
    for (const buckets of selfByNamespace.values()) {
      cumulate(buckets);
    }
    // The sorts scale with the statements in the log, so they yield too.
    await tick();
    const runs = byCounter((counter) => runOf(gathered[counter]));
    return new WindowIndex(index, start, width, selfByCategory, selfByNamespace, runs);
  }

  /** Self time by category and by namespace, and the statements run, for the
   *  stretch of log `window` covers. */
  statsFor(window: TimeWindow): WindowStats {
    if (this._held && sameWindow(this._held.window, window)) {
      return this._held.stats;
    }
    const stats: WindowStats = {
      selfByCategory: new Map(),
      selfByNamespace: new Map(),
      counts: this.countsFor(window),
    };
    const firstWhole = Math.max(0, Math.ceil((window.start - this._start) / this._width));
    const lastWhole = Math.min(
      BUCKETS - 1,
      Math.floor((window.end - this._start) / this._width) - 1,
    );
    if (lastWhole >= firstWhole) {
      addBuckets(stats.selfByCategory, this._selfByCategory, firstWhole, lastWhole);
      addBuckets(stats.selfByNamespace, this._selfByNamespace, firstWhole, lastWhole);
      const opens = this._start + firstWhole * this._width;
      const closes = this._start + (lastWhole + 1) * this._width;
      addSelfTime(this._index, this._roots, { start: window.start, end: opens }, stats);
      addSelfTime(this._index, this._roots, { start: closes, end: window.end }, stats);
    } else {
      // Too narrow to hold a whole bucket, so all of it is an edge.
      addSelfTime(this._index, this._roots, window, stats);
    }
    this._held = { window, stats };
    return stats;
  }

  /**
   * The statements `window` reaches any part of.
   *
   * Everything that had started by the end of the window, less everything that
   * had finished before it opened. A statement the window cuts across is left
   * in, since it did run in the window.
   */
  countsFor(window: TimeWindow): WindowCounts {
    if (this._held && sameWindow(this._held.window, window)) {
      return this._held.stats.counts;
    }
    return byCounter((counter) => {
      const run = this._runs[counter];
      const started = firstIndexWhere(run.startedAt.length, (i) => run.startedAt[i]! > window.end);
      const ended = firstIndexWhere(run.endedAt.length, (i) => run.endedAt[i]! >= window.start);
      return run.startedTotal[started]! - run.endedTotal[ended]!;
    });
  }
}

const indexes = new WeakMap<LogStore, WindowIndex>();
const building = new WeakMap<LogStore, Promise<WindowIndex>>();

/**
 * The index for the log `store` shows, read once and then shared.
 *
 * One build answers every reader, and nothing abandons it: the window moves with
 * the gesture, so a build tied to one window would restart per frame and never
 * finish.
 */
export function windowIndexFor(store: LogStore, options: BuildOptions = {}): Promise<WindowIndex> {
  const held = indexes.get(store);
  if (held) {
    return Promise.resolve(held);
  }
  let inFlight = building.get(store);
  if (!inFlight) {
    inFlight = store
      .logIndex(options)
      .then((index) => WindowIndex.build(index, options))
      .then((index) => {
        indexes.set(store, index);
        return index;
      })
      // A build that threw must not stay cached, or every later reader inherits
      // the same failure.
      .finally(() => building.delete(store));
    building.set(store, inFlight);
  }
  return inFlight;
}

function gather(into: Gathered, start: number, end: number, value: number): void {
  if (value === 0) {
    return;
  }
  into.starts.push(start);
  into.ends.push(end);
  into.values.push(value);
}

const gatherer = (): Gathered => ({ starts: [], ends: [], values: [] });

/** One counter's gathered events as two ascending runs with running totals. */
function runOf(gathered: Gathered): CounterRun {
  const [startedAt, startedTotal] = runningTotal(gathered.starts, gathered.values);
  const [endedAt, endedTotal] = runningTotal(gathered.ends, gathered.values);
  return { startedAt, startedTotal, endedAt, endedTotal };
}

/** `times` in ascending order, with the total of the `values` before each one. */
function runningTotal(times: number[], values: number[]): [Float64Array, Float64Array] {
  const order = times.map((_, index) => index).sort((a, b) => times[a]! - times[b]!);
  const at = new Float64Array(order.length);
  const total = new Float64Array(order.length + 1);
  for (let i = 0; i < order.length; i++) {
    at[i] = times[order[i]!]!;
    total[i + 1] = total[i]! + values[order[i]!]!;
  }
  return [at, total];
}

function slot(series: Float64Array[], id: number): Float64Array {
  // One longer than the buckets, so the total after the last one has a slot.
  return (series[id] ??= new Float64Array(BUCKETS + 1));
}

/** The series by name. Two ids of one name, as no namespace and 'default', add together. */
function named(series: Float64Array[], name: (id: number) => string): Map<string, Float64Array> {
  const byName = new Map<string, Float64Array>();
  series.forEach((buckets, id) => {
    const key = name(id);
    const held = byName.get(key);
    if (held) {
      for (let at = 0; at < held.length; at++) {
        held[at]! += buckets[at]!;
      }
    } else {
      byName.set(key, buckets);
    }
  });
  return byName;
}

/**
 * Calls `visit` for each stretch of `row`'s own time between its children
 * `from` up to `to`, of the sibling rows `children`.
 *
 * A row's own time sits in the gaps between its children, and those gaps
 * never overlap another row's, anywhere in the tree. So bucketing every gap
 * fills each bucket with exactly the self time inside it, and clipping the gaps
 * of one run gives exactly the self time a window holds. Only the gaps around
 * the run can reach a window: every earlier child ends before it opens, so the
 * gaps among them do too.
 */
export function eachSelfGap(
  index: LogIndex,
  row: number,
  children: readonly number[],
  from: number,
  to: number,
  visit: (start: number, end: number) => void,
): void {
  const { start: starts, end: ends } = index;
  const end = ends[row]!;
  // The gap reaching the run opens where the child before it ended.
  let cursor = from > 0 ? Math.max(starts[row]!, ends[children[from - 1]!]!) : starts[row]!;
  for (let i = from; i < to; i++) {
    const child = children[i]!;
    if (starts[child]! > cursor) {
      visit(cursor, starts[child]!);
    }
    cursor = Math.max(cursor, ends[child]!);
  }
  if (end > cursor) {
    visit(cursor, end);
  }
}

/** Adds [from, to) to both series, split where it crosses a bucket edge. */
function spread(
  category: Float64Array,
  namespace: Float64Array,
  from: number,
  to: number,
  start: number,
  width: number,
): void {
  const last = bucketOf(to, start, width);
  for (let bucket = bucketOf(from, start, width); bucket <= last; bucket++) {
    const opens = start + bucket * width;
    const held = Math.min(to, opens + width) - Math.max(from, opens);
    if (held > 0) {
      category[bucket]! += held;
      namespace[bucket]! += held;
    }
  }
}

function bucketOf(at: number, start: number, width: number): number {
  return Math.min(BUCKETS - 1, Math.max(0, Math.floor((at - start) / width)));
}

/** Turns bucket totals into running totals, so `buckets[b]` becomes everything
 *  before bucket `b` and a run of buckets is one subtraction. */
function cumulate(buckets: Float64Array): void {
  let running = 0;
  for (let bucket = 0; bucket <= BUCKETS; bucket++) {
    const held = buckets[bucket]!;
    buckets[bucket] = running;
    running += held;
  }
}

function addBuckets(
  into: Map<string, number>,
  series: ReadonlyMap<string, Float64Array>,
  firstWhole: number,
  lastWhole: number,
): void {
  for (const [key, buckets] of series) {
    const held = buckets[lastWhole + 1]! - buckets[firstWhole]!;
    if (held > 0) {
      add(into, key, held);
    }
  }
}

/**
 * Adds the own time inside `window` to `stats`, row by row.
 *
 * Only the part bucket at a window's edge is read this way, so this walks a few
 * rows.
 */
function addSelfTime(
  index: LogIndex,
  roots: readonly number[],
  window: TimeWindow,
  stats: WindowStats,
): void {
  if (window.end <= window.start) {
    return;
  }
  const { log, eventIndex } = index;
  const stack: number[] = [];
  pushReached(index, stack, roots, window);
  while (stack.length) {
    const row = stack.pop()!; // non-empty: the loop condition just checked
    const children = childRows(index, row);
    const { from, to } = reachedRun(index, children, window);
    let self = 0;
    eachSelfGap(index, row, children, from, to, (start, end) => {
      self += overlapOf(start, end, window);
    });
    if (self > 0) {
      // The category's own name, named for display by the reader: `core/`
      // holds no display strings.
      add(stats.selfByCategory, categoryName(index, row), self);
      add(stats.selfByNamespace, namespaceOf(log, eventIndex[row]!), self);
    }
    for (let i = from; i < to; i++) {
      stack.push(children[i]!);
    }
  }
}

function pushReached(
  index: LogIndex,
  stack: number[],
  children: readonly number[],
  window: TimeWindow,
): void {
  const { from, to } = reachedRun(index, children, window);
  for (let i = from; i < to; i++) {
    stack.push(children[i]!);
  }
}

/**
 * The run of sibling rows `children` that `window` reaches, as [from, to).
 *
 * Siblings run one after another and never overlap, so both their starts and
 * their ends ascend and the run is contiguous: two binary searches find it,
 * where testing every child would read the whole log.
 */
export function reachedRun(
  index: LogIndex,
  children: readonly number[],
  window: TimeWindow,
): { from: number; to: number } {
  const { start, end } = index;
  return {
    from: firstIndexWhere(children.length, (i) => end[children[i]!]! >= window.start),
    to: firstIndexWhere(children.length, (i) => start[children[i]!]! > window.end),
  };
}

/** The length of [start, end) that falls inside `window`. */
export function overlapOf(start: number, end: number, window: TimeWindow): number {
  return Math.max(0, Math.min(end, window.end) - Math.max(start, window.start));
}

function add(totals: Map<string, number>, key: string, value: number): void {
  totals.set(key, (totals.get(key) ?? 0) + value);
}

/**
 * The stats for the window on screen.
 *
 * Follows the window through a {@link RangeScopeController}, and derives the
 * stats from the log's index rather than holding a copy: the index is built on
 * the first window and shared, so every window after it is answered inside the
 * frame that asked.
 */
export class WindowStatsController {
  private readonly _range: RangeScopeController;
  private readonly _host: ReactiveControllerHost;
  private readonly _store: () => LogStore | null;
  private _awaiting: LogStore | null = null;

  constructor(host: ReactiveControllerHost, store: () => LogStore | null) {
    this._host = host;
    this._store = store;
    this._range = new RangeScopeController(host);
  }

  /** The window on screen, or null for the whole log. */
  get window(): TimeWindow | null {
    return this._range.window;
  }

  /** The window's stats, or null while they are still being added up. Always
   *  null where {@link window} is. */
  get stats(): WindowStats | null {
    const window = this._range.window;
    return window ? (this._index()?.statsFor(window) ?? null) : null;
  }

  /** The window's statement counts beside the whole log's, or null where the
   *  whole log is the scope. */
  get counts(): { counts: WindowCounts; logCounts: WindowCounts } | null {
    const window = this._range.window;
    const index = window ? this._index() : null;
    return index && window ? { counts: index.countsFor(window), logCounts: index.logCounts } : null;
  }

  /** True while a window is on screen and its stats are not ready yet. */
  get pending(): boolean {
    return this._range.window !== null && this._index() === null;
  }

  /** The log's index, or null while it builds; the first ask starts the build. */
  private _index(): WindowIndex | null {
    const store = this._store();
    if (!store) {
      return null;
    }
    const index = indexes.get(store);
    if (index) {
      return index;
    }
    this._readLog(store);
    return null;
  }

  private _readLog(store: LogStore): void {
    if (this._awaiting === store) {
      return;
    }
    this._awaiting = store;
    void windowIndexFor(store)
      .then(() => {
        if (this._awaiting === store) {
          // Cleared only on success, so a replaced log does not stay reachable.
          this._awaiting = null;
          this._host.requestUpdate();
        }
      })
      // A build only fails on a log the parser cannot walk. The section keeps
      // its "adding up" note rather than retrying it every render.
      .catch(() => {});
  }
}
