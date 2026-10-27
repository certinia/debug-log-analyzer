/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { CHECK_EVERY, type Tick } from '../utility/FrameBudget.js';
import { firstIndexWhere } from '../utility/Util.js';
import type { LogIndex } from './LogIndex.js';
import type { TimeWindow } from './rangeScope.js';
import { childRows, eachSelfGap, overlapOf, reachedRun } from './windowStats.js';

/** Time and calls inside a window, in the parser's nanoseconds. */
export interface WindowedTime {
  total: number;
  self: number;
  calls: number;
}

/** By event id: the nested calls of the same frame, whose time the outer call does not count. */
export type Holes = ReadonlyMap<number, readonly number[]>;

// Below this many children in a window, summing them beats a prefix lookup.
const WIDE = 64;

// Made for a wide parent row the first time a window cuts it.
const childTotals = new WeakMap<LogIndex, Map<number, Float64Array>>();

/**
 * One frame's time inside `window`: the part of its span there, and the part of
 * that no child ran in.
 *
 * @param eventIndex - a shown event of `index`
 */
export function frameIn(
  index: LogIndex,
  eventIndex: number,
  window: TimeWindow,
): { total: number; self: number } {
  return rowIn(index, index.rowOf(eventIndex), window);
}

function rowIn(index: LogIndex, row: number, window: TimeWindow): { total: number; self: number } {
  const total = overlapOf(index.start[row]!, index.end[row]!, window); // row is shown by contract
  if (total === 0) {
    return { total: 0, self: 0 };
  }
  const children = childRows(index, row);
  const { from, to } = reachedRun(index, children, window);
  if (to - from > WIDE) {
    return { total, self: total - wideChildTimeIn(index, row, children, from, to, window) };
  }
  let self = 0;
  eachSelfGap(index, row, children, from, to, (start, end) => {
    self += overlapOf(start, end, window);
  });
  return { total, self };
}

function wideChildTimeIn(
  index: LogIndex,
  row: number,
  children: readonly number[],
  from: number,
  to: number,
  window: TimeWindow,
): number {
  const { start, end } = index;
  // Siblings never overlap, so only the first and last of the run can be cut.
  const first = children[from]!; // the run is wider than WIDE, so both ends exist
  const last = children[to - 1]!;
  const totals = totalsOf(index, row, children);
  return (
    overlapOf(start[first]!, end[first]!, window) +
    overlapOf(start[last]!, end[last]!, window) +
    totals[to - 1]! -
    totals[from + 1]!
  );
}

// totals[i] is the time of every child before i.
function totalsOf(index: LogIndex, row: number, children: readonly number[]): Float64Array {
  let byRow = childTotals.get(index);
  if (!byRow) {
    byRow = new Map();
    childTotals.set(index, byRow);
  }
  let totals = byRow.get(row);
  if (!totals) {
    const { start, end } = index;
    totals = new Float64Array(children.length + 1);
    for (let i = 0; i < children.length; i++) {
      const child = children[i]!; // i < length
      totals[i + 1] = totals[i]! + end[child]! - start[child]!;
    }
    byRow.set(row, totals);
  }
  return totals;
}

/**
 * Whether the window holds some of the frame's time, or the frame's instant if it has none.
 *
 * @param eventIndex - a shown event of `index`
 */
export function reaches(index: LogIndex, eventIndex: number, window: TimeWindow): boolean {
  return rowReaches(index, index.rowOf(eventIndex), window);
}

function rowReaches(index: LogIndex, row: number, window: TimeWindow): boolean {
  const start = index.start[row]!; // row is shown by contract
  const end = index.end[row]!;
  return start === end
    ? start >= window.start && start <= window.end
    : start < window.end && end > window.start;
}

/**
 * The occurrences one call tree row stands for, read so the row's time inside
 * any window costs a few binary searches.
 *
 * An occurrence counts its own time less its holes: the nested calls of the same
 * frame, which bottom-up counts through the inner call rather than twice.
 * Occurrences of one row can nest, so they are grouped under the outermost; the
 * groups never overlap, so the ones a window holds whole are one subtraction of
 * running totals, and only the group at each edge is read call by call.
 */
export class SpanIndex {
  /** The row's figures for the whole log. */
  readonly whole: WindowedTime;

  private readonly _index: LogIndex;
  // Index rows, in start order.
  private readonly _members: Int32Array;
  private readonly _holes: Holes | undefined;
  // Null where no call nests in another, which is most rows.
  private readonly _groupAt: Int32Array | null;
  // Running totals over the groups, one longer than them.
  private readonly _total: Float64Array;
  private readonly _self: Float64Array;

  private constructor(
    index: LogIndex,
    members: Int32Array,
    holes: Holes | undefined,
    {
      groupAt,
      total,
      self,
    }: { groupAt: Int32Array | null; total: Float64Array; self: Float64Array },
  ) {
    this._index = index;
    this._members = members;
    this._holes = holes;
    this._groupAt = groupAt;
    this._total = total;
    this._self = self;
    const groups = total.length - 1;
    this.whole = { total: total[groups]!, self: self[groups]!, calls: members.length };
  }

  /** @param occurrences - shown event ids of `index` */
  static of(index: LogIndex, occurrences: readonly number[], holes?: Holes): SpanIndex {
    const members = inStartOrder(index, occurrences);
    const groups = new GroupBuilder(index, holes);
    for (const member of members) {
      groups.add(member);
    }
    return new SpanIndex(index, members, holes, groups.finish());
  }

  /** {@link of} a slice at a time; null when abandoned. */
  static async build(
    index: LogIndex,
    occurrences: readonly number[],
    holes: Holes | undefined,
    tick: Tick,
  ): Promise<SpanIndex | null> {
    const members = inStartOrder(index, occurrences);
    const groups = new GroupBuilder(index, holes);
    for (let i = 0; i < members.length; i++) {
      if (i % CHECK_EVERY === 0 && !(await tick())) {
        return null;
      }
      groups.add(members[i]!); // i < length
    }
    return new SpanIndex(index, members, holes, groups.finish());
  }

  /** The row's figures inside `window`, or for the whole log where it is null. */
  in(window: TimeWindow | null): WindowedTime {
    if (!window) {
      return this.whole;
    }
    const { start, end } = this._index;
    const groups = this._total.length - 1;
    const head = (g: number) => this._members[this._memberAt(g)]!; // g < groups
    let lo = firstIndexWhere(groups, (g) => end[head(g)]! >= window.start);
    let hi = firstIndexWhere(groups, (g) => start[head(g)]! > window.end);
    const held: WindowedTime = { total: 0, self: 0, calls: 0 };
    if (lo >= hi) {
      return held;
    }
    // A group's head is its outermost call, so its span is the group's.
    const cut = (g: number) => start[head(g)]! < window.start || end[head(g)]! > window.end;
    if (cut(lo)) {
      this._readGroup(lo, window, held);
      lo += 1;
    }
    if (hi > lo && cut(hi - 1)) {
      this._readGroup(hi - 1, window, held);
      hi -= 1;
    }
    if (hi > lo) {
      held.total += this._total[hi]! - this._total[lo]!;
      held.self += this._self[hi]! - this._self[lo]!;
      held.calls += this._memberAt(hi) - this._memberAt(lo);
    }
    return held;
  }

  private _memberAt(g: number): number {
    return this._groupAt ? this._groupAt[g]! : g; // one entry per group, then the end
  }

  private _readGroup(g: number, window: TimeWindow, held: WindowedTime): void {
    const index = this._index;
    const { start, end, eventIndex } = index;
    const last = this._memberAt(g + 1);
    for (let i = this._memberAt(g); i < last; i++) {
      const member = this._members[i]!; // i is inside group g
      const own = rowIn(index, member, window);
      let total = own.total;
      for (const hole of this._holes?.get(eventIndex[member]!) ?? []) {
        const row = index.rowOf(hole);
        total -= overlapOf(start[row]!, end[row]!, window);
      }
      held.total += total;
      held.self += own.self;
      held.calls += rowReaches(index, member, window) ? 1 : 0;
    }
  }
}

// Calls that never nest are in order already, and the sort is most of a hot row's build.
function inStartOrder(index: LogIndex, occurrences: readonly number[]): Int32Array {
  const rows = Int32Array.from(occurrences, (id) => index.rowOf(id));
  const { start, end } = index;
  // Outer first where two start together, so the outer heads its group.
  const byStart = (a: number, b: number) => start[a]! - start[b]! || end[b]! - end[a]!;
  for (let i = 1; i < rows.length; i++) {
    if (byStart(rows[i - 1]!, rows[i]!) > 0) {
      return rows.sort(byStart);
    }
  }
  return rows;
}

class GroupBuilder {
  private readonly _index: LogIndex;
  private readonly _holes: Holes | undefined;
  private readonly _groupAt: number[] = [];
  private readonly _total = [0];
  private readonly _self = [0];
  private _groupEnd = -Infinity;
  private _added = 0;

  constructor(index: LogIndex, holes: Holes | undefined) {
    this._index = index;
    this._holes = holes;
  }

  add(member: number): void {
    const { start, end, self: selves, eventIndex } = this._index;
    const total = this._total;
    const self = this._self;
    // Frames nest or stand apart, so one starting inside the group is inside it.
    if (start[member]! >= this._groupEnd) {
      this._groupAt.push(this._added);
      this._groupEnd = end[member]!;
      total.push(total.at(-1)!);
      self.push(self.at(-1)!);
    }
    let own = end[member]! - start[member]!;
    const holes = this._holes?.get(eventIndex[member]!);
    if (holes) {
      for (const hole of holes) {
        const row = this._index.rowOf(hole);
        own -= end[row]! - start[row]!;
      }
    }
    const at = this._groupAt.length;
    total[at]! += own;
    self[at]! += selves[member]!;
    this._added += 1;
  }

  finish(): { groupAt: Int32Array | null; total: Float64Array; self: Float64Array } {
    const groupAt = this._groupAt;
    groupAt.push(this._added);
    return {
      groupAt: groupAt.length > this._added ? null : Int32Array.from(groupAt),
      total: Float64Array.from(this._total),
      self: Float64Array.from(this._self),
    };
  }
}

/**
 * Every frame in a tree, read so the frames a window reaches are counted with
 * binary searches.
 */
export class CallSpans {
  private readonly _starts: Float64Array;
  private readonly _ends: Float64Array;
  private readonly _instants: Float64Array;

  private constructor(starts: Float64Array, ends: Float64Array, instants: Float64Array) {
    this._starts = starts;
    this._ends = ends;
    this._instants = instants;
  }

  /**
   * Built a slice at a time; null when abandoned.
   *
   * @param frames - shown event ids of `index`
   */
  static async build(
    index: LogIndex,
    frames: readonly number[],
    tick: Tick,
  ): Promise<CallSpans | null> {
    const { start, end } = index;
    const rows = new Int32Array(frames.length);
    let instantCount = 0;
    for (let i = 0; i < frames.length; i++) {
      if (i % CHECK_EVERY === 0 && !(await tick())) {
        return null;
      }
      const row = (rows[i] = index.rowOf(frames[i]!)); // i < length
      if (end[row] === start[row]) {
        instantCount++;
      }
    }
    const starts = new Float64Array(frames.length - instantCount);
    const ends = new Float64Array(starts.length);
    const instants = new Float64Array(instantCount);
    let spanAt = 0;
    let instantAt = 0;
    for (let i = 0; i < rows.length; i++) {
      if (i % CHECK_EVERY === 0 && !(await tick())) {
        return null;
      }
      const row = rows[i]!; // i < length
      if (end[row] === start[row]) {
        instants[instantAt++] = end[row]!;
      } else {
        starts[spanAt] = start[row]!;
        ends[spanAt++] = end[row]!;
      }
    }
    // One sort per slice: each is tens of milliseconds on a large log.
    for (const sorted of [starts, ends, instants]) {
      if (!(await tick())) {
        return null;
      }
      sorted.sort();
    }
    return new CallSpans(starts, ends, instants);
  }

  /** The frames {@link reaches} counts inside `window`, or every frame where it is null. */
  in(window: TimeWindow | null): number {
    const starts = this._starts;
    const instants = this._instants;
    if (!window) {
      return starts.length + instants.length;
    }
    const ends = this._ends;
    // Every frame that ended by the window's start also started before its end.
    return (
      firstIndexWhere(starts.length, (i) => starts[i]! >= window.end) -
      firstIndexWhere(ends.length, (i) => ends[i]! > window.start) +
      firstIndexWhere(instants.length, (i) => instants[i]! > window.end) -
      firstIndexWhere(instants.length, (i) => instants[i]! >= window.start)
    );
  }
}
