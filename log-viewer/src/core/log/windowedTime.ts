/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { LogEvent } from '@apexdevtools/apex-log-parser';

import { CHECK_EVERY, type Tick } from '../utility/FrameBudget.js';
import { firstIndexWhere } from '../utility/Util.js';
import type { TimeWindow } from './rangeScope.js';
import { eachSelfGap, endOf, overlapOf, reachedRun } from './windowStats.js';

/** Time and calls inside a window, in the parser's nanoseconds. */
export interface WindowedTime {
  total: number;
  self: number;
  calls: number;
}

// Below this many children in a window, summing them beats a prefix lookup.
const WIDE = 64;

// Made for a wide parent the first time a window cuts it.
const childTotals = new WeakMap<readonly LogEvent[], Float64Array>();

/**
 * One frame's time inside `window`: the part of its span there, and the part of
 * that no child ran in.
 */
export function frameIn(event: LogEvent, window: TimeWindow): { total: number; self: number } {
  const total = overlapOf(event.timestamp, endOf(event), window);
  if (total === 0) {
    return { total: 0, self: 0 };
  }
  const children = event.children;
  const { from, to } = reachedRun(children, window);
  if (to - from > WIDE) {
    return { total, self: total - wideChildTimeIn(children, from, to, window) };
  }
  let self = 0;
  eachSelfGap(event, from, to, (start, end) => {
    self += overlapOf(start, end, window);
  });
  return { total, self };
}

function wideChildTimeIn(
  children: readonly LogEvent[],
  from: number,
  to: number,
  window: TimeWindow,
): number {
  // Siblings never overlap, so only the first and last of the run can be cut.
  const first = children[from]!; // the run is wider than WIDE, so both ends exist
  const last = children[to - 1]!;
  const totals = totalsOf(children);
  return (
    overlapOf(first.timestamp, endOf(first), window) +
    overlapOf(last.timestamp, endOf(last), window) +
    totals[to - 1]! -
    totals[from + 1]!
  );
}

// totals[i] is the time of every child before i.
function totalsOf(children: readonly LogEvent[]): Float64Array {
  let totals = childTotals.get(children);
  if (!totals) {
    totals = new Float64Array(children.length + 1);
    for (let i = 0; i < children.length; i++) {
      const child = children[i]!; // i < length
      totals[i + 1] = totals[i]! + endOf(child) - child.timestamp;
    }
    childTotals.set(children, totals);
  }
  return totals;
}

/** Whether the window holds some of the frame's time, or the frame's instant if it has none. */
export function reaches(event: LogEvent, window: TimeWindow): boolean {
  const start = event.timestamp;
  const end = endOf(event);
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

  private readonly _members: readonly LogEvent[];
  private readonly _holes: ReadonlyMap<LogEvent, readonly LogEvent[]> | undefined;
  // Null where no call nests in another, which is most rows.
  private readonly _groupAt: Int32Array | null;
  // Running totals over the groups, one longer than them.
  private readonly _total: Float64Array;
  private readonly _self: Float64Array;

  private constructor(
    members: readonly LogEvent[],
    holes: ReadonlyMap<LogEvent, readonly LogEvent[]> | undefined,
    {
      groupAt,
      total,
      self,
    }: { groupAt: Int32Array | null; total: Float64Array; self: Float64Array },
  ) {
    this._members = members;
    this._holes = holes;
    this._groupAt = groupAt;
    this._total = total;
    this._self = self;
    const groups = total.length - 1;
    this.whole = { total: total[groups]!, self: self[groups]!, calls: members.length };
  }

  static of(
    occurrences: readonly LogEvent[],
    holes?: ReadonlyMap<LogEvent, readonly LogEvent[]>,
  ): SpanIndex {
    const members = inStartOrder(occurrences);
    const groups = new GroupBuilder(holes);
    for (const member of members) {
      groups.add(member);
    }
    return new SpanIndex(members, holes, groups.finish());
  }

  /** {@link of} a slice at a time; null when abandoned. */
  static async build(
    occurrences: readonly LogEvent[],
    holes: ReadonlyMap<LogEvent, readonly LogEvent[]> | undefined,
    tick: Tick,
  ): Promise<SpanIndex | null> {
    const members = inStartOrder(occurrences);
    const groups = new GroupBuilder(holes);
    for (let i = 0; i < members.length; i++) {
      if (i % CHECK_EVERY === 0 && !(await tick())) {
        return null;
      }
      groups.add(members[i]!); // i < length
    }
    return new SpanIndex(members, holes, groups.finish());
  }

  /** The row's figures inside `window`, or for the whole log where it is null. */
  in(window: TimeWindow | null): WindowedTime {
    if (!window) {
      return this.whole;
    }
    const groups = this._total.length - 1;
    const head = (g: number) => this._members[this._memberAt(g)]!; // g < groups
    let lo = firstIndexWhere(groups, (g) => endOf(head(g)) >= window.start);
    let hi = firstIndexWhere(groups, (g) => head(g).timestamp > window.end);
    const held: WindowedTime = { total: 0, self: 0, calls: 0 };
    if (lo >= hi) {
      return held;
    }
    // A group's head is its outermost call, so its span is the group's.
    const cut = (g: number) => head(g).timestamp < window.start || endOf(head(g)) > window.end;
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
    const end = this._memberAt(g + 1);
    for (let i = this._memberAt(g); i < end; i++) {
      const member = this._members[i]!; // i is inside group g
      const own = frameIn(member, window);
      let total = own.total;
      for (const hole of this._holes?.get(member) ?? []) {
        total -= overlapOf(hole.timestamp, endOf(hole), window);
      }
      held.total += total;
      held.self += own.self;
      held.calls += reaches(member, window) ? 1 : 0;
    }
  }
}

// Outer first where two start together, so the outer heads its group.
function byStart(a: LogEvent, b: LogEvent): number {
  return a.timestamp - b.timestamp || endOf(b) - endOf(a);
}

// Calls that never nest are in order already, and the sort is most of a hot row's build.
function inStartOrder(occurrences: readonly LogEvent[]): readonly LogEvent[] {
  for (let i = 1; i < occurrences.length; i++) {
    if (byStart(occurrences[i - 1]!, occurrences[i]!) > 0) {
      return [...occurrences].sort(byStart);
    }
  }
  return occurrences;
}

class GroupBuilder {
  private readonly _holes: ReadonlyMap<LogEvent, readonly LogEvent[]> | undefined;
  private readonly _groupAt: number[] = [];
  private readonly _total = [0];
  private readonly _self = [0];
  private _groupEnd = -Infinity;
  private _added = 0;

  constructor(holes: ReadonlyMap<LogEvent, readonly LogEvent[]> | undefined) {
    this._holes = holes;
  }

  add(member: LogEvent): void {
    const total = this._total;
    const self = this._self;
    // Frames nest or stand apart, so one starting inside the group is inside it.
    if (member.timestamp >= this._groupEnd) {
      this._groupAt.push(this._added);
      this._groupEnd = endOf(member);
      total.push(total.at(-1)!);
      self.push(self.at(-1)!);
    }
    let own = endOf(member) - member.timestamp;
    const holes = this._holes?.get(member);
    if (holes) {
      for (const hole of holes) {
        own -= endOf(hole) - hole.timestamp;
      }
    }
    const at = this._groupAt.length;
    total[at]! += own;
    self[at]! += member.duration.self;
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

  /** Built a slice at a time; null when abandoned. */
  static async build(frames: readonly LogEvent[], tick: Tick): Promise<CallSpans | null> {
    let instantCount = 0;
    for (let i = 0; i < frames.length; i++) {
      if (i % CHECK_EVERY === 0 && !(await tick())) {
        return null;
      }
      const frame = frames[i]!; // i < length
      if (endOf(frame) === frame.timestamp) {
        instantCount++;
      }
    }
    const starts = new Float64Array(frames.length - instantCount);
    const ends = new Float64Array(starts.length);
    const instants = new Float64Array(instantCount);
    let spanAt = 0;
    let instantAt = 0;
    for (let i = 0; i < frames.length; i++) {
      if (i % CHECK_EVERY === 0 && !(await tick())) {
        return null;
      }
      const frame = frames[i]!; // i < length
      const end = endOf(frame);
      if (end === frame.timestamp) {
        instants[instantAt++] = end;
      } else {
        starts[spanAt] = frame.timestamp;
        ends[spanAt++] = end;
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
