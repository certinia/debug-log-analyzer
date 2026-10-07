/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';
import type { LogEvent } from '@apexdevtools/apex-log-parser';

import type { TimeWindow } from '../rangeScope.js';
import { CallSpans, SpanIndex, frameIn } from '../windowedTime.js';

/** A frame with the durations the parser gives it; null `exitStamp` is a leaf line. */
function frame(timestamp: number, exitStamp: number | null, children: LogEvent[] = []): LogEvent {
  const total = exitStamp === null ? 0 : exitStamp - timestamp;
  const inner = children.reduce((sum, child) => sum + child.duration.total, 0);
  return {
    timestamp,
    exitStamp,
    duration: { total, self: total - inner },
    children,
  } as unknown as LogEvent;
}

/** A seeded generator, so a failing case can be replayed. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** A tree filling `start` to `end`, children laid end to end with gaps. */
function tree(next: () => number, start: number, end: number, depth: number): LogEvent {
  const children: LogEvent[] = [];
  if (depth > 0) {
    let at = start;
    while (at < end) {
      const from = at + Math.floor(next() * 20);
      const to = Math.min(end, from + 1 + Math.floor(next() * 200));
      if (from >= end) {
        break;
      }
      children.push(
        next() < 0.1 ? frame(from, null) : tree(next, from, to, depth - 1 - Math.floor(next() * 2)),
      );
      at = to;
    }
  }
  return frame(start, end, children);
}

function windowIn(next: () => number, start: number, end: number): TimeWindow {
  const a = start + Math.floor(next() * (end - start));
  const b = start + Math.floor(next() * (end - start));
  return a === b ? { start: a, end: a + 1 } : { start: Math.min(a, b), end: Math.max(a, b) };
}

const endOf = (event: LogEvent) => event.exitStamp ?? event.timestamp;
const overlap = (start: number, end: number, w: TimeWindow) =>
  Math.max(0, Math.min(end, w.end) - Math.max(start, w.start));

/** The window's time in one frame, the slow way: every gap between its children. */
function oracleFrame(event: LogEvent, w: TimeWindow): { total: number; self: number } {
  let self = 0;
  let cursor = event.timestamp;
  for (const child of event.children) {
    self += overlap(cursor, child.timestamp, w);
    cursor = Math.max(cursor, endOf(child));
  }
  self += overlap(cursor, endOf(event), w);
  return { total: overlap(event.timestamp, endOf(event), w), self };
}

function oracleCounts(event: LogEvent, w: TimeWindow): boolean {
  const start = event.timestamp;
  const end = endOf(event);
  return start === end ? start >= w.start && start <= w.end : start < w.end && end > w.start;
}

function everyFrame(root: LogEvent): LogEvent[] {
  const all: LogEvent[] = [];
  const stack = [root];
  while (stack.length) {
    const event = stack.pop()!; // non-empty: the loop condition just checked
    all.push(event);
    stack.push(...event.children);
  }
  return all;
}

describe('frameIn', () => {
  it('matches the gap-by-gap answer on random trees and windows', () => {
    const next = random(1);
    for (let run = 0; run < 50; run++) {
      const root = tree(next, 0, 10_000, 4);
      const w = windowIn(next, -500, 10_500);
      for (const event of everyFrame(root)) {
        expect(frameIn(event, w)).toEqual(oracleFrame(event, w));
      }
    }
  });

  it('holds nothing of a frame the window only touches at its edge', () => {
    const event = frame(100, 200, [frame(120, 150)]);

    expect(frameIn(event, { start: 200, end: 300 })).toEqual({ total: 0, self: 0 });
    expect(frameIn(event, { start: 0, end: 100 })).toEqual({ total: 0, self: 0 });
  });

  it('cuts a frame at both edges', () => {
    const event = frame(0, 1_000, [frame(100, 300), frame(600, 900)]);

    expect(frameIn(event, { start: 200, end: 700 })).toEqual({ total: 500, self: 300 });
  });

  // A loop of statements gives one frame tens of thousands of children.
  it('answers a parent with many children the same as the slow way', () => {
    const children = Array.from({ length: 500 }, (_, i) => frame(i * 10 + 2, i * 10 + 7));
    const parent = frame(0, 5_000, children);
    const next = random(2);
    for (let run = 0; run < 100; run++) {
      const w = windowIn(next, -100, 5_100);
      expect(frameIn(parent, w)).toEqual(oracleFrame(parent, w));
    }
  });
});

describe('SpanIndex', () => {
  /** The row's time inside `w`, the slow way: each occurrence less its holes. */
  function oracleRow(
    occurrences: LogEvent[],
    holes: Map<LogEvent, LogEvent[]>,
    w: TimeWindow,
  ): { total: number; self: number; calls: number } {
    let total = 0;
    let self = 0;
    let calls = 0;
    for (const o of occurrences) {
      const own = oracleFrame(o, w);
      total += own.total;
      for (const hole of holes.get(o) ?? []) {
        total -= overlap(hole.timestamp, endOf(hole), w);
      }
      self += own.self;
      calls += oracleCounts(o, w) ? 1 : 0;
    }
    return { total, self, calls };
  }

  it('sums disjoint occurrences, cutting only the two at the edges', () => {
    const next = random(3);
    for (let run = 0; run < 50; run++) {
      const root = tree(next, 0, 10_000, 3);
      const occurrences = root.children;
      const index = SpanIndex.of(occurrences);
      const w = windowIn(next, -500, 10_500);

      expect(index.in(w)).toEqual(oracleRow(occurrences, new Map(), w));
    }
  });

  it('gives back the whole-log figures where there is no window', () => {
    const occurrences = [frame(0, 100, [frame(10, 40)]), frame(200, 260)];

    expect(SpanIndex.of(occurrences).in(null)).toEqual({ total: 160, self: 130, calls: 2 });
  });

  // a holds b, which holds a2: b is a's nested call of the same frame, so the
  // time a2 runs is counted once, through a2, and b's own time is b's row's.
  it('counts a recursive frame once, less the nested call of the same frame', () => {
    const a2 = frame(400, 500, [frame(420, 450)]);
    const b = frame(300, 700, [a2]);
    const a = frame(0, 1_000, [frame(100, 200), b]);
    const occurrences = [a2, a];
    const holes = new Map([[a, [b]]]);
    const index = SpanIndex.of(occurrences, holes);

    // a: 1,000 less b's 400; a2: 100. Self: a's 500, a2's 70.
    expect(index.in(null)).toEqual({ total: 700, self: 570, calls: 2 });
    const next = random(4);
    for (let run = 0; run < 200; run++) {
      const w = windowIn(next, -100, 1_100);
      expect(index.in(w)).toEqual(oracleRow(occurrences, holes, w));
    }
  });

  // A hot statement on a large log is one row of hundreds of thousands of calls.
  it('builds a row of many calls a slice at a time, to the same answer', async () => {
    const occurrences = Array.from({ length: 2_000 }, (_, i) => frame(i * 10, i * 10 + 5));
    let yields = 0;
    let clock = 0;
    const tick = () => {
      clock += 1;
      if (clock % 3 === 0) {
        yields += 1;
      }
      return Promise.resolve(true);
    };

    const built = await SpanIndex.build(occurrences, undefined, tick);

    expect(yields).toBeGreaterThan(1);
    const w = { start: 1_234, end: 15_678 };
    expect(built!.in(w)).toEqual(SpanIndex.of(occurrences).in(w));
  });

  it('abandons a sliced build when told to', async () => {
    const occurrences = Array.from({ length: 2_000 }, (_, i) => frame(i * 10, i * 10 + 5));

    expect(await SpanIndex.build(occurrences, undefined, () => Promise.resolve(false))).toBeNull();
  });

  it('counts an instant inside the window, and not one outside it', () => {
    const index = SpanIndex.of([frame(50, null), frame(500, null)]);

    expect(index.in({ start: 0, end: 100 })).toEqual({ total: 0, self: 0, calls: 1 });
    expect(index.in({ start: 100, end: 400 })).toEqual({ total: 0, self: 0, calls: 0 });
  });
});

describe('CallSpans', () => {
  const build = async (frames: LogEvent[]) =>
    (await CallSpans.build(frames, () => Promise.resolve(true)))!;

  it('counts the frames the window reaches', async () => {
    const next = random(5);
    const root = tree(next, 0, 10_000, 4);
    const frames = everyFrame(root);
    const spans = await build(frames);
    for (let run = 0; run < 50; run++) {
      const w = windowIn(next, -500, 10_500);
      expect(spans.in(w)).toBe(frames.filter((event) => oracleCounts(event, w)).length);
    }
    expect(spans.in(null)).toBe(frames.length);
  });

  it('counts an instant on either edge of the window, as its row is shown', async () => {
    const spans = await build([frame(100, null), frame(500, null), frame(100, 200)]);

    expect(spans.in({ start: 100, end: 300 })).toBe(2);
    expect(spans.in({ start: 300, end: 500 })).toBe(1);
    expect(spans.in({ start: 200, end: 300 })).toBe(0);
  });

  it('abandons a sliced build when told to', async () => {
    expect(await CallSpans.build([frame(0, 10)], () => Promise.resolve(false))).toBeNull();
  });
});
