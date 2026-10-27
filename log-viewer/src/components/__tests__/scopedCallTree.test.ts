/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';
import type { ApexLog } from '@apexdevtools/apex-log-parser';

import { indexesOf, rawStoreOf } from '#test-helpers/apexLog.js';
import { setCurrentLog } from '#core/log/LogStore.js';
import { CallSpans } from '#core/log/windowedTime.js';
import type { FrameBudgetOptions } from '#core/utility/FrameBudget.js';
import {
  buildScopedCallTree,
  buildWholeLogCallTree,
  frameEventIndexes,
  locatableEventIndexes,
  revealableEventIndex,
  rowIdsByPath,
  type LiveWindow,
  type ScopedRow,
} from '../scopedCallTree.js';

/** A line or block of a test log, opened at `start` and closed at `end`. */
interface Span {
  open: string;
  /** Absent for a line with no end of its own. */
  close?: string;
  start: number;
  end: number;
  children: Span[];
}

const QUERY = 'SELECT Id FROM Account';

const method = (text: string, start: number, end: number, ...children: Span[]): Span => ({
  open: `METHOD_ENTRY|[1]|01p|${text}`,
  close: `METHOD_EXIT|[1]|${text}`,
  start,
  end,
  children,
});
const unit = (text: string, start: number, end: number, ...children: Span[]): Span => ({
  open: `CODE_UNIT_STARTED|[EXTERNAL]|01q|${text}`,
  close: `CODE_UNIT_FINISHED|${text}`,
  start,
  end,
  children,
});
const query = (start: number, end: number): Span => ({
  open: `SOQL_EXECUTE_BEGIN|[1]|Aggregations:0|${QUERY}`,
  close: 'SOQL_EXECUTE_END|[1]|Rows:1',
  start,
  end,
  children: [],
});
const line = (at: number, text: string): Span => ({ open: text, start: at, end: at, children: [] });
const limitBlock = (start: number, end: number): Span => ({
  open: 'CUMULATIVE_LIMIT_USAGE',
  close: 'CUMULATIVE_LIMIT_USAGE_END',
  start,
  end,
  children: [line(start, 'LIMIT_USAGE_FOR_NS|(default)|')],
});

function logText(spans: readonly Span[]): string {
  const lines: string[] = [];
  const write = (span: Span): void => {
    lines.push(`09:18:22.6 (${span.start})|${span.open}\n`);
    span.children.forEach(write);
    if (span.close) {
      lines.push(`09:18:22.6 (${span.end})|${span.close}\n`);
    }
  };
  spans.forEach(write);
  return lines.join('');
}

/** Parses `spans` and makes the log the one on screen, which the builders read. */
async function load(...spans: Span[]): Promise<ApexLog> {
  const { log, store } = await rawStoreOf(logText(spans));
  setCurrentLog(store);
  return log;
}

/** The id of the `nth` frame with `text`. */
function frame(log: ApexLog, text: string, nth = 0): number {
  const id = indexesOf(log, text)[nth];
  if (id === undefined) {
    throw new Error(`no frame ${text} #${nth}`);
  }
  return id;
}

/** The id of the first event of `type`. */
function ofType(log: ApexLog, type: string): number {
  for (let id = 1; id <= log.eventCount; id++) {
    if (log.event(id)?.type === type) {
      return id;
    }
  }
  throw new Error(`no ${type}`);
}

/** The ids of the events directly under `parent`. */
function childIds(log: ApexLog, parent: number): number[] {
  const ids: number[] = [];
  for (let id = 1; id <= log.eventCount; id++) {
    if (log.columns.parent[id] === parent) {
      ids.push(id);
    }
  }
  return ids;
}

// exec → m1 → m2 → query, no branches; the query spends all 500 ns.
const chain = (): Span[] => [
  unit('exec', 0, 500, method('m1', 0, 500, method('m2', 0, 500, query(0, 500)))),
];

/** These fixtures are small enough to never hit a slice deadline, so `yieldSlice`
 *  is only there to satisfy the contract. */
const options: FrameBudgetOptions = { yieldSlice: () => Promise.resolve() };

function build(eventIndex: number, instances?: number[]) {
  return buildScopedCallTree(eventIndex, instances ?? null, options);
}

/** A statement called from a loop after the chain: `count` occurrences of the
 *  same frame, 1 ns each. */
async function loopLog(
  count: number,
): Promise<{ log: ApexLog; loop: number; instances: number[] }> {
  const calls = Array.from({ length: count }, (_, i) => query(1000 + i, 1001 + i));
  const log = await load(...chain(), method('loop', 1000, 1000 + count, ...calls));
  const loop = frame(log, 'loop');
  return { log, loop, instances: childIds(log, loop) };
}

/** Every row's type, whole tree. */
function types(rows: readonly ScopedRow[]): string[] {
  return rows.flatMap((row) => [row.type, ...types(row._children ?? [])]);
}

/** The rows from the first root down the first child of each. */
function firstChain(rows: readonly ScopedRow[]): ScopedRow[] {
  const found: ScopedRow[] = [];
  for (let node = rows[0]; node; node = node._children?.[0]) {
    found.push(node);
  }
  return found;
}

describe('buildScopedCallTree', () => {
  it('returns null when nothing is selected', async () => {
    await load(...chain());

    expect(await build(-1)).toBeNull();
  });

  it('time-order: the selection sits under its callers, rooted at the log', async () => {
    const log = await load(...chain());
    const tree = (await build(frame(log, 'm2')))!;
    expect(tree.rootTotal).toBe(500);

    const rows = firstChain((await tree.timeOrder(options))!);
    expect(rows.map((r) => r.text)).toEqual(['exec', 'm1', 'm2', QUERY]);
    // A caller holds the time that reached the selection through it, and none of
    // it is its own work, so the tree reads 100% from the top down to m2.
    expect(rows[0]?.duration).toEqual({ total: 500, self: 0 });
    expect(rows[1]?.duration).toEqual({ total: 500, self: 0 });
    // The selection and what ran inside it keep their real durations.
    expect(rows[2]?.duration).toEqual({ total: 500, self: 0 });
    expect(rows[3]?.duration).toEqual({ total: 500, self: 500 });
    // The path opens itself, so the selection is on screen; its subtree does not.
    expect(rows.map((r) => r.onPath)).toEqual([true, true, undefined, undefined]);
  });

  it('bottom-up: a selected leaf is the whole view, with nothing above it', async () => {
    const log = await load(...chain());
    const rows = (await (await build(frame(log, QUERY)))!.bottomUp(options))!;

    expect(rows.map((r) => r.text)).toEqual([QUERY]);
    expect(rows[0]?.duration.self).toBe(500);
    // Its real callers are outside the scope, so the row stands alone.
    expect(rows[0]?._children).toBeNull();
  });

  it('bottom-up: the hottest frame inside the selection heads the view', async () => {
    // m2 spends none of its time itself; the statement it holds spends all of it.
    // So the statement heads the view and m2 reads as its caller, and m2's own row
    // comes last. exec and m1 lead to the selection but ran nothing inside it, so
    // bottom-up leaves them out.
    const log = await load(...chain());
    const rows = (await (await build(frame(log, 'm2')))!.bottomUp(options))!;

    expect(rows.map((row) => row.text)).toEqual([QUERY, 'm2']);
    expect(rows[0]?.duration).toEqual({ total: 500, self: 500 });
    expect(rows[0]?._children?.map((row) => row.text)).toEqual(['m2']);
    // Every caller counts the call it contributed, never zero.
    expect([rows[0]?.callCount, rows[0]?._children?.[0]?.callCount]).toEqual([1, 1]);
    expect(rows[0]?._children?.[0]?._children).toBeNull();
  });

  // A time-based prune dropped the frame that took no time along with the details.
  it('drops details, keeping a frame that took no time', async () => {
    const log = await load(
      ...chain(),
      method(
        'scope',
        1000,
        1050,
        line(1000, 'HEAP_ALLOCATE|[12]|Bytes:8'),
        line(1000, 'STATEMENT_EXECUTE|[12]'),
        method('instant', 1000, 1000),
        method('timed', 1000, 1050),
      ),
    );

    const tree = (await build(frame(log, 'scope')))!;
    const selected = (await tree.timeOrder(options))![0]!;
    expect(selected._children!.map((row) => row.text)).toEqual(['instant', 'timed']);
    // The dropped rows are not counted either, so the Calls total matches the rows.
    expect(tree.calls).toBe(3);
  });

  it('counts every call the scope holds, so each view totals the same', async () => {
    const log = await load(...chain());
    const tree = (await build(frame(log, 'm2')))!;
    const calls = (rows: ScopedRow[]): number => {
      let total = 0;
      const stack = [...rows];
      while (stack.length) {
        const row = stack.pop()!;
        total += row.callCount;
        if (row._children) {
          stack.push(...row._children);
        }
      }
      return total;
    };

    // m2 and the statement it holds. The callers above the selection are routes
    // to it rather than calls inside it, so they are not in the figure.
    expect(tree.calls).toBe(2);
    // Each caller still counts the one call of the selection it led to.
    expect(calls((await tree.timeOrder(options))!)).toBe(tree.calls + 2);
    expect(calls((await tree.aggregated(options))!)).toBe(tree.calls + 2);
    // Bottom-Up heads a row with every frame, so its top-level rows total the scope.
    expect((await tree.bottomUp(options))!.reduce((sum, row) => sum + row.callCount, 0)).toBe(
      tree.calls,
    );
  });

  // Bottom-Up seeds only frames, so a selected detail left it empty.
  it('keeps a selected detail in every view, and counts it as the one call', async () => {
    const log = await load(
      ...chain(),
      line(1000, 'VARIABLE_SCOPE_BEGIN|[12]|x|String|false|false'),
    );

    const tree = (await build(ofType(log, 'VARIABLE_SCOPE_BEGIN')))!;
    for (const view of ['timeOrder', 'aggregated', 'bottomUp'] as const) {
      expect(types((await tree[view](options))!)).toContain('VARIABLE_SCOPE_BEGIN');
    }
    expect(tree.calls).toBe(1);
  });

  it('aggregated: linear path stays one node per frame', async () => {
    const log = await load(...chain());
    const rows = firstChain((await (await build(frame(log, 'm2')))!.aggregated(options))!);

    expect(rows.map((row) => row.text)).toEqual(['exec', 'm1', 'm2', QUERY]);
    expect(rows.map((row) => row.callCount)).toEqual([1, 1, 1, 1]);
  });

  it('merges one caller for every occurrence it made', async () => {
    const { instances } = await loopLog(4);
    const tree = (await build(instances[0]!, instances))!;

    const roots = (await tree.timeOrder(options))!;
    expect(roots.map((r) => r.text)).toEqual(['loop']);
    // One row for the caller, holding all four calls and the time they took.
    expect(roots[0]?.callCount).toBe(4);
    expect(roots[0]?.duration).toEqual({ total: 4, self: 0 });
    expect(tree.rootTotal).toBe(4);
  });

  it('a wide aggregate merges every occurrence, uncapped', async () => {
    // The "occurrences × subtree" shape a NODE_BUDGET cap used to bound (see PR
    // #877's removal note). No cap exists any more, so every occurrence must
    // still be represented.
    const OCCURRENCES = 500;
    const { instances } = await loopLog(OCCURRENCES);

    const tree = (await build(instances[0]!, instances))!;
    expect(tree.rootTotal).toBe(OCCURRENCES);

    // Every occurrence merges into a single aggregated row, counting every call.
    // It sits under the caller they share, which the test above measures.
    const aggregated = (await tree.aggregated(options))![0]?._children?.[0];
    expect(aggregated?.callCount).toBe(OCCURRENCES);
    expect(aggregated?.duration.total).toBe(OCCURRENCES);

    // Same for bottom-up: the seed frame's self time sums across every occurrence.
    const [bottomUp] = (await tree.bottomUp(options))!;
    expect(bottomUp?.callCount).toBe(OCCURRENCES);
    expect(bottomUp?.duration.self).toBe(OCCURRENCES);
  });

  it('an aggregate of nested occurrences counts each one once', async () => {
    // A recursive frame: the outer call already holds the inner one, so taking
    // both as roots would walk the inner call twice.
    const log = await load(...chain(), method('rec', 2000, 2010, method('rec', 2004, 2010)));
    const [outer, inner] = indexesOf(log, 'rec') as [number, number];

    const tree = (await build(outer, [outer, inner]))!;
    // The outer call's 10, not 16.
    expect(tree.rootTotal).toBe(10);

    // Both frames spend time, so both seed the one row, and its total is the
    // outer call's whole cost — the inner call is inside it, not added to it.
    const [bottomUp] = (await tree.bottomUp(options))!;
    expect(bottomUp?.callCount).toBe(2);
    expect(bottomUp?.duration).toEqual({ total: 10, self: 10 });
  });

  it('bottom-up: a recursive frame counts the time it shares with itself once', async () => {
    // rec → work → rec. The outer call's 10 already holds the inner call's 6, so
    // the row reads 10 and not 16, while both calls' self time is its own.
    const log = await load(
      ...chain(),
      method('rec', 2000, 2010, method('work', 2001, 2010, method('rec', 2004, 2010))),
    );

    const rows = (await (await build(frame(log, 'rec')))!.bottomUp(options))!;

    expect(
      rows.map((row) => [row.text, row.duration.total, row.duration.self, row.callCount]),
    ).toEqual([
      ['rec', 10, 7, 2],
      ['work', 9, 3, 1],
    ]);
  });

  it('bottom-up: recursion is the same method, whatever entry the log gave it', async () => {
    // A code unit that calls itself as a method entry: the Call Tree tab treats
    // the two as one method, so the inner call's 6 comes off the outer call's 10
    // here too, leaving 4 + 6 rather than 10 + 6.
    const log = await load(...chain(), unit('rec', 2000, 2010, method('rec', 2004, 2010)));

    const tree = (await build(frame(log, 'rec')))!;
    const rows = (await tree.bottomUp(options))!;

    expect(rows.map((row) => [row.type, row.duration.total, row.duration.self])).toEqual([
      ['METHOD_ENTRY', 6, 6],
      ['CODE_UNIT_STARTED', 4, 4],
    ]);
    // The two rows hold the outer call's time once between them.
    expect(rows.reduce((sum, row) => sum + row.duration.total, 0)).toBe(tree.rootTotal);
  });

  it('a merged row names every occurrence behind it, so all of them can be marked', async () => {
    const { loop, instances } = await loopLog(3);
    // The loop, so its three calls merge into one row inside the scope.
    const tree = (await build(loop))!;

    const [aggregated] = (await tree.aggregated(options))!;
    // The selection names its own one frame; the group beneath it merges all
    // three occurrences.
    expect(aggregated?.eventIndexes).toEqual([loop]);
    expect(aggregated?._children?.[0]?.eventIndexes).toEqual(instances);

    const [bottomUp] = (await tree.bottomUp(options))!;
    expect(bottomUp?.eventIndexes).toEqual(instances);
    // A caller row stands for the calls it conducted, which is what its time and
    // its count are taken from, so it names those rather than its own frame.
    expect(locatableEventIndexes(bottomUp?._children?.[0])).toEqual(instances);
  });

  it('a single-frame row carries no list — its one occurrence is the row itself', async () => {
    const log = await load(...chain());
    const [selected] = (await (await build(frame(log, QUERY)))!.timeOrder(options))!;

    expect(selected?.eventIndexes).toBeNull();
  });

  it('counts every occurrence even when the walk is sliced across frames', async () => {
    const OCCURRENCES = 50;
    const { instances } = await loopLog(OCCURRENCES);
    let yields = 0;
    const sliced: FrameBudgetOptions = {
      yieldSlice: () => {
        yields += 1;
        return Promise.resolve();
      },
    };

    // Every clock read lands past the slice deadline, so each check yields —
    // the totals must come out the same as an unsliced build.
    const clock = jest.spyOn(performance, 'now');
    let time = 0;
    clock.mockImplementation(() => (time += 100));
    try {
      const tree = (await buildScopedCallTree(instances[0]!, instances, sliced))!;
      const [aggregated] = (await tree.aggregated(sliced))!;
      expect(aggregated?.callCount).toBe(OCCURRENCES);
      expect(aggregated?.duration.total).toBe(OCCURRENCES);
    } finally {
      clock.mockRestore();
    }
    expect(yields).toBeGreaterThan(0);
  });

  it('abandons a superseded walk instead of finishing it', async () => {
    const { instances } = await loopLog(500);
    const clock = jest.spyOn(performance, 'now');
    let time = 0;
    clock.mockImplementation(() => (time += 100));
    try {
      // The first yield is the first chance to notice; nothing is returned after it.
      const tree = await buildScopedCallTree(instances[0]!, instances, {
        yieldSlice: () => Promise.resolve(),
        signal: AbortSignal.abort(),
      });
      expect(tree).toBeNull();
    } finally {
      clock.mockRestore();
    }
  });

  it('materialises every child rather than capping the subtree', async () => {
    const kids = Array.from({ length: 5 }, (_, i) => method(`kid${i}`, 3000 + i, 3001 + i));
    const log = await load(...chain(), method('big', 3000, 3005, ...kids));

    const rows = (await (await build(frame(log, 'big')))!.timeOrder(options))!;
    expect(rows[0]!.text).toBe('big');
    // Every child is present — expansion is the renderer's job, not a build-time cap.
    expect(rows[0]!._children!.length).toBe(5);
  });
});

describe('buildWholeLogCallTree', () => {
  it('roots the tree at the log with real durations — nothing scoped or attributed', async () => {
    await load(...chain());
    const tree = (await buildWholeLogCallTree(options))!;
    // The whole log is both the scope and the bar denominator.
    expect(tree.rootTotal).toBe(500);
    expect(tree.logTotal).toBe(500);

    const rows = firstChain((await tree.timeOrder(options))!);
    expect(rows.map((r) => r.text)).toEqual(['exec', 'm1', 'm2', QUERY]);
    // Real durations throughout — the scoped builder would have rewritten these.
    expect(rows[0]?.duration).toEqual({ total: 500, self: 0 });
    expect(rows[3]?.duration).toEqual({ total: 500, self: 500 });
  });

  it('abandons a cancelled build instead of finishing it', async () => {
    await load(...chain());
    const clock = jest.spyOn(performance, 'now');
    let time = 0;
    clock.mockImplementation(() => (time += 100));
    try {
      const tree = await buildWholeLogCallTree({
        yieldSlice: () => Promise.resolve(),
        signal: AbortSignal.abort(),
      });
      expect(tree).toBeNull();
    } finally {
      clock.mockRestore();
    }
  });

  it('leaves out a top-level detail, as the Inspector does for any row', async () => {
    await load(
      line(0, 'USER_INFO|[EXTERNAL]|005Ea00000R6orz|x@y.com|(GMT+00:00)|GMT+00:00'),
      ...chain(),
    );
    const tree = (await buildWholeLogCallTree(options))!;

    expect((await tree.timeOrder(options))!.map((row) => row.type)).toEqual(['CODE_UNIT_STARTED']);
    // The four frames under `exec`; the detail is no call.
    expect(tree.calls).toBe(4);
  });

  it('keeps a profiling block the log left at the top level, outside Bottom-Up', async () => {
    // It follows EXECUTION_FINISHED, so it is a root rather than a descendant.
    await load(...chain(), {
      open: 'CUMULATIVE_PROFILING_BEGIN',
      close: 'CUMULATIVE_PROFILING_END',
      start: 600,
      end: 602,
      children: [],
    });
    const tree = (await buildWholeLogCallTree(options))!;

    expect(types((await tree.timeOrder(options))!)).toContain('CUMULATIVE_PROFILING_BEGIN');
    expect(types((await tree.bottomUp(options))!)).not.toContain('CUMULATIVE_PROFILING_BEGIN');
    // The four frames under `exec`; a block is a row, not a call.
    expect(tree.calls).toBe(4);
  });
});

describe('liveWindow', () => {
  /** Admits every row, as a table filtering its whole tree would, and keeps those
   *  admitted as [text, total, self, calls]. */
  function admitted(
    live: LiveWindow,
    rows: readonly ScopedRow[],
  ): Array<[string, number, number, number]> {
    return rows.flatMap((row) =>
      live.admit(row)
        ? [
            [row.text, row.duration.total, row.duration.self, row.callCount] as [
              string,
              number,
              number,
              number,
            ],
            ...admitted(live, row._children ?? []),
          ]
        : [],
    );
  }

  // outer 0..1000 calls m twice: 100..300 and 600..900.
  const twoCalls = (): Span[] => [
    method('outer', 0, 1_000, method('m', 100, 300), method('m', 600, 900)),
  ];

  it('cuts each Time Order row to the window, and leaves out the rows outside it', async () => {
    await load(...twoCalls());
    const tree = (await buildWholeLogCallTree(options))!;
    const live = tree.liveWindow!();
    const rows = (await tree.timeOrder(options))!;
    await live.prepare(rows, options);

    expect(live.set({ start: 200, end: 500 })).toEqual({
      rootTotal: 300,
      calls: 2,
      self: 300,
      frameSelf: 300,
    });
    expect(admitted(live, rows)).toEqual([
      ['outer', 300, 200, 1],
      ['m', 100, 100, 1],
    ]);
  });

  it('sums the calls an Aggregated row merges, inside the window only', async () => {
    await load(...twoCalls());
    const tree = (await buildWholeLogCallTree(options))!;
    const live = tree.liveWindow!();
    const rows = (await tree.aggregated(options))!;

    live.set({ start: 200, end: 700 });

    expect(admitted(live, rows)).toEqual([
      ['outer', 500, 300, 1],
      ['m', 200, 200, 2],
    ]);
  });

  // a calls itself: the inner call's time is counted once, through the inner call.
  it('counts a recursive frame once in Bottom-Up, inside the window', async () => {
    await load(method('a', 0, 1_000, method('a', 400, 500)));
    const tree = (await buildWholeLogCallTree(options))!;
    const live = tree.liveWindow!();
    const rows = (await tree.bottomUp(options))!;

    live.set({ start: 450, end: 1_000 });

    // All 550 of the window is a's: 500 as the outer call, 50 as the inner,
    // which the outer call is the caller of.
    expect(admitted(live, rows)).toEqual([
      ['a', 550, 550, 2],
      ['a', 50, 0, 1],
    ]);
  });

  it('reads a caller row as a route to its seed, with no time of its own', async () => {
    await load(...twoCalls());
    const tree = (await buildWholeLogCallTree(options))!;
    const live = tree.liveWindow!();
    const rows = (await tree.bottomUp(options))!;

    live.set({ start: 200, end: 700 });

    // In the whole log's ranking: the two tie on self time.
    expect(admitted(live, rows)).toEqual([
      ['m', 200, 200, 2],
      ['outer', 200, 0, 2],
      ['outer', 500, 300, 1],
    ]);
  });

  describe('a row of many calls', () => {
    const manyCalls = (): Span[] => [
      method(
        'outer',
        0,
        1_000,
        ...Array.from({ length: 300 }, (_, i) => method('m', i * 3, i * 3 + 2)),
      ),
    ];

    it('is read at once while the filter pass has time', async () => {
      await load(...manyCalls());
      const tree = (await buildWholeLogCallTree(options))!;
      const live = tree.liveWindow!();
      const hot = (await tree.aggregated(options))![0]!._children![0]!;
      live.set({ start: 0, end: 30 });

      expect(live.admit(hot)).toBe(true);
      expect(hot.callCount).toBe(10);
      expect(live.waiting()).toEqual([]);
    });

    it('is left for prepare once the filter pass has spent its time', async () => {
      await load(...manyCalls());
      const tree = (await buildWholeLogCallTree(options))!;
      const live = tree.liveWindow!();
      const hot = (await tree.aggregated(options))![0]!._children![0]!;
      live.set({ start: 0, end: 30 });
      let clock = 0;
      const now = jest.spyOn(performance, 'now').mockImplementation(() => (clock += 100));
      try {
        expect(live.admit(hot)).toBe(true);
      } finally {
        now.mockRestore();
      }

      expect(hot.callCount).toBe(300);
      expect(live.waiting()).toEqual([hot]);
      expect(live.waiting()).toEqual([]);

      await live.prepare([hot], options);
      expect(live.admit(hot)).toBe(true);
      expect(hot.callCount).toBe(10);
    });
  });

  it('reads the log once for two views reading ahead at the same time', async () => {
    await load(...twoCalls());
    const tree = (await buildWholeLogCallTree(options))!;
    const live = tree.liveWindow!();
    const build = jest.spyOn(CallSpans, 'build');
    try {
      await Promise.all([
        live.prepare((await tree.timeOrder(options))!, options),
        live.prepare((await tree.bottomUp(options))!, options),
      ]);
      expect(build).toHaveBeenCalledTimes(1);
    } finally {
      build.mockRestore();
    }
  });

  it('totals the self time of every row, a limit block included', async () => {
    await load(
      method('outer', 0, 1_000, method('m', 100, 300), limitBlock(650, 700)),
      method('late', 1_200, 1_500),
    );
    const tree = (await buildWholeLogCallTree(options))!;
    const live = tree.liveWindow!();
    const rows = (await tree.timeOrder(options))!;
    await live.prepare(rows, options);
    const everySelf = (type?: string): number => {
      let self = 0;
      const stack = [...rows];
      while (stack.length) {
        const row = stack.pop()!; // non-empty: the loop condition just checked
        const counted = live.admit(row) && row.type !== type;
        self += counted ? row.duration.self : 0;
        stack.push(...(row._children ?? []));
      }
      return self;
    };

    for (const window of [
      null,
      { start: 0, end: 1_500 },
      { start: 200, end: 680 },
      { start: 690, end: 1_300 },
    ]) {
      const { self, frameSelf } = live.set(window);
      expect(self).toBe(everySelf());
      // Bottom-Up has no row for the limit block, so its total leaves the block out.
      expect(frameSelf).toBe(everySelf('CUMULATIVE_LIMIT_USAGE'));
    }
  });

  it('builds Aggregated and Bottom-Up from the whole log after Time Order was read into a window', async () => {
    await load(...twoCalls());
    const fresh = (await buildWholeLogCallTree(options))!;
    const tree = (await buildWholeLogCallTree(options))!;
    const live = tree.liveWindow!();
    const timeOrder = (await tree.timeOrder(options))!;
    await live.prepare(timeOrder, options);
    live.set({ start: 200, end: 250 });
    admitted(live, timeOrder);

    const figures = (rows: readonly ScopedRow[]): unknown[] =>
      rows.map((row) => [row.text, row.duration, row.callCount, figures(row._children ?? [])]);
    expect(figures((await tree.aggregated(options))!)).toEqual(
      figures((await fresh.aggregated(options))!),
    );
    expect(figures((await tree.bottomUp(options))!)).toEqual(
      figures((await fresh.bottomUp(options))!),
    );
  });

  it('takes a recursive frame’s nested calls off once after an abandoned Bottom-Up build', async () => {
    // 200 nested calls of a, so the walk checks the clock more than once.
    let nested = method('a', 200, 800);
    for (let depth = 199; depth >= 0; depth--) {
      nested = method('a', depth, 1_000 - depth, nested);
    }
    await load(nested);
    const window = { start: 100, end: 900 };
    const read = async (abandonFirst: boolean) => {
      const tree = (await buildWholeLogCallTree(options))!;
      if (abandonFirst) {
        const abort = new AbortController();
        let clock = 0;
        const now = jest.spyOn(performance, 'now').mockImplementation(() => (clock += 100));
        let yields = 0;
        const abandoned = await tree.bottomUp({
          signal: abort.signal,
          yieldSlice: () => {
            if (++yields === 2) {
              abort.abort();
            }
            return Promise.resolve();
          },
        });
        now.mockRestore();
        expect(abandoned).toBeNull();
      }
      const live = tree.liveWindow!();
      const rows = (await tree.bottomUp(options))!;
      await live.prepare(rows, options);
      live.set(window);
      return admitted(live, rows.slice(0, 1));
    };

    expect(await read(true)).toEqual(await read(false));
  });

  it.each([
    ['Time Order', 'timeOrder'],
    ['Aggregated', 'aggregated'],
    ['Bottom-Up', 'bottomUp'],
  ] as const)('gives %s its whole-log figures back with no window', async (_name, view) => {
    await load(...twoCalls());
    const tree = (await buildWholeLogCallTree(options))!;
    const rows = (await tree[view](options))!;
    const live = tree.liveWindow!();
    const whole = admitted(live, rows);

    live.set({ start: 200, end: 700 });
    admitted(live, rows);
    expect(live.set(null)).toMatchObject({ rootTotal: tree.rootTotal, calls: tree.calls });

    expect(admitted(live, rows)).toEqual(whole);
    // A window over the whole log reads the same as no window.
    live.set({ start: 0, end: 1_000 });
    expect(admitted(live, rows)).toEqual(whole);
  });
});

describe('view caching', () => {
  it.each([
    ['a scoped tree', async () => build(frame(await load(...chain()), QUERY))],
    [
      'the whole-log tree',
      async () => {
        await load(...chain());
        return buildWholeLogCallTree(options);
      },
    ],
  ])('builds each view of %s only on first read, then caches it', async (_name, make) => {
    const tree = (await make())!;
    // Same array back on a second read — the walk is not repeated.
    expect(await tree.timeOrder(options)).toBe(await tree.timeOrder(options));
    expect(await tree.aggregated(options)).toBe(await tree.aggregated(options));
    expect(await tree.bottomUp(options)).toBe(await tree.bottomUp(options));
  });
});

describe('holds', () => {
  it('stands for the selection, what it called, and the callers above it', async () => {
    const log = await load(...chain());
    const tree = (await build(frame(log, 'm2')))!;

    // m2 is the selection, the query runs inside it, m1 and exec are rows above it.
    expect(tree.holds!(frame(log, 'm2'))).toBe(true);
    expect(tree.holds!(frame(log, QUERY))).toBe(true);
    expect(tree.holds!(frame(log, 'm1'))).toBe(true);
    expect(tree.holds!(frame(log, 'exec'))).toBe(true);
  });

  it('leaves out a frame at the same bucket path elsewhere in the log', async () => {
    // A second call of the same method, which a loop or a trigger makes common:
    // its rows would be named by the same path as the selection's.
    const log = await load(
      unit(
        'exec',
        0,
        700,
        method(
          'm1',
          0,
          700,
          method('m2', 0, 500, query(0, 500)),
          method('m2', 500, 700, query(500, 700)),
        ),
      ),
    );
    const tree = (await build(frame(log, 'm2')))!;

    expect(tree.holds!(frame(log, QUERY, 1))).toBe(false);
  });

  it('stands for every frame where it covers the whole log', async () => {
    await load(...chain());

    expect((await buildWholeLogCallTree(options))!.holds).toBeUndefined();
  });
});

describe('rowIdsByPath', () => {
  it('finds a merged row by the bucket path it stands for, at every depth', async () => {
    const { loop } = await loopLog(3);
    const rows = (await (await build(loop))!.aggregated(options))!;
    const group = rows[0]!;
    const occurrences = group._children![0]!;

    const byPath = rowIdsByPath(rows);

    expect(byPath.get(group._pathId!)).toBe(group.id);
    expect(byPath.get(occurrences._pathId!)).toBe(occurrences.id);
  });

  it('leaves a path no row stands for out of the lookup', async () => {
    const log = await load(...chain());
    const tree = (await build(frame(log, QUERY)))!;

    expect(rowIdsByPath((await tree.timeOrder(options))!).get(99999)).toBeUndefined();
  });
});

describe('frameEventIndexes', () => {
  it("names the callers at the row's own depth, not the calls they conducted", async () => {
    // exec -> m1 -> m2 -> query, so the bottom-up seed is the statement and each
    // row under it is one frame further up the same stack.
    const log = await load(...chain());
    const rows = (await (await build(frame(log, 'exec')))!.bottomUp(options))!;
    const seed = rows[0]!;
    const m2Row = seed._children![0]!;
    const m1Row = m2Row._children![0]!;

    expect(frameEventIndexes(seed)).toEqual([frame(log, QUERY)]);
    expect(frameEventIndexes(m2Row)).toEqual([frame(log, 'm2')]);
    expect(frameEventIndexes(m1Row)).toEqual([frame(log, 'm1')]);
  });

  it('names one caller frame however many calls it made', async () => {
    const { loop, instances } = await loopLog(2);
    const rows = (await (await build(loop))!.bottomUp(options))!;
    const caller = rows[0]!._children![0]!;

    // The row counts both calls, and is the single frame that made them.
    expect(locatableEventIndexes(caller)).toEqual(instances);
    expect(frameEventIndexes(caller)).toEqual([loop]);
  });

  it('names the one frame of a row that merges nothing', () => {
    const row: Partial<ScopedRow> = { id: 1, eventIndex: 7 };

    expect(frameEventIndexes(row)).toEqual([7]);
  });
});

describe('revealableEventIndex', () => {
  const row = (id: number, eventIndex: number): Partial<ScopedRow> => ({ id, eventIndex });

  it.each([
    ['a real row by its own event', row(3, 17), 17],
    ['nothing for a merged row, whose id is synthetic and negative', row(-1, 17), null],
    ['nothing when there is no row', undefined, null],
  ])('reveals %s', (_name, given, expected) => {
    expect(revealableEventIndex(given)).toBe(expected);
  });
});

describe('bottom-up occurrences', () => {
  it('derives a caller row from the top-level row, holding no calls itself', async () => {
    // The loop and its two calls; the loop itself is the selection.
    const { loop, instances } = await loopLog(2);
    const rows = (await (await build(loop))!.bottomUp(options))!;
    const seed = rows[0]!;
    const caller = seed._children![0]!;

    // The top-level row owns the occurrences; the caller row stands for the same
    // calls, and reads them back through the chain that reached them.
    expect(seed.eventIndexes).toEqual(instances);
    expect(caller.eventIndexes).toBeNull();
    expect(locatableEventIndexes(caller)).toEqual(instances);
  });

  /** The chain, with a limit block under m2 holding its limit line. */
  const withLimits = (): Span[] => [
    unit(
      'exec',
      0,
      500,
      method('m1', 0, 500, method('m2', 0, 500, query(0, 497), limitBlock(497, 500))),
    ),
  ];

  it('keeps the limit blocks in the top-down views and out of Bottom-Up', async () => {
    const log = await load(...withLimits());
    const tree = (await build(frame(log, 'm2')))!;
    for (const rows of [(await tree.timeOrder(options))!, (await tree.aggregated(options))!]) {
      expect(types(rows)).toContain('CUMULATIVE_LIMIT_USAGE');
      expect(types(rows)).toContain('LIMIT_USAGE_FOR_NS');
    }
    const bottomUp = types((await tree.bottomUp(options))!);
    expect(bottomUp).not.toContain('CUMULATIVE_LIMIT_USAGE');
    expect(bottomUp).not.toContain('LIMIT_USAGE_FOR_NS');
    // A limit block is a row, not a call.
    expect(tree.calls).toBe(2);
  });

  it('still answers for a limit block the user selected', async () => {
    const log = await load(...withLimits());
    const rows = (await (await build(ofType(log, 'CUMULATIVE_LIMIT_USAGE')))!.bottomUp(options))!;

    // The selection is kept whatever it is; only the limit line under it goes.
    expect(rows.map((r) => r.type)).toEqual(['CUMULATIVE_LIMIT_USAGE']);
    expect(rows[0]?._children).toBeNull();
  });
});
