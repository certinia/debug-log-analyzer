/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { rawStoreOf } from '#test-helpers/apexLog.js';
import { type FakeHost, fakeHost } from '#test-helpers/fakeHost.js';
import type { FrameBudgetOptions } from '../../utility/FrameBudget.js';
import type { LogIndex } from '../LogIndex.js';
import type { LogStore } from '../LogStore.js';
import { setRange, type TimeWindow } from '../rangeScope.js';
import {
  WindowIndex,
  windowIndex,
  type WindowStats,
  WindowStatsController,
} from '../windowStats.js';

const options: FrameBudgetOptions = { yieldSlice: () => Promise.resolve() };

/** A frame's log lines: one to open it at `start`, then its children, then one to close it at `end`. */
type Lines = string[];

const line = (at: number, rest: string): string => `09:18:22.6 (${at})|${rest}\n`;

/** An Apex method: category Apex. */
function apex(start: number, end: number, children: Lines[] = []): Lines {
  const name = `ns.Work.m${start}()`;
  return [
    line(start, `METHOD_ENTRY|[1]|01p|${name}`),
    ...children.flat(),
    line(end, `METHOD_EXIT|[1]|${name}`),
  ];
}

/** One query: category SOQL, a soqlCount of 1. */
function soql(start: number, end: number): Lines {
  return [
    line(start, 'SOQL_EXECUTE_BEGIN|[1]|Aggregations:0|SELECT Id FROM Account'),
    line(end, 'SOQL_EXECUTE_END|[1]|Rows:0'),
  ];
}

/** One DML statement: category DML, a dmlCount of 1. */
function dml(start: number, end: number): Lines {
  return [line(start, 'DML_BEGIN|[1]|Op:Insert|Type:Account|Rows:1'), line(end, 'DML_END|[1]')];
}

/** A code unit named for namespace `pkg`: category Code Unit, namespace pkg. */
function pkgUnit(start: number, end: number): Lines {
  return [
    line(start, 'CODE_UNIT_STARTED|[EXTERNAL]|01q|pkg.Work'),
    line(end, 'CODE_UNIT_FINISHED|pkg.Work'),
  ];
}

/** A leaf line, which spans no time. */
function leaf(at: number): Lines {
  return [line(at, 'STATEMENT_EXECUTE|[1]')];
}

async function storeOf(...frames: Lines[]): Promise<LogStore> {
  return (await rawStoreOf(frames.flat().join(''))).store;
}

/** The stats the log's index gives for `window`. */
async function statsFor(store: LogStore, window: TimeWindow): Promise<WindowStats> {
  return (await store.derive(windowIndex)).statsFor(window);
}

/**
 * An index of `store` that counts its time reads after the build, so a test can
 * prove that answering a window reads a handful of rows rather than the log.
 */
async function countingIndex(
  store: LogStore,
): Promise<{ index: WindowIndex; visited: () => number; reset: () => void }> {
  const real = await store.logIndex();
  let reads = 0;
  const watched = (column: Float64Array): Float64Array =>
    new Proxy(column, {
      get(target, key) {
        if (typeof key === 'string' && /^\d+$/.test(key)) {
          reads++;
        }
        const value = Reflect.get(target, key) as unknown;
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  const index = Object.create(real, {
    start: { value: watched(real.start) },
    end: { value: watched(real.end) },
  }) as LogIndex;
  const built = await WindowIndex.build(index, options);
  return {
    index: built,
    visited: () => reads,
    reset: () => {
      reads = 0;
    },
  };
}

describe('windowStats', () => {
  it('answers category, namespace and counts from one index', async () => {
    const store = await storeOf(pkgUnit(0, 100), soql(100, 300), dml(300, 400));

    const stats = await statsFor(store, { start: 0, end: 400 });

    expect(stats.selfByCategory.get('Code Unit')).toBeCloseTo(100, 3);
    expect(stats.selfByCategory.get('SOQL')).toBeCloseTo(200, 3);
    expect(stats.selfByCategory.get('DML')).toBeCloseTo(100, 3);
    expect(stats.selfByNamespace.get('pkg')).toBeCloseTo(100, 3);
    expect(stats.selfByNamespace.get('default')).toBeCloseTo(300, 3);
    expect(stats.counts).toEqual({
      soqlCount: 1,
      soqlRowCount: 0,
      dmlCount: 1,
      dmlRowCount: 1,
      soslCount: 0,
    });
  });

  it('counts only the self time inside the window', async () => {
    const store = await storeOf(apex(0, 1_000));

    const stats = await statsFor(store, { start: 200, end: 500 });

    expect(stats.selfByCategory.get('Apex')).toBeCloseTo(300, 3);
  });

  // Any part of a statement inside the window counts it: one the window cuts
  // across still ran in it.
  it('counts a statement that began before the window', async () => {
    const store = await storeOf(soql(0, 1_000));

    const stats = await statsFor(store, { start: 500, end: 900 });

    expect(stats.counts.soqlCount).toBe(1);
  });

  it('counts a statement that runs past the end of the window', async () => {
    const store = await storeOf(apex(0, 100), soql(800, 2_000));

    const stats = await statsFor(store, { start: 0, end: 1_000 });

    expect(stats.counts.soqlCount).toBe(1);
  });

  it('still counts nothing for a statement the window never reaches', async () => {
    const store = await storeOf(soql(0, 100), apex(500, 600));

    const stats = await statsFor(store, { start: 500, end: 600 });

    expect(stats.counts.soqlCount).toBe(0);
  });

  // Counts come from the events' own times, not from the buckets, so a window
  // that stops a nanosecond short leaves the statement out.
  it('counts a statement by its own times, not the bucket it sits in', async () => {
    const store = await storeOf(apex(0, 1_000_000, [soql(500_000, 500_100)]));
    const index = await store.derive(windowIndex);

    expect(index.statsFor({ start: 0, end: 499_999 }).counts.soqlCount).toBe(0);
    expect(index.statsFor({ start: 0, end: 500_000 }).counts.soqlCount).toBe(1);
  });

  it('reads a parent by its own gaps, not its span', async () => {
    // Apex spans 0-100 with a SOQL child filling 10-90.
    const store = await storeOf(apex(0, 100, [soql(10, 90)]));

    const stats = await statsFor(store, { start: 0, end: 50 });

    expect(stats.selfByCategory.get('Apex')).toBeCloseTo(10, 3);
    expect(stats.selfByCategory.get('SOQL')).toBeCloseTo(40, 3);
  });

  it('finds nothing in a window the log does not reach', async () => {
    const store = await storeOf(apex(0, 100));

    const stats = await statsFor(store, { start: 500, end: 600 });

    expect(stats.selfByCategory.size).toBe(0);
    expect(stats.counts.soqlCount).toBe(0);
  });

  // A leaf read as reaching forever broke the binary search, so an edge walked
  // every sibling before the window.
  it('reads a handful of siblings where leaf lines sit among them', async () => {
    const frames = Array.from({ length: 1_000 }, (_, i) => [
      apex(i * 10, i * 10 + 5),
      leaf(i * 10 + 7),
    ]).flat();
    const { index, visited, reset } = await countingIndex(await storeOf(...frames));
    reset();

    index.statsFor({ start: 9_901, end: 9_903 });

    expect(visited()).toBeLessThan(100);
  });
});

describe('windowStats own time', () => {
  it('adds up the gaps between several children', async () => {
    // Gaps of 0-10, 20-40 and 50-100 belong to the parent.
    const store = await storeOf(apex(0, 100, [soql(10, 20), soql(40, 50)]));

    const stats = await statsFor(store, { start: 0, end: 100 });

    expect(stats.selfByCategory.get('Apex')).toBeCloseTo(80, 3);
    expect(stats.selfByCategory.get('SOQL')).toBeCloseTo(20, 3);
  });

  it('reads a gap that opens before the window and reaches into it', async () => {
    // The parent's own time runs 90-200, and the window opens at 150.
    const store = await storeOf(apex(0, 200, [soql(10, 90)]));

    const stats = await statsFor(store, { start: 150, end: 200 });

    expect(stats.selfByCategory.get('Apex')).toBeCloseTo(50, 3);
    expect(stats.selfByCategory.has('SOQL')).toBe(false);
  });

  it('holds none of a parent whose child fills the window', async () => {
    const store = await storeOf(apex(0, 100, [soql(10, 90)]));

    const stats = await statsFor(store, { start: 20, end: 80 });

    expect(stats.selfByCategory.get('Apex')).toBeUndefined();
    expect(stats.selfByCategory.get('SOQL')).toBeCloseTo(60, 3);
  });

  // A drag reads the same wide parent for window after window, from children it keeps.
  it('reads a parent of many children right for each window of a drag', async () => {
    // Each 100 ns slot: the parent's own 0-40, then a query 40-100.
    const queries = Array.from({ length: 100 }, (_, i) => soql(i * 100 + 40, i * 100 + 100));
    const store = await storeOf(apex(0, 10_000, queries));

    const first = await statsFor(store, { start: 1010, end: 2990 });
    const second = await statsFor(store, { start: 5020, end: 7970 });

    expect(first.selfByCategory.get('Apex')).toBeCloseTo(790, 3);
    expect(first.selfByCategory.get('SOQL')).toBeCloseTo(1190, 3);
    expect(second.selfByCategory.get('Apex')).toBeCloseTo(1180, 3);
    expect(second.selfByCategory.get('SOQL')).toBeCloseTo(1770, 3);
  });
});

// The point of the index: the viewport moves per frame, so a window must be
// answered without reading the log again.
describe('windowStats index', () => {
  const roots = () => Array.from({ length: 4_096 }, (_, i) => apex(i * 100, i * 100 + 100));

  it('answers a window from the buckets, reading only its edges', async () => {
    const { index, visited, reset } = await countingIndex(await storeOf(...roots()));
    reset();

    const stats = index.statsFor({ start: 100_000, end: 200_000 });

    expect(stats.selfByCategory.get('Apex')).toBeCloseTo(100_000, 0);
    // The two part buckets at the edges, not 4,096 siblings.
    expect(visited()).toBeLessThan(100);
  });

  it('answers a window it has already worked out without reading again', async () => {
    const { index, visited, reset } = await countingIndex(await storeOf(...roots()));
    const window = { start: 100_000, end: 200_000 };
    index.statsFor(window);
    reset();

    index.statsFor(window);

    expect(visited()).toBe(0);
  });
});

describe('WindowStatsController', () => {
  const hosts: FakeHost[] = [];

  afterEach(() => {
    hosts.splice(0).forEach((host) => host.disconnect());
    setRange(null);
  });

  function connected(store: () => LogStore): { window: WindowStatsController; host: FakeHost } {
    const host = fakeHost();
    const window = new WindowStatsController(host, store);
    host.connect();
    hosts.push(host);
    return { window, host };
  }

  it('has no stats while the log is read, then asks its host to render them', async () => {
    const store = await storeOf(apex(0, 1_000));
    const { window, host } = connected(() => store);
    setRange({ start: 0, end: 500 });
    const render = jest.spyOn(host, 'requestUpdate');

    expect(window.stats).toBeNull();
    expect(window.pending).toBe(true);
    await store.derive(windowIndex);

    expect(render).toHaveBeenCalled();
    expect(window.stats).not.toBeNull();
  });

  it("answers for the log it is given now, never the last one's", async () => {
    const first = await storeOf(apex(0, 1_000));
    const second = await storeOf(dml(0, 1_000));
    let store = first;
    const { window } = connected(() => store);
    setRange({ start: 0, end: 1_000 });
    void window.stats;
    await first.derive(windowIndex);

    store = second;
    expect(window.stats).toBeNull();
    await second.derive(windowIndex);

    expect([...(window.stats?.selfByCategory.keys() ?? [])]).toEqual(['DML']);
  });

  it('keeps waiting on a log it cannot read, without reading it again', async () => {
    const store = await storeOf(apex(0, 1_000));
    const derive = jest.spyOn(store, 'derive').mockRejectedValue(new Error('unreadable'));
    const { window } = connected(() => store);
    setRange({ start: 0, end: 500 });

    void window.stats;
    await new Promise((resolve) => setTimeout(resolve, 0));
    void window.stats;

    expect(window.pending).toBe(true);
    expect(derive).toHaveBeenCalledTimes(1);
  });
});
