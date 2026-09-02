/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';
import type { ApexLog, LogEvent } from 'apex-log-parser';

import type { FrameBudgetOptions } from '../../utility/FrameBudget.js';
import { windowIndexFor, type WindowStats } from '../windowStats.js';
import type { TimeWindow } from '../rangeScope.js';

const options: FrameBudgetOptions = { yieldSlice: () => Promise.resolve() };

interface Count {
  self: number;
  total: number;
}

/** The parser gives every event all five counters, zero included. */
interface Built {
  category: string;
  namespace: string;
  timestamp: number;
  exitStamp: number | null;
  soqlCount: Count;
  soqlRowCount: Count;
  dmlCount: Count;
  dmlRowCount: Count;
  soslCount: Count;
  children: Built[];
}

const count = (self: number): Count => ({ self, total: self });

interface Spec {
  category?: string;
  namespace?: string;
  soql?: number;
  dml?: number;
  children?: Built[];
  /** An unclosed frame, as a truncated log leaves its last frames. */
  unclosed?: boolean;
}

function ev(timestamp: number, exitStamp: number, spec: Spec = {}): Built {
  return {
    category: spec.category ?? 'Apex',
    namespace: spec.namespace ?? 'default',
    timestamp,
    exitStamp: spec.unclosed ? null : exitStamp,
    soqlCount: count(spec.soql ?? 0),
    soqlRowCount: count(0),
    dmlCount: count(spec.dml ?? 0),
    dmlRowCount: count(0),
    soslCount: count(0),
    children: spec.children ?? [],
  };
}

/** The log's own span, which sets where the index puts its bucket edges. */
function spanOf(children: readonly Built[]): { timestamp: number; exitStamp: number } {
  let last = 0;
  const reach = (event: Built): void => {
    last = Math.max(last, event.exitStamp ?? event.timestamp);
    event.children.forEach(reach);
  };
  children.forEach(reach);
  return { timestamp: children[0]?.timestamp ?? 0, exitStamp: last };
}

const logOf = (children: Built[]) => ({ children, ...spanOf(children) }) as unknown as ApexLog;

/** The stats a fresh index gives for `window`. */
async function statsFor(log: ApexLog, window: TimeWindow): Promise<WindowStats> {
  const index = await windowIndexFor(log, options);
  return index.statsFor(window);
}

/**
 * A log whose roots count their own time reads, so a test can prove that
 * answering a window reads a handful of siblings rather than the log.
 */
function countingLog(children: Built[]): {
  log: ApexLog;
  visited: () => number;
  reset: () => void;
} {
  let reads = 0;
  const watched = children.map(
    (child) =>
      new Proxy(child, {
        get(target, key, receiver) {
          if (key === 'timestamp' || key === 'exitStamp') {
            reads++;
          }
          return Reflect.get(target, key, receiver) as unknown;
        },
      }) as unknown as LogEvent,
  );
  return {
    log: { children: watched, ...spanOf(children) } as unknown as ApexLog,
    visited: () => reads,
    reset: () => {
      reads = 0;
    },
  };
}

describe('windowStats', () => {
  it('answers category, namespace and counts from one index', async () => {
    const log = logOf([
      ev(0, 100, { category: 'DML', namespace: 'pkg', dml: 2 }),
      ev(100, 300, { category: 'SOQL', soql: 3 }),
    ]);

    const stats = await statsFor(log, { start: 0, end: 300 });

    expect(stats.selfByCategory.get('DML')).toBeCloseTo(100, 3);
    expect(stats.selfByCategory.get('SOQL')).toBeCloseTo(200, 3);
    expect(stats.selfByNamespace.get('pkg')).toBeCloseTo(100, 3);
    expect(stats.selfByNamespace.get('default')).toBeCloseTo(200, 3);
    expect(stats.counts).toEqual({
      soqlCount: 3,
      soqlRowCount: 0,
      dmlCount: 2,
      dmlRowCount: 0,
      soslCount: 0,
    });
  });

  it('counts only the self time inside the window', async () => {
    const log = logOf([ev(0, 1_000, { category: 'Apex' })]);

    const stats = await statsFor(log, { start: 200, end: 500 });

    expect(stats.selfByCategory.get('Apex')).toBeCloseTo(300, 3);
  });

  // Any part of a statement inside the window counts it: one the window cuts
  // across still ran in it.
  it('counts a statement that began before the window', async () => {
    const log = logOf([ev(0, 1_000, { soql: 5 })]);

    const stats = await statsFor(log, { start: 500, end: 900 });

    expect(stats.counts.soqlCount).toBe(5);
  });

  it('counts a statement that runs past the end of the window', async () => {
    const log = logOf([ev(0, 100), ev(800, 2_000, { soql: 2 })]);

    const stats = await statsFor(log, { start: 0, end: 1_000 });

    expect(stats.counts.soqlCount).toBe(2);
  });

  it('still counts nothing for a statement the window never reaches', async () => {
    const log = logOf([ev(0, 100, { soql: 5 }), ev(500, 600)]);

    const stats = await statsFor(log, { start: 500, end: 600 });

    expect(stats.counts.soqlCount).toBe(0);
  });

  // Counts come from the events' own times, not from the buckets, so a window
  // that stops a nanosecond short leaves the statement out.
  it('counts a statement by its own times, not the bucket it sits in', async () => {
    const log = logOf([ev(0, 1_000_000), ev(500_000, 500_100, { soql: 1 })]);

    const before = await statsFor(log, { start: 0, end: 499_999 });
    const index = await windowIndexFor(log, options);
    const upTo = index.statsFor({ start: 0, end: 500_000 });

    expect(before.counts.soqlCount).toBe(0);
    expect(upTo.counts.soqlCount).toBe(1);
  });

  it('reads a parent by its own gaps, not its span', async () => {
    // Apex spans 0-100 with a SOQL child filling 10-90.
    const log = logOf([
      ev(0, 100, { category: 'Apex', children: [ev(10, 90, { category: 'SOQL' })] }),
    ]);

    const stats = await statsFor(log, { start: 0, end: 50 });

    expect(stats.selfByCategory.get('Apex')).toBeCloseTo(10, 3);
    expect(stats.selfByCategory.get('SOQL')).toBeCloseTo(40, 3);
  });

  it('finds nothing in a window the log does not reach', async () => {
    const log = logOf([ev(0, 100)]);

    const stats = await statsFor(log, { start: 500, end: 600 });

    expect(stats.selfByCategory.size).toBe(0);
    expect(stats.counts.soqlCount).toBe(0);
  });

  it('holds an unclosed frame rather than dropping it', async () => {
    const log = logOf([
      ev(0, 0, { unclosed: true, children: [ev(400, 500, { category: 'SOQL', soql: 1 })] }),
    ]);

    const stats = await statsFor(log, { start: 300, end: 600 });

    expect(stats.selfByCategory.get('SOQL')).toBeCloseTo(100, 3);
    expect(stats.counts.soqlCount).toBe(1);
  });
});

describe('windowStats own time', () => {
  it('adds up the gaps between several children', async () => {
    // Gaps of 0-10, 20-40 and 50-100 belong to the parent.
    const log = logOf([
      ev(0, 100, {
        category: 'Apex',
        children: [ev(10, 20, { category: 'SOQL' }), ev(40, 50, { category: 'SOQL' })],
      }),
    ]);

    const stats = await statsFor(log, { start: 0, end: 100 });

    expect(stats.selfByCategory.get('Apex')).toBeCloseTo(80, 3);
    expect(stats.selfByCategory.get('SOQL')).toBeCloseTo(20, 3);
  });

  it('reads a gap that opens before the window and reaches into it', async () => {
    // The parent's own time runs 90-200, and the window opens at 150.
    const log = logOf([
      ev(0, 200, { category: 'Apex', children: [ev(10, 90, { category: 'SOQL' })] }),
    ]);

    const stats = await statsFor(log, { start: 150, end: 200 });

    expect(stats.selfByCategory.get('Apex')).toBeCloseTo(50, 3);
    expect(stats.selfByCategory.has('SOQL')).toBe(false);
  });

  it('holds none of a parent whose child fills the window', async () => {
    const log = logOf([
      ev(0, 100, { category: 'Apex', children: [ev(10, 90, { category: 'SOQL' })] }),
    ]);

    const stats = await statsFor(log, { start: 20, end: 80 });

    expect(stats.selfByCategory.get('Apex')).toBeUndefined();
    expect(stats.selfByCategory.get('SOQL')).toBeCloseTo(60, 3);
  });

  // A child running past its parent's exit must not lend it negative time.
  it('never gives a frame less than nothing', async () => {
    const log = logOf([
      ev(0, 50, { category: 'Apex', children: [ev(10, 90, { category: 'SOQL' })] }),
    ]);

    const stats = await statsFor(log, { start: 0, end: 100 });

    expect(stats.selfByCategory.get('Apex')).toBeCloseTo(10, 3);
  });
});

// The point of the index: the viewport moves per frame, so a window must be
// answered without reading the log again.
describe('windowStats index', () => {
  const roots = () => Array.from({ length: 4_096 }, (_, i) => ev(i * 100, i * 100 + 100));

  it('answers a window from the buckets, reading only its edges', async () => {
    const { log, visited, reset } = countingLog(roots());
    const index = await windowIndexFor(log, options);
    reset();

    const stats = index.statsFor({ start: 100_000, end: 200_000 });

    expect(stats.selfByCategory.get('Apex')).toBeCloseTo(100_000, 0);
    // The two part buckets at the edges, not 4,096 siblings.
    expect(visited()).toBeLessThan(100);
  });

  it('answers a window it has already worked out without reading again', async () => {
    const { log, visited, reset } = countingLog(roots());
    const index = await windowIndexFor(log, options);
    const window = { start: 100_000, end: 200_000 };
    index.statsFor(window);
    reset();

    index.statsFor(window);

    expect(visited()).toBe(0);
  });

  it('builds one index per log, however many readers ask', async () => {
    const { log, visited } = countingLog(roots());

    const [first, second] = await Promise.all([
      windowIndexFor(log, options),
      windowIndexFor(log, options),
    ]);
    const reads = visited();
    const third = await windowIndexFor(log, options);

    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(visited()).toBe(reads);
  });
});
