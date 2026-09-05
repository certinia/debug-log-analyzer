/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ApexLog, LogEvent } from 'apex-log-parser';
import type { ReactiveControllerHost } from 'lit';

import { DEFAULT_NAMESPACE } from '../utility/CallerNamespace.js';
import { CHECK_EVERY, frameBudget, type FrameBudgetOptions } from '../utility/FrameBudget.js';
import { RangeScopeController, sameWindow, type TimeWindow } from './rangeScope.js';

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
  /** Keyed by the parser's own category, which is empty where it has none. */
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

/** One counter's events as the walk finds them, in three parallel columns. */
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

  private readonly _roots: readonly LogEvent[];
  private readonly _start: number;
  private readonly _width: number;
  private readonly _selfByCategory: ReadonlyMap<string, Float64Array>;
  private readonly _selfByNamespace: ReadonlyMap<string, Float64Array>;
  private readonly _runs: CounterRuns;

  private constructor(
    roots: readonly LogEvent[],
    start: number,
    width: number,
    selfByCategory: ReadonlyMap<string, Float64Array>,
    selfByNamespace: ReadonlyMap<string, Float64Array>,
    runs: CounterRuns,
  ) {
    this._roots = roots;
    this._start = start;
    this._width = width;
    this._selfByCategory = selfByCategory;
    this._selfByNamespace = selfByNamespace;
    this._runs = runs;
  }

  /** Reads every event once, yielding between slices so the chart keeps its
   *  frames (see {@link FrameBudgetOptions}). */
  static async build(log: ApexLog, options: BuildOptions): Promise<WindowIndex> {
    const tick = frameBudget(options);
    const start = log.timestamp;
    const logEnd = log.exitStamp ?? start;
    // A log with no span still needs one bucket for its events to land in.
    const width = logEnd > start ? (logEnd - start) / BUCKETS : 1;
    const selfByCategory = new Map<string, Float64Array>();
    const selfByNamespace = new Map<string, Float64Array>();
    const gathered: Readonly<Record<keyof WindowCounts, Gathered>> = {
      soqlCount: gatherer(),
      soqlRowCount: gatherer(),
      dmlCount: gatherer(),
      dmlRowCount: gatherer(),
      soslCount: gatherer(),
    };

    // Reassigned per event, so the gap visitor below is allocated once for the
    // whole walk rather than once per event.
    let intoCategory = bucketsFor(selfByCategory, '');
    let intoNamespace = bucketsFor(selfByNamespace, '');
    const bucket = (from: number, to: number): void => {
      spread(intoCategory, intoNamespace, from, to, start, width);
    };

    const stack = [...log.children];
    for (let walked = 0; stack.length; walked++) {
      if (walked % CHECK_EVERY === 0) {
        await tick();
      }
      const event = stack.pop()!; // non-empty: the loop condition just checked
      intoCategory = bucketsFor(selfByCategory, event.category);
      intoNamespace = bucketsFor(selfByNamespace, event.namespace || DEFAULT_NAMESPACE);
      const children = event.children;
      eachSelfGap(event, 0, children.length, bucket);

      const from = event.timestamp;
      const to = endOf(event);
      gather(gathered.soqlCount, from, to, event.soqlCount.self);
      gather(gathered.soqlRowCount, from, to, event.soqlRowCount.self);
      gather(gathered.dmlCount, from, to, event.dmlCount.self);
      gather(gathered.dmlRowCount, from, to, event.dmlRowCount.self);
      gather(gathered.soslCount, from, to, event.soslCount.self);

      for (let i = 0; i < children.length; i++) {
        stack.push(children[i]!);
      }
    }

    for (const buckets of selfByCategory.values()) {
      cumulate(buckets);
    }
    for (const buckets of selfByNamespace.values()) {
      cumulate(buckets);
    }
    // The sorts scale with the statements in the log, so they yield too.
    await tick();
    const runs: CounterRuns = {
      soqlCount: runOf(gathered.soqlCount),
      soqlRowCount: runOf(gathered.soqlRowCount),
      dmlCount: runOf(gathered.dmlCount),
      dmlRowCount: runOf(gathered.dmlRowCount),
      soslCount: runOf(gathered.soslCount),
    };
    return new WindowIndex(log.children, start, width, selfByCategory, selfByNamespace, runs);
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
      counts: this._countsFor(window),
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
      addSelfTime(this._roots, { start: window.start, end: opens }, stats);
      addSelfTime(this._roots, { start: closes, end: window.end }, stats);
    } else {
      // Too narrow to hold a whole bucket, so all of it is an edge.
      addSelfTime(this._roots, window, stats);
    }
    this._held = { window, stats };
    return stats;
  }

  /**
   * The statements the whole log reports one by one.
   *
   * A counter reading zero here has no windowed value at all: the log names no
   * statement for it, so a whole-log figure from the cumulative block cannot be
   * cut into windows.
   */
  get logCounts(): WindowCounts {
    const total = (counter: keyof WindowCounts): number => {
      const run = this._runs[counter];
      return run.startedTotal[run.startedTotal.length - 1]!;
    };
    return {
      soqlCount: total('soqlCount'),
      soqlRowCount: total('soqlRowCount'),
      dmlCount: total('dmlCount'),
      dmlRowCount: total('dmlRowCount'),
      soslCount: total('soslCount'),
    };
  }

  /**
   * The statements `window` reaches any part of.
   *
   * Everything that had started by the end of the window, less everything that
   * had finished before it opened. A statement the window cuts across is left
   * in, since it did run in the window.
   */
  private _countsFor(window: TimeWindow): WindowCounts {
    const counts: WindowCounts = {
      soqlCount: 0,
      soqlRowCount: 0,
      dmlCount: 0,
      dmlRowCount: 0,
      soslCount: 0,
    };
    for (const counter of COUNTERS) {
      const run = this._runs[counter];
      const started = firstIndexWhere(run.startedAt.length, (i) => run.startedAt[i]! > window.end);
      const ended = firstIndexWhere(run.endedAt.length, (i) => run.endedAt[i]! >= window.start);
      counts[counter] = run.startedTotal[started]! - run.endedTotal[ended]!;
    }
    return counts;
  }
}

const indexes = new WeakMap<ApexLog, WindowIndex>();
const building = new WeakMap<ApexLog, Promise<WindowIndex>>();

/**
 * The index for `log`, read once and then shared.
 *
 * One build answers every reader, and nothing abandons it: the window moves with
 * the gesture, so a build tied to one window would restart per frame and never
 * finish.
 */
export function windowIndexFor(log: ApexLog, options: BuildOptions = {}): Promise<WindowIndex> {
  const held = indexes.get(log);
  if (held) {
    return Promise.resolve(held);
  }
  let inFlight = building.get(log);
  if (!inFlight) {
    inFlight = WindowIndex.build(log, options)
      .then((index) => {
        indexes.set(log, index);
        return index;
      })
      // A build that threw must not stay cached, or every later reader inherits
      // the same failure.
      .finally(() => building.delete(log));
    building.set(log, inFlight);
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

function bucketsFor(series: Map<string, Float64Array>, key: string): Float64Array {
  let buckets = series.get(key);
  if (!buckets) {
    // One longer than the buckets, so the total after the last one has a slot.
    buckets = new Float64Array(BUCKETS + 1);
    series.set(key, buckets);
  }
  return buckets;
}

/**
 * Calls `visit` for each stretch of `event`'s own time between the children
 * `from` up to `to`.
 *
 * An event's own time sits in the gaps between its children, and those gaps
 * never overlap another event's, anywhere in the tree. So bucketing every gap
 * fills each bucket with exactly the self time inside it, and clipping the gaps
 * of one run gives exactly the self time a window holds. Only the gaps around
 * the run can reach a window: every earlier child ends before it opens, so the
 * gaps among them do too.
 */
function eachSelfGap(
  event: LogEvent,
  from: number,
  to: number,
  visit: (start: number, end: number) => void,
): void {
  const children = event.children;
  const end = event.exitStamp ?? event.timestamp;
  // The gap reaching the run opens where the child before it ended.
  let cursor = from > 0 ? Math.max(event.timestamp, endOf(children[from - 1]!)) : event.timestamp;
  for (let i = from; i < to; i++) {
    const child = children[i]!;
    if (child.timestamp > cursor) {
      visit(cursor, child.timestamp);
    }
    cursor = Math.max(cursor, child.exitStamp ?? child.timestamp);
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
 * Adds the own time inside `window` to `stats`, event by event.
 *
 * Only the part bucket at a window's edge is read this way, so this walks a few
 * events.
 */
function addSelfTime(roots: readonly LogEvent[], window: TimeWindow, stats: WindowStats): void {
  if (window.end <= window.start) {
    return;
  }
  const stack: LogEvent[] = [];
  pushReached(stack, roots, window);
  while (stack.length) {
    const event = stack.pop()!; // non-empty: the loop condition just checked
    const children = event.children;
    const { from, to } = reachedRun(children, window);
    let self = 0;
    eachSelfGap(event, from, to, (start, end) => {
      self += overlapOf(start, end, window);
    });
    if (self > 0) {
      // The parser's own category, named for display by the reader: `core/`
      // holds no display strings.
      add(stats.selfByCategory, event.category, self);
      add(stats.selfByNamespace, event.namespace || DEFAULT_NAMESPACE, self);
    }
    for (let i = from; i < to; i++) {
      stack.push(children[i]!);
    }
  }
}

function pushReached(stack: LogEvent[], children: readonly LogEvent[], window: TimeWindow): void {
  const { from, to } = reachedRun(children, window);
  for (let i = from; i < to; i++) {
    stack.push(children[i]!);
  }
}

/**
 * The run of `children` that `window` reaches, as [from, to).
 *
 * Siblings run one after another and never overlap, so both their starts and
 * their ends ascend and the run is contiguous: two binary searches find it,
 * where testing every child would read the whole log. An unclosed frame reads as
 * reaching forever, so a truncated log's last frames are walked, not dropped.
 */
function reachedRun(
  children: readonly LogEvent[],
  window: TimeWindow,
): { from: number; to: number } {
  return {
    from: firstIndexWhere(children.length, (i) => endOf(children[i]!) >= window.start),
    to: firstIndexWhere(children.length, (i) => children[i]!.timestamp > window.end),
  };
}

/** The leftmost index below `length` where `holds` becomes true, or `length` if
 *  it never does. `holds` must be false then true across the run. */
function firstIndexWhere(length: number, holds: (index: number) => boolean): number {
  let low = 0;
  let high = length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (holds(mid)) {
      high = mid;
    } else {
      low = mid + 1;
    }
  }
  return low;
}

function endOf(event: LogEvent): number {
  return event.exitStamp ?? Number.POSITIVE_INFINITY;
}

/** The length of [start, end) that falls inside `window`. */
function overlapOf(start: number, end: number, window: TimeWindow): number {
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
  private readonly _log: () => ApexLog | null;
  private _awaiting: ApexLog | null = null;

  constructor(host: ReactiveControllerHost, log: () => ApexLog | null) {
    this._host = host;
    this._log = log;
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
    const log = this._log();
    if (!window || !log) {
      return null;
    }
    const index = indexes.get(log);
    if (index) {
      return index.statsFor(window);
    }
    this._readLog(log);
    return null;
  }

  /** The window's statement counts beside the whole log's, or null where the
   *  whole log is the scope. */
  get counts(): { counts: WindowCounts; logCounts: WindowCounts } | null {
    const window = this._range.window;
    const log = this._log();
    const index = window && log ? indexes.get(log) : undefined;
    return index && window
      ? { counts: index.statsFor(window).counts, logCounts: index.logCounts }
      : null;
  }

  /** True while a window is on screen and its stats are not ready yet. */
  get pending(): boolean {
    return this._range.window !== null && this.stats === null;
  }

  private _readLog(log: ApexLog): void {
    if (this._awaiting === log) {
      return;
    }
    this._awaiting = log;
    void windowIndexFor(log)
      .then(() => {
        if (this._awaiting === log) {
          this._host.requestUpdate();
        }
      })
      // A build only fails on a log the parser cannot walk. The section keeps
      // its "adding up" note rather than retrying it every render.
      .catch(() => {});
  }
}
