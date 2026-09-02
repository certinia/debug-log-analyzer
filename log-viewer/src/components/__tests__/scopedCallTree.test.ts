/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { beforeEach, describe, expect, it } from '@jest/globals';

interface FakeEvent {
  eventIndex: number;
  type: string;
  text: string;
  namespace: string;
  isParent: boolean;
  duration: { total: number; self: number };
  parent: FakeEvent | null;
  children: FakeEvent[];
}

function ev(
  eventIndex: number,
  type: string,
  text: string,
  duration: { total: number; self: number },
): FakeEvent {
  return {
    eventIndex,
    type,
    text,
    namespace: '',
    // The parser only descends into parent lines, so every ancestor is one.
    isParent: true,
    duration,
    parent: null,
    children: [],
  };
}

// exec → m1 → m2 → soql (200ms leaf), no branches.
const root = ev(0, 'ROOT', 'root', { total: 500, self: 0 });
const exec = ev(1, 'CODE_UNIT_STARTED', 'exec', { total: 500, self: 0 });
const m1 = ev(2, 'METHOD_ENTRY', 'm1', { total: 500, self: 0 });
const m2 = ev(3, 'METHOD_ENTRY', 'm2', { total: 500, self: 0 });
const soql = ev(4, 'SOQL_EXECUTE_BEGIN', 'SELECT Id FROM Account', { total: 200, self: 200 });
root.children = [exec];
exec.parent = root;
exec.children = [m1];
m1.parent = exec;
m1.children = [m2];
m2.parent = m1;
m2.children = [soql];
soql.parent = m2;

const byId = new Map<number, FakeEvent>([exec, m1, m2, soql].map((e) => [e.eventIndex, e]));

let selectedIndex = 4;
const { KeyPathIds } = jest.requireActual<typeof import('../../core/log/keyPathIds.js')>(
  '../../core/log/keyPathIds.js',
);
// One table per log in production. The fixtures below reuse event indexes for
// different frames, so each test gets its own rather than one frame's key being
// read back for another.
let paths = new KeyPathIds(1024);
const { LogStore } = jest.requireActual<typeof import('../../core/log/LogStore.js')>(
  '../../core/log/LogStore.js',
);
jest.mock('../../core/log/LogStore.js', () => ({
  currentLogStore: () => {
    const store = {
      log: root,
      keyPathIds: () => paths,
      eventByIndex: (i: number) => byId.get(i) ?? null,
      // Mirrors LogStore.stackByEventIndex over the fixture's own index.
      stackByEventIndex: (i: number) => {
        const stack: FakeEvent[] = [];
        for (let node = byId.get(i) ?? null; node && node !== root; node = node.parent) {
          if (node.isParent) {
            stack.push(node);
          }
        }
        return stack.reverse();
      },
    };
    // The real climb, so what it answers about the fixture is under test rather
    // than a second copy of it. It reads only `eventByIndex`.
    return { ...store, framesAbove: LogStore.prototype.framesAbove.bind(store) };
  },
}));

import {
  buildScopedCallTree,
  buildWholeLogCallTree,
  frameEventIndexes,
  locatableEventIndexes,
  rowIdsByPath,
  type ScopedRow,
} from '../scopedCallTree.js';
import type { FrameBudgetOptions } from '../../core/utility/FrameBudget.js';

/** These fixtures are small enough to never hit a slice deadline, so `yieldSlice`
 *  is only there to satisfy the contract. */
const options: FrameBudgetOptions = { yieldSlice: () => Promise.resolve() };

beforeEach(() => {
  paths = new KeyPathIds(1024);
});

function build(eventIndex: number, instances?: number[]) {
  return buildScopedCallTree(eventIndex, instances ?? null, options);
}

/** A statement called from a loop: `count` occurrences of the same frame, each
 *  with its own small subtree. Returns their eventIndexes. */
function loopOccurrences(count: number): number[] {
  const loop = ev(300, 'METHOD_ENTRY', 'loop', { total: count, self: 0 });
  loop.parent = root;
  byId.set(loop.eventIndex, loop);

  const instances: number[] = [];
  let nextId = 301;
  for (let i = 0; i < count; i++) {
    const call = ev(nextId++, 'SOQL_EXECUTE_BEGIN', 'SELECT Id FROM Account', {
      total: 1,
      self: 1,
    });
    call.parent = loop;
    loop.children.push(call);
    byId.set(call.eventIndex, call);
    instances.push(call.eventIndex);
  }
  return instances;
}

describe('buildScopedCallTree', () => {
  it('returns null when nothing is selected', async () => {
    expect(await build(-1)).toBeNull();
  });

  it('time-order: the selection sits under its callers, rooted at the log', async () => {
    selectedIndex = 3;
    const tree = (await build(selectedIndex))!;
    expect(tree.rootTotal).toBe(500);

    const chain: ScopedRow[] = [];
    let node: ScopedRow | undefined = (await tree.timeOrder(options))![0];
    while (node) {
      chain.push(node);
      node = node._children?.[0];
    }
    expect(chain.map((r) => r.text)).toEqual(['exec', 'm1', 'm2', 'SELECT Id FROM Account']);
    // A caller holds the time that reached the selection through it, and none of
    // it is its own work, so the tree reads 100% from the top down to m2.
    expect(chain[0]?.duration).toEqual({ total: 500, self: 0 });
    expect(chain[1]?.duration).toEqual({ total: 500, self: 0 });
    // The selection and what ran inside it keep their real durations.
    expect(chain[2]?.duration).toEqual({ total: 500, self: 0 });
    expect(chain[3]?.duration).toEqual({ total: 200, self: 200 });
    // The path opens itself, so the selection is on screen; its subtree does not.
    expect(chain.map((r) => r.onPath)).toEqual([true, true, undefined, undefined]);
  });

  it('bottom-up: a selected leaf is the whole view, with nothing above it', async () => {
    const tree = (await build(4))!;
    const rows = (await tree.bottomUp(options))!;

    expect(rows.map((r) => r.text)).toEqual(['SELECT Id FROM Account']);
    expect(rows[0]?.duration.self).toBe(200);
    // Its real callers are outside the scope, so the row stands alone.
    expect(rows[0]?._children).toBeNull();
  });

  it('bottom-up: the hottest frame inside the selection heads the view', async () => {
    // m2 spends none of its time itself; the statement it holds spends all of it.
    // So the statement heads the view and m2 reads as its caller. exec and m1 lead
    // to the selection but ran nothing inside it, so bottom-up leaves them out.
    const tree = (await build(3))!;
    const rows = (await tree.bottomUp(options))!;

    expect(rows.map((row) => row.text)).toEqual(['SELECT Id FROM Account']);
    expect(rows[0]?.duration).toEqual({ total: 200, self: 200 });
    expect(rows[0]?._children?.map((row) => row.text)).toEqual(['m2']);
  });

  it('bottom-up: every caller counts the call it contributed, never zero', async () => {
    const tree = (await build(3))!;
    const counts: number[] = [];
    let node: ScopedRow | undefined = (await tree.bottomUp(options))![0];
    while (node) {
      counts.push(node.callCount);
      node = node._children?.[0];
    }
    // The statement plus m2, its caller inside the scope, each crediting the one call.
    expect(counts).toEqual([1, 1]);
  });

  it('drops zero-duration bookkeeping rows, keeping those with timed descendants', async () => {
    const scope = ev(200, 'METHOD_ENTRY', 'scope', { total: 50, self: 0 });
    const heap = ev(201, 'HEAP_ALLOCATE', 'Bytes:8', { total: 0, self: 0 });
    const statement = ev(202, 'STATEMENT_EXECUTE', '[12]', { total: 0, self: 0 });
    const timed = ev(203, 'METHOD_ENTRY', 'timed', { total: 50, self: 50 });
    scope.parent = root;
    scope.children = [heap, statement];
    heap.parent = scope;
    statement.parent = scope;
    statement.children = [timed];
    timed.parent = statement;
    byId.set(scope.eventIndex, scope);

    const tree = (await build(scope.eventIndex))!;
    const selected = (await tree.timeOrder(options))![0]!;
    // The bare heap allocation is gone; the statement stays because it is the
    // only way to reach `timed`.
    expect(selected._children!.map((row) => row.text)).toEqual(['[12]']);
    expect(selected._children![0]!._children!.map((row) => row.text)).toEqual(['timed']);
    // The dropped row is not counted either, so the Calls total matches the rows.
    expect(tree.calls).toBe(3);
  });

  it('counts every call the scope holds, so each view totals the same', async () => {
    const tree = (await build(3))!;
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
    // Bottom-Up heads a row with a frame that spends time, and m2 spends none, so
    // its own rows fall short of the scope. Hence the total comes from the scope.
    expect((await tree.bottomUp(options))!.reduce((sum, row) => sum + row.callCount, 0)).toBe(1);
  });

  it('keeps the selection itself even when it has no duration', async () => {
    const scope = ev(210, 'VARIABLE_SCOPE_BEGIN', 'scope', { total: 0, self: 0 });
    scope.parent = root;
    byId.set(scope.eventIndex, scope);

    const tree = (await build(scope.eventIndex))!;
    expect((await tree.timeOrder(options))!.map((row) => row.text)).toEqual(['scope']);
  });

  it('aggregated: linear path stays one node per frame', async () => {
    const tree = (await build(3))!;
    const texts: string[] = [];
    let node: ScopedRow | undefined = (await tree.aggregated(options))![0];
    while (node) {
      texts.push(node.text);
      expect(node.callCount).toBe(1);
      node = node._children?.[0];
    }
    expect(texts).toEqual(['exec', 'm1', 'm2', 'SELECT Id FROM Account']);
  });

  it('merges one caller for every occurrence it made', async () => {
    const instances = loopOccurrences(4);
    const tree = (await build(instances[0]!, instances))!;

    const roots = (await tree.timeOrder(options))!;
    expect(roots.map((r) => r.text)).toEqual(['loop']);
    // One row for the caller, holding all four calls and the time they took.
    expect(roots[0]?.callCount).toBe(4);
    expect(roots[0]?.duration).toEqual({ total: 4, self: 0 });
    expect(tree.rootTotal).toBe(4);
  });

  it('builds each view only on first read, then caches it', async () => {
    const tree = (await build(4))!;
    // Same array back on a second read — the walk is not repeated.
    expect(await tree.aggregated(options)).toBe(await tree.aggregated(options));
    expect(await tree.bottomUp(options)).toBe(await tree.bottomUp(options));
    expect(await tree.timeOrder(options)).toBe(await tree.timeOrder(options));
  });

  it('a wide aggregate merges every occurrence, uncapped', async () => {
    // The "occurrences × subtree" shape a NODE_BUDGET cap used to bound (see PR
    // #877's removal note). No cap exists any more, so every occurrence must
    // still be represented.
    const OCCURRENCES = 500;
    const instances = loopOccurrences(OCCURRENCES);

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
    const outer = ev(400, 'METHOD_ENTRY', 'rec', { total: 10, self: 4 });
    const inner = ev(401, 'METHOD_ENTRY', 'rec', { total: 6, self: 6 });
    outer.parent = root;
    outer.children = [inner];
    inner.parent = outer;
    byId.set(outer.eventIndex, outer);
    byId.set(inner.eventIndex, inner);

    const tree = (await build(outer.eventIndex, [outer.eventIndex, inner.eventIndex]))!;
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
    const outer = ev(500, 'METHOD_ENTRY', 'rec', { total: 10, self: 1 });
    const work = ev(501, 'METHOD_ENTRY', 'work', { total: 9, self: 3 });
    const inner = ev(502, 'METHOD_ENTRY', 'rec', { total: 6, self: 6 });
    outer.parent = root;
    outer.children = [work];
    work.parent = outer;
    work.children = [inner];
    inner.parent = work;
    byId.set(outer.eventIndex, outer);

    const rows = (await (await build(outer.eventIndex))!.bottomUp(options))!;

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
    const outer = ev(510, 'CODE_UNIT_STARTED', 'rec', { total: 10, self: 1 });
    const inner = ev(511, 'METHOD_ENTRY', 'rec', { total: 6, self: 6 });
    outer.parent = root;
    outer.children = [inner];
    inner.parent = outer;
    byId.set(outer.eventIndex, outer);

    const tree = (await build(outer.eventIndex))!;
    const rows = (await tree.bottomUp(options))!;

    expect(rows.map((row) => [row.type, row.duration.total, row.duration.self])).toEqual([
      ['METHOD_ENTRY', 6, 6],
      ['CODE_UNIT_STARTED', 4, 1],
    ]);
    // The two rows hold the outer call's time once between them.
    expect(rows.reduce((sum, row) => sum + row.duration.total, 0)).toBe(tree.rootTotal);
  });

  it('a merged row names every occurrence behind it, so all of them can be marked', async () => {
    const instances = loopOccurrences(3);
    // The loop, so its three calls merge into one row inside the scope.
    const tree = (await build(300))!;

    const [aggregated] = (await tree.aggregated(options))!;
    // The selection names its own one frame; the group beneath it merges all
    // three occurrences.
    expect(aggregated?.eventIndexes).toEqual([300]);
    expect(aggregated?._children?.[0]?.eventIndexes).toEqual(instances);

    const [bottomUp] = (await tree.bottomUp(options))!;
    expect(bottomUp?.eventIndexes).toEqual(instances);
    // A caller row stands for the calls it conducted, which is what its time and
    // its count are taken from, so it names those rather than its own frame.
    expect(locatableEventIndexes(bottomUp?._children?.[0])).toEqual(instances);
  });

  it('a single-frame row carries no list — its one occurrence is the row itself', async () => {
    const tree = (await build(4))!;
    const [selected] = (await tree.timeOrder(options))!;
    expect(selected?.eventIndexes).toBeNull();
  });

  it('counts every occurrence even when the walk is sliced across frames', async () => {
    const OCCURRENCES = 500;
    const instances = loopOccurrences(OCCURRENCES);
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
    const instances = loopOccurrences(500);
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
    const big = ev(100, 'METHOD_ENTRY', 'big', { total: 100, self: 0 });
    big.parent = root;
    big.children = Array.from({ length: 5 }, (_unused, i) =>
      ev(1_000 + i, 'METHOD_ENTRY', `kid${i}`, { total: 1, self: 1 }),
    );
    for (const kid of big.children) {
      kid.parent = big;
    }
    byId.set(big.eventIndex, big);

    const tree = (await build(big.eventIndex))!;
    const rows = (await tree.timeOrder(options))!;
    expect(rows[0]!.text).toBe('big');
    // Every child is present — expansion is the renderer's job, not a build-time cap.
    expect(rows[0]!._children!.length).toBe(5);
  });
});

describe('buildWholeLogCallTree', () => {
  it('roots the tree at the log with real durations — nothing scoped or attributed', async () => {
    const tree = (await buildWholeLogCallTree(options))!;
    // The whole log is both the scope and the bar denominator.
    expect(tree.rootTotal).toBe(500);
    expect(tree.logTotal).toBe(500);

    const chain: ScopedRow[] = [];
    let node: ScopedRow | undefined = (await tree.timeOrder(options))![0];
    while (node) {
      chain.push(node);
      node = node._children?.[0];
    }
    expect(chain.map((r) => r.text)).toEqual(['exec', 'm1', 'm2', 'SELECT Id FROM Account']);
    // Real durations throughout — the scoped builder would have rewritten these.
    expect(chain[0]?.duration).toEqual({ total: 500, self: 0 });
    expect(chain[3]?.duration).toEqual({ total: 200, self: 200 });
  });

  it('builds each view only on first read, then caches it', async () => {
    const tree = (await buildWholeLogCallTree(options))!;
    expect(await tree.timeOrder(options)).toBe(await tree.timeOrder(options));
    expect(await tree.aggregated(options)).toBe(await tree.aggregated(options));
    expect(await tree.bottomUp(options)).toBe(await tree.bottomUp(options));
  });

  it('abandons a cancelled build instead of finishing it', async () => {
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
});

describe('holds', () => {
  it('stands for the selection, what it called, and the callers above it', async () => {
    const tree = (await build(3))!;

    // m2 is the selection, soql runs inside it, m1 and exec are rows above it.
    expect(tree.holds!(3)).toBe(true);
    expect(tree.holds!(4)).toBe(true);
    expect(tree.holds!(2)).toBe(true);
    expect(tree.holds!(1)).toBe(true);
  });

  it('leaves out a frame at the same bucket path elsewhere in the log', async () => {
    // A second call of the same method, which a loop or a trigger makes common:
    // its rows would be named by the same path as the selection's.
    const twin = ev(500, 'METHOD_ENTRY', 'm2', { total: 200, self: 0 });
    const twinLeaf = ev(501, 'SOQL_EXECUTE_BEGIN', 'SELECT Id FROM Account', {
      total: 200,
      self: 200,
    });
    twin.parent = m1;
    twinLeaf.parent = twin;
    twin.children = [twinLeaf];
    m1.children = [m2, twin];
    byId.set(500, twin);
    byId.set(501, twinLeaf);
    try {
      const tree = (await build(3))!;

      expect(tree.holds!(501)).toBe(false);
    } finally {
      m1.children = [m2];
      byId.delete(500);
      byId.delete(501);
    }
  });

  it('stands for every frame where it covers the whole log', async () => {
    expect((await buildWholeLogCallTree(options))!.holds).toBeUndefined();
  });
});

describe('rowIdsByPath', () => {
  it('finds a merged row by the bucket path it stands for, at every depth', async () => {
    loopOccurrences(3);
    const tree = (await build(300))!;
    const rows = (await tree.aggregated(options))!;
    const group = rows[0]!;
    const occurrences = group._children![0]!;

    const byPath = rowIdsByPath(rows);

    expect(byPath.get(group._pathId!)).toBe(group.id);
    expect(byPath.get(occurrences._pathId!)).toBe(occurrences.id);
  });

  it('leaves a path no row stands for out of the lookup', async () => {
    const tree = (await build(4))!;

    expect(rowIdsByPath((await tree.timeOrder(options))!).get(99999)).toBeUndefined();
  });
});

describe('frameEventIndexes', () => {
  it("names the callers at the row's own depth, not the calls they conducted", async () => {
    // exec -> m1 -> m2 -> soql, so the bottom-up seed is the statement and each
    // row under it is one frame further up the same stack.
    const rows = (await (await build(1))!.bottomUp(options))!;
    const seed = rows[0]!;
    const m2Row = seed._children![0]!;
    const m1Row = m2Row._children![0]!;

    expect(frameEventIndexes(seed)).toEqual([soql.eventIndex]);
    expect(frameEventIndexes(m2Row)).toEqual([m2.eventIndex]);
    expect(frameEventIndexes(m1Row)).toEqual([m1.eventIndex]);
  });

  it('names one caller frame however many calls it made', async () => {
    const instances = loopOccurrences(2);
    const rows = (await (await build(300))!.bottomUp(options))!;
    const caller = rows[0]!._children![0]!;

    // The row counts both calls, and is the single frame that made them.
    expect(locatableEventIndexes(caller)).toEqual(instances);
    expect(frameEventIndexes(caller)).toEqual([300]);
  });

  it('names the one frame of a row that merges nothing', () => {
    const row = { id: 1, originalData: soql } as unknown as Partial<ScopedRow>;

    expect(frameEventIndexes(row)).toEqual([soql.eventIndex]);
  });
});

describe('bottom-up occurrences', () => {
  it('derives a caller row from the top-level row, holding no calls itself', async () => {
    // Rebuilds the loop and its two calls; the loop itself is the selection.
    const instances = loopOccurrences(2);
    const tree = (await build(300))!;
    const rows = (await tree.bottomUp(options))!;
    const seed = rows[0]!;
    const caller = seed._children![0]!;

    // The top-level row owns the occurrences; the caller row stands for the same
    // calls, and reads them back through the chain that reached them.
    expect(seed.eventIndexes).toEqual(instances);
    expect(caller.eventIndexes).toBeNull();
    expect(locatableEventIndexes(caller)).toEqual(instances);
  });
});
