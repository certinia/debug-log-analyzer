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
jest.mock('../../features/database/services/Database.js', () => ({
  DatabaseAccess: {
    instance: () => ({
      getApexLog: () => root,
      getEventByIndex: (i: number) => byId.get(i) ?? null,
    }),
  },
}));

import { buildScopedCallTree, type ScopedRow } from '../scopedCallTree.js';

describe('buildScopedCallTree', () => {
  it('returns null when nothing is selected', () => {
    expect(buildScopedCallTree(-1)).toBeNull();
  });

  it('time-order: ancestors attributed to the selection, leaf keeps its real duration', () => {
    selectedIndex = 4;
    const tree = buildScopedCallTree(selectedIndex)!;
    expect(tree.rootTotal).toBe(200);

    // Single chain root→leaf: exec → m1 → m2 → soql.
    const chain: ScopedRow[] = [];
    let node: ScopedRow | undefined = tree.timeOrder[0];
    while (node) {
      chain.push(node);
      node = node._children?.[0];
    }
    expect(chain.map((r) => r.text)).toEqual(['exec', 'm1', 'm2', 'SELECT Id FROM Account']);
    // Ancestors: total = selection total, self 0.
    for (const ancestor of chain.slice(0, 3)) {
      expect(ancestor.duration).toEqual({ total: 200, self: 0 });
    }
    // The selected leaf keeps its real duration.
    expect(chain[3]?.duration).toEqual({ total: 200, self: 200 });
  });

  it('bottom-up: the selected leaf is the top row with callers nested in reverse', () => {
    const tree = buildScopedCallTree(4)!;
    expect(tree.bottomUp.map((r) => r.text)).toEqual(['SELECT Id FROM Account']);
    const top = tree.bottomUp[0]!;
    expect(top.duration.self).toBe(200);

    // Callers unwind back up to the root: soql → m2 → m1 → exec.
    const callers: string[] = [];
    let node: ScopedRow | undefined = top._children?.[0];
    while (node) {
      callers.push(node.text);
      node = node._children?.[0];
    }
    expect(callers).toEqual(['m2', 'm1', 'exec']);
  });

  it('bottom-up: every caller counts the call it contributed, never zero', () => {
    const tree = buildScopedCallTree(4)!;
    const counts: number[] = [];
    let node: ScopedRow | undefined = tree.bottomUp[0];
    while (node) {
      counts.push(node.callCount);
      node = node._children?.[0];
    }
    // soql + its three callers, each crediting the one call.
    expect(counts).toEqual([1, 1, 1, 1]);
  });

  it('marks zero-duration bookkeeping rows as details, keeping those with timed descendants', () => {
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

    const tree = buildScopedCallTree(scope.eventIndex)!;
    const selected = tree.timeOrder[0]!;
    const [heapRow, statementRow] = selected._children!;
    // The selection always shows; a bare heap allocation does not.
    expect(selected._hasDetailsDeep).toBe(true);
    expect(heapRow!._hasDetailsDeep).toBe(false);
    // Zero duration itself, but it is the only way to reach `timed`.
    expect(statementRow!._hasDetailsDeep).toBe(true);
    expect(statementRow!._children![0]!._hasDetailsDeep).toBe(true);
  });

  it('aggregated: linear path stays one node per frame', () => {
    const tree = buildScopedCallTree(4)!;
    const texts: string[] = [];
    let node: ScopedRow | undefined = tree.aggregated[0];
    while (node) {
      texts.push(node.text);
      expect(node.callCount).toBe(1);
      node = node._children?.[0];
    }
    expect(texts).toEqual(['exec', 'm1', 'm2', 'SELECT Id FROM Account']);
  });

  it('reports untruncated for a small subtree', () => {
    expect(buildScopedCallTree(4)!.truncated).toBe(false);
  });

  it('builds each view only on first read, then caches it', () => {
    const tree = buildScopedCallTree(4)!;
    // Same object back on a second read — the walk is not repeated.
    expect(tree.aggregated).toBe(tree.aggregated);
    expect(tree.bottomUp).toBe(tree.bottomUp);
    expect(tree.timeOrder).toBe(tree.timeOrder);
  });

  it('truncates a subtree that exceeds the node budget instead of materialising it', () => {
    // A wide leaf-heavy subtree well past the 20k budget.
    const big = ev(100, 'METHOD_ENTRY', 'big', { total: 100, self: 0 });
    big.parent = root;
    big.children = Array.from({ length: 25_000 }, (_unused, i) =>
      ev(1_000 + i, 'METHOD_ENTRY', `kid${i}`, { total: 0, self: 0 }),
    );
    for (const kid of big.children) {
      kid.parent = big;
    }
    byId.set(big.eventIndex, big);

    const tree = buildScopedCallTree(big.eventIndex)!;
    expect(tree.truncated).toBe(true);
    // The node itself is kept (its totals are intact) but descent stopped early.
    expect(tree.timeOrder[0]!.text).toBe('big');
    expect(tree.timeOrder[0]!._children!.length).toBeLessThan(25_000);
  });
});
