/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';

interface FakeEvent {
  eventIndex: number;
  type: string;
  text: string;
  namespace: string;
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
  return { eventIndex, type, text, namespace: '', duration, parent: null, children: [] };
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
jest.mock('../../core/log/LogStore.js', () => ({
  currentLogStore: () => ({
    log: root,
    eventByIndex: (i: number) => byId.get(i) ?? null,
  }),
}));

import {
  buildScopedCallTree,
  buildWholeLogCallTree,
  rowIdsByEvent,
  type ScopedRow,
} from '../scopedCallTree.js';
import type { FrameBudgetOptions } from '../../core/utility/FrameBudget.js';

/** These fixtures are small enough to never hit a slice deadline, so `yieldFrame`
 *  is only there to satisfy the contract. */
const options: FrameBudgetOptions = { yieldFrame: () => Promise.resolve() };

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

  it('time-order: the selection roots the tree, its callers left out', async () => {
    selectedIndex = 3;
    const tree = (await build(selectedIndex))!;
    expect(tree.rootTotal).toBe(500);

    // m2 down, not exec → m1 → m2 down.
    const chain: ScopedRow[] = [];
    let node: ScopedRow | undefined = (await tree.timeOrder(options))![0];
    while (node) {
      chain.push(node);
      node = node._children?.[0];
    }
    expect(chain.map((r) => r.text)).toEqual(['m2', 'SELECT Id FROM Account']);
    // Every duration is the frame's own — nothing is attributed to a caller.
    expect(chain[0]?.duration).toEqual({ total: 500, self: 0 });
    expect(chain[1]?.duration).toEqual({ total: 200, self: 200 });
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
    // So the statement heads the view and m2 reads as its caller.
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

    // m2 and the statement it holds.
    expect(tree.calls).toBe(2);
    expect(calls((await tree.timeOrder(options))!)).toBe(tree.calls);
    expect(calls((await tree.aggregated(options))!)).toBe(tree.calls);
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
    expect(texts).toEqual(['m2', 'SELECT Id FROM Account']);
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
    const [aggregated] = (await tree.aggregated(options))!;
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
    // The caller stands for its own one frame, met once per occurrence beneath it.
    expect(bottomUp?._children?.[0]?.eventIndexes).toEqual([300]);
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
      yieldFrame: () => {
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
        yieldFrame: () => Promise.resolve(),
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
        yieldFrame: () => Promise.resolve(),
        signal: AbortSignal.abort(),
      });
      expect(tree).toBeNull();
    } finally {
      clock.mockRestore();
    }
  });
});

describe('rowIdsByEvent', () => {
  it('finds the merged rows a frame is named by, at every depth', async () => {
    const instances = loopOccurrences(3);
    const tree = (await build(300))!;
    const rows = (await tree.aggregated(options))!;

    const byEvent = rowIdsByEvent(rows);
    const groupId = rows[0]!.id;
    const occurrenceId = rows[0]!._children![0]!.id;

    // The selection names the row above; each occurrence names the group that
    // merges all three.
    expect(byEvent.get(300)).toEqual([groupId]);
    for (const eventIndex of instances) {
      expect(byEvent.get(eventIndex)).toEqual([occurrenceId]);
    }
  });

  it('names one frame in as many rows as stand for it', async () => {
    // Rebuilds the loop and its two calls; the loop itself is the selection.
    loopOccurrences(2);
    const tree = (await build(300))!;
    const rows = (await tree.bottomUp(options))!;

    // Bottom-Up puts the caller under the leaf it called, so frame 300 is named
    // by that nested row as well as by any row of its own.
    const callerRows = rowIdsByEvent(rows).get(300) ?? [];
    expect(callerRows).toEqual(expect.arrayContaining([rows[0]!._children![0]!.id]));
  });

  it('leaves a frame no row names out of the lookup', async () => {
    const tree = (await build(4))!;

    expect(rowIdsByEvent((await tree.timeOrder(options))!).get(999)).toBeUndefined();
  });
});
