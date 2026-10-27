/**
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it, jest } from '@jest/globals';

import {
  frameLines,
  indexOf,
  rawStoreOf,
  storeOf,
  type FrameSpec,
  type LineSpec,
} from '#test-helpers/apexLog.js';
import type { LogStore } from '#core/log/LogStore.js';
import { outermostIds } from '#core/utility/EventTree.js';
import {
  buildAggregatedTree,
  buildBottomUpTree,
  toAggregatedCallTree,
  toBottomUpTree,
  type AggregatedRow,
  type BottomUpRow,
} from '../Aggregation.js';
import { reportedUsage } from '../reportedUsage.js';

type Spec = FrameSpec | LineSpec;

/** A method that spends `self` ns before its children. */
const m = (text: string, self: number, ...children: Spec[]): FrameSpec => ({
  text,
  self,
  children,
});
/** A code unit that spends `self` ns before its children. */
const cu = (text: string, self: number, ...children: Spec[]): FrameSpec => ({
  text,
  self,
  type: 'CODE_UNIT_STARTED',
  children,
});
const dml = (rows = 1): LineSpec => ({ kind: 'dml', rows });
const soql = (rows = 1): LineSpec => ({ kind: 'soql', rows });
const sosl = (rows = 1): LineSpec => ({ kind: 'sosl', rows });
const thrown: LineSpec = { kind: 'thrown' };
const limits: LineSpec = { kind: 'limits' };

const DML_TEXT = 'DML Op:Insert Type:Account';
const SOSL_TEXT = 'SOSL: FIND {x}';

/** `specs` as the whole log, parsed. */
async function parsed(...specs: Spec[]): Promise<LogStore> {
  return (await rawStoreOf(frameLines(specs))).store;
}

async function bottomUpOf(...specs: Spec[]): Promise<BottomUpRow[]> {
  const store = await parsed(...specs);
  return toBottomUpTree(await store.logIndex(), store);
}

async function aggregatedOf(...specs: Spec[]): Promise<AggregatedRow[]> {
  const store = await parsed(...specs);
  return toAggregatedCallTree(await store.logIndex(), store);
}

function findRowByText<T extends { text: string }>(rows: T[], text: string): T {
  const row = rows.find((candidate) => candidate.text === text);
  if (!row) {
    throw new Error(`Unable to find row for ${text}`);
  }
  return row;
}

function assertTotalIsAtLeastSelf(
  rows: Array<{ totalTime: number; totalSelfTime: number; _children?: unknown }>,
): void {
  for (const row of rows) {
    expect(row.totalTime).toBeGreaterThanOrEqual(row.totalSelfTime);
    if (Array.isArray(row._children)) {
      assertTotalIsAtLeastSelf(
        row._children as Array<{ totalTime: number; totalSelfTime: number; _children: unknown }>,
      );
    }
  }
}

type PartitionRow = {
  text: string;
  totalTime: number;
  totalSelfTime: number;
  dmlCount: { self: number; total: number };
  soqlCount: { self: number; total: number };
  dmlRowCount: { self: number; total: number };
  soqlRowCount: { self: number; total: number };
  _children?: PartitionRow[] | null;
};

function walkRows(rows: PartitionRow[], visit: (row: PartitionRow) => void): void {
  for (const row of rows) {
    visit(row);
    if (row._children && row._children.length > 0) {
      walkRows(row._children, visit);
    }
  }
}

function assertPartitionInvariant(rows: PartitionRow[]): void {
  for (const row of rows) {
    if (!row._children || row._children.length === 0) {
      continue;
    }
    const totals = row._children.reduce(
      (acc, child) => ({
        totalTime: acc.totalTime + child.totalTime,
        totalSelfTime: acc.totalSelfTime + child.totalSelfTime,
        dmlSelf: acc.dmlSelf + child.dmlCount.self,
        dmlTotal: acc.dmlTotal + child.dmlCount.total,
        soqlSelf: acc.soqlSelf + child.soqlCount.self,
        soqlTotal: acc.soqlTotal + child.soqlCount.total,
        dmlRowSelf: acc.dmlRowSelf + child.dmlRowCount.self,
        dmlRowTotal: acc.dmlRowTotal + child.dmlRowCount.total,
        soqlRowSelf: acc.soqlRowSelf + child.soqlRowCount.self,
        soqlRowTotal: acc.soqlRowTotal + child.soqlRowCount.total,
      }),
      {
        totalTime: 0,
        totalSelfTime: 0,
        dmlSelf: 0,
        dmlTotal: 0,
        soqlSelf: 0,
        soqlTotal: 0,
        dmlRowSelf: 0,
        dmlRowTotal: 0,
        soqlRowSelf: 0,
        soqlRowTotal: 0,
      },
    );
    expect(totals.totalTime).toBeCloseTo(row.totalTime, 6);
    expect(totals.totalSelfTime).toBeCloseTo(row.totalSelfTime, 6);
    expect(totals.dmlSelf).toBeCloseTo(row.dmlCount.self, 6);
    expect(totals.dmlTotal).toBeCloseTo(row.dmlCount.total, 6);
    expect(totals.soqlSelf).toBeCloseTo(row.soqlCount.self, 6);
    expect(totals.soqlTotal).toBeCloseTo(row.soqlCount.total, 6);
    expect(totals.dmlRowSelf).toBeCloseTo(row.dmlRowCount.self, 6);
    expect(totals.dmlRowTotal).toBeCloseTo(row.dmlRowCount.total, 6);
    expect(totals.soqlRowSelf).toBeCloseTo(row.soqlRowCount.self, 6);
    expect(totals.soqlRowTotal).toBeCloseTo(row.soqlRowCount.total, 6);
    assertPartitionInvariant(row._children);
  }
}

function assertRowsDoNotExceedGlobalTotals(rows: PartitionRow[], global: PartitionRow): void {
  walkRows(rows, (row) => {
    expect(row.totalTime).toBeLessThanOrEqual(global.totalTime);
    expect(row.dmlCount.total).toBeLessThanOrEqual(global.dmlCount.total);
    expect(row.soqlCount.total).toBeLessThanOrEqual(global.soqlCount.total);
    expect(row.dmlRowCount.total).toBeLessThanOrEqual(global.dmlRowCount.total);
    expect(row.soqlRowCount.total).toBeLessThanOrEqual(global.soqlRowCount.total);
  });
}

/** Search recursing three deep under Outer; the innermost call holds a 650 ns leaf. */
const recursiveSearch = (): Spec =>
  m('Outer', 100, m('Search', 50, m('Search', 50, m('Search', 50, m('Leaf', 650)))));

describe('toBottomUpTree', () => {
  it('attributes caller rows using the current node contribution, not the caller event metrics', async () => {
    // Each parent runs statements of its own, which its caller row must not take.
    const rows = await bottomUpOf(
      m('ParentA', 5, dml(9), thrown, m('Child', 10, dml(7), soql(11), thrown)),
      m('ParentB', 8, dml(15), m('Child', 20, dml(14), dml(2), soql(22), soql(4), thrown, thrown)),
    );

    const childRow = findRowByText(rows, 'Child');
    expect(childRow).toMatchObject({
      totalSelfTime: 30,
      totalTime: 30,
      dmlCount: { self: 0, total: 3 },
      soqlCount: { self: 0, total: 3 },
      dmlRowCount: { self: 0, total: 23 },
      soqlRowCount: { self: 0, total: 37 },
      thrownCount: { total: 3 },
    });

    const callers = childRow._children ?? [];
    const callerA = findRowByText(callers, 'ParentA');
    const callerB = findRowByText(callers, 'ParentB');

    expect(callerA.instances).toEqual([]);
    expect(callerA).toMatchObject({
      totalSelfTime: 10,
      totalTime: 10,
      dmlCount: { total: 1 },
      soqlCount: { total: 1 },
      dmlRowCount: { total: 7 },
      soqlRowCount: { total: 11 },
      thrownCount: { total: 1 },
    });

    expect(callerB.instances).toEqual([]);
    expect(callerB).toMatchObject({
      totalSelfTime: 20,
      totalTime: 20,
      dmlCount: { total: 2 },
      soqlCount: { total: 2 },
      dmlRowCount: { total: 16 },
      soqlRowCount: { total: 26 },
      thrownCount: { total: 2 },
    });
  });

  it('shows every frame at the root including zero-self wrappers and keeps path totals when grouping callers', async () => {
    const rows = await bottomUpOf(
      m('ParentA', 5, m('MethodB', 20, dml(), m('LeafC', 60))),
      m('ParentB', 10, m('MethodB', 30, dml(), dml())),
      m('ZeroSelfWrapper', 0, m('WrappedLeaf', 40)),
    );

    expect(rows.some((row) => row.text === 'ZeroSelfWrapper')).toBe(true);
    expect(rows.some((row) => row.text === 'WrappedLeaf')).toBe(true);

    const methodRow = findRowByText(rows, 'MethodB');
    expect(methodRow).toMatchObject({
      totalSelfTime: 50,
      totalTime: 110,
      dmlCount: { total: 3 },
    });

    const callers = methodRow._children ?? [];
    expect(findRowByText(callers, 'ParentA')).toMatchObject({
      totalSelfTime: 20,
      totalTime: 80,
      dmlCount: { total: 1 },
    });
    expect(findRowByText(callers, 'ParentB')).toMatchObject({
      totalSelfTime: 30,
      totalTime: 30,
      dmlCount: { total: 2 },
    });
  });

  it('accumulates global totals at root and attributes splits to caller rows', async () => {
    const rows = await bottomUpOf(
      m('ParentA', 10, m('HotMethod', 40, dml(20), dml(10), soql(18), thrown, m('Work', 40))),
      m(
        'ParentB',
        15,
        m('HotMethod', 35, dml(25), soql(5), soql(5), soql(6), thrown, thrown, m('Work', 35)),
      ),
    );
    const hotMethod = findRowByText(rows, 'HotMethod');

    expect(hotMethod.callCount).toBe(2);
    expect(hotMethod.totalSelfTime).toBe(75);
    expect(hotMethod.totalTime).toBe(150);
    expect(hotMethod.dmlCount).toEqual({ self: 0, total: 3 });
    expect(hotMethod.soqlCount).toEqual({ self: 0, total: 4 });
    expect(hotMethod.dmlRowCount).toEqual({ self: 0, total: 55 });
    expect(hotMethod.soqlRowCount).toEqual({ self: 0, total: 34 });
    expect(hotMethod.thrownCount.total).toBe(3);

    const callers = hotMethod._children ?? [];
    const callerA = findRowByText(callers, 'ParentA');
    const callerB = findRowByText(callers, 'ParentB');

    expect(callerA.callCount).toBe(1);
    expect(callerB.callCount).toBe(1);
    expect(callerA.totalTime + callerB.totalTime).toBeCloseTo(hotMethod.totalTime, 6);
    expect(callerA.totalSelfTime + callerB.totalSelfTime).toBeCloseTo(hotMethod.totalSelfTime, 6);
  });

  it('keeps events with different entry types as separate root rows for the same name', async () => {
    const rows = await bottomUpOf(cu('MyMethod', 10), m('MyMethod', 15));

    const myMethodRows = rows.filter((r) => r.text === 'MyMethod');
    expect(myMethodRows).toHaveLength(2);
    const codeUnitRow = myMethodRows.find((r) => r.type === 'CODE_UNIT_STARTED');
    const methodEntryRow = myMethodRows.find((r) => r.type === 'METHOD_ENTRY');
    if (!codeUnitRow || !methodEntryRow) {
      throw new Error('Expected both type rows');
    }
    expect(codeUnitRow.callCount).toBe(1);
    expect(codeUnitRow.totalSelfTime).toBe(10);
    expect(codeUnitRow.totalTime).toBe(10);
    expect(methodEntryRow.callCount).toBe(1);
    expect(methodEntryRow.totalSelfTime).toBe(15);
    expect(methodEntryRow.totalTime).toBe(15);
  });

  it('keeps caller rows with different entry types separate for the same name', async () => {
    const rows = await bottomUpOf(
      cu('ParentMethod', 10, m('Leaf', 5)),
      m('ParentMethod', 15, m('Leaf', 7)),
    );

    const leafRow = findRowByText(rows, 'Leaf');
    const callerRows = leafRow._children ?? [];
    const parentMethodRows = callerRows.filter((row) => row.text === 'ParentMethod');

    expect(parentMethodRows).toHaveLength(2);
    const codeUnitCaller = parentMethodRows.find((r) => r.type === 'CODE_UNIT_STARTED');
    const methodEntryCaller = parentMethodRows.find((r) => r.type === 'METHOD_ENTRY');
    if (!codeUnitCaller || !methodEntryCaller) {
      throw new Error('Expected both caller type rows');
    }
    expect(codeUnitCaller.callCount).toBe(1);
    expect(codeUnitCaller.totalSelfTime).toBe(5);
    expect(codeUnitCaller.totalTime).toBe(5);
    expect(methodEntryCaller.callCount).toBe(1);
    expect(methodEntryCaller.totalSelfTime).toBe(7);
    expect(methodEntryCaller.totalTime).toBe(7);
  });

  it('uses only the outermost recursive call for totalTime, but sums all self times', async () => {
    const rows = await bottomUpOf(recursiveSearch());

    const searchRow = findRowByText(rows, 'Search');
    expect(searchRow.callCount).toBe(3);
    expect(searchRow.totalSelfTime).toBe(150);
    expect(searchRow.totalTime).toBe(800);
  });

  it('renders recursive self-callers one level at a time until the real stack is exhausted', async () => {
    const rows = await bottomUpOf(recursiveSearch());

    const searchRow = findRowByText(rows, 'Search');
    const selfCallerRow = findRowByText(searchRow._children ?? [], 'Search');

    expect(selfCallerRow.totalTime).toBe(750);
    expect(selfCallerRow.totalSelfTime).toBe(100);

    const nestedCallerRows = selfCallerRow._children ?? [];
    const nestedSelfCallerRow = findRowByText(nestedCallerRows, 'Search');
    expect(nestedCallerRows.some((row) => row.text === 'Outer')).toBe(true);
    expect(nestedSelfCallerRow.totalTime).toBe(700);
    expect(nestedSelfCallerRow.totalSelfTime).toBe(50);

    const terminalCallerRows = nestedSelfCallerRow._children ?? [];
    expect(terminalCallerRows.some((row) => row.text === 'Search')).toBe(false);
    expect(terminalCallerRows.some((row) => row.text === 'Outer')).toBe(true);
  });

  it('attributes each recursive caller level to the matching immediate parent window', async () => {
    const rows = await bottomUpOf(
      m(
        'Outer',
        80,
        m(
          'Search',
          40,
          m('Other1', 260),
          m('Search', 30, m('Other2', 270), m('Search', 20, m('Leaf', 280))),
        ),
      ),
    );
    const rootSearchRow = findRowByText(rows, 'Search');
    const firstRecursiveCaller = findRowByText(rootSearchRow._children ?? [], 'Search');
    const secondRecursiveCaller = findRowByText(firstRecursiveCaller._children ?? [], 'Search');

    expect(rootSearchRow.totalTime).toBe(900);
    expect(rootSearchRow.totalSelfTime).toBe(90);
    expect(firstRecursiveCaller.totalTime).toBe(600);
    expect(firstRecursiveCaller.totalSelfTime).toBe(50);
    expect(secondRecursiveCaller.totalTime).toBe(300);
    expect(secondRecursiveCaller.totalSelfTime).toBe(20);
  });

  it('does not double-count DML/SOQL totals for recursive calls', async () => {
    // Each call of Search runs one DML of 20 rows, one query of 5 rows and one throw.
    const rows = await bottomUpOf(
      m(
        'Outer',
        100,
        m(
          'Search',
          50,
          dml(20),
          soql(5),
          thrown,
          m(
            'Search',
            50,
            dml(20),
            soql(5),
            thrown,
            m('Search', 50, dml(20), soql(5), thrown, m('Leaf', 650)),
          ),
        ),
      ),
    );

    const searchRow = findRowByText(rows, 'Search');
    // The outermost call holds all three; summing each call's total would say 6.
    expect(searchRow.dmlCount.total).toBe(3);
    expect(searchRow.soqlCount.total).toBe(3);
    expect(searchRow.dmlRowCount.total).toBe(60);
    expect(searchRow.soqlRowCount.total).toBe(15);
    expect(searchRow.thrownCount.total).toBe(3);
  });

  it('keeps totalTime greater than or equal to totalSelfTime for all bottom-up rows', async () => {
    const rows = await bottomUpOf(
      m('Constructor', 20, cu('buildNode', 25, m('Work', 115)), m('buildNode', 15, m('Work', 45))),
      m('Service', 40, m('buildNode', 17, m('buildNode', 11, m('buildNode', 9, m('Work', 111))))),
    );

    assertTotalIsAtLeastSelf(rows);
  });

  it('shows each unique method exactly once at root even with mixed entry types and recursion', async () => {
    const rows = await bottomUpOf(
      cu('search', 10, m('search', 8, m('search', 7)), m('helper', 20)),
    );

    const uniqueKeys = new Set(rows.map((row) => row.key));
    expect(uniqueKeys.size).toBe(rows.length);

    const searchRows = rows.filter((row) => row.text === 'search');
    expect(searchRows).toHaveLength(2);
    expect(searchRows.find((r) => r.type === 'CODE_UNIT_STARTED')).toBeDefined();
    expect(searchRows.find((r) => r.type === 'METHOD_ENTRY')).toBeDefined();
  });

  it('keeps bottom-up root self-time budget equal to full trace self-time', async () => {
    const rows = await bottomUpOf(m('A', 30, m('B', 20, m('B', 15), m('C', 25))), m('D', 40));

    const rootSelfBudget = rows.reduce((sum, row) => sum + row.totalSelfTime, 0);
    // 30 + 20 + 15 + 25 + 40: every frame's self time, once.
    expect(rootSelfBudget).toBe(130);
  });

  it('matches worked example A (pure recursion)', async () => {
    const rows = await bottomUpOf(
      m('Outer', 100, m('recursive', 10, m('recursive', 8, m('recursive', 17)))),
    );

    const recursive = findRowByText(rows, 'recursive');
    expect(recursive.totalSelfTime).toBe(35);
    expect(recursive.totalTime).toBe(35);

    const level1 = recursive._children ?? [];
    const level1Outer = findRowByText(level1, 'Outer');
    const level1Recursive = findRowByText(level1, 'recursive');
    expect(level1Outer).toMatchObject({ totalSelfTime: 10, totalTime: 10 });
    expect(level1Recursive).toMatchObject({ totalSelfTime: 25, totalTime: 25 });

    const level2 = level1Recursive._children ?? [];
    const level2Outer = findRowByText(level2, 'Outer');
    const level2Recursive = findRowByText(level2, 'recursive');
    expect(level2Outer).toMatchObject({ totalSelfTime: 8, totalTime: 8 });
    expect(level2Recursive).toMatchObject({ totalSelfTime: 17, totalTime: 17 });

    const level3 = level2Recursive._children ?? [];
    const level3Outer = findRowByText(level3, 'Outer');
    expect(level3Outer).toMatchObject({ totalSelfTime: 17, totalTime: 17 });
    expect(level3Outer._children).toBeNull();
  });

  it('matches worked example B (other / sub other)', async () => {
    const rows = await bottomUpOf(
      m('Outer', 0, m('other', 10, m('sub other', 6), m('sub other', 9))),
    );

    const subOther = findRowByText(rows, 'sub other');
    expect(subOther).toMatchObject({ totalSelfTime: 15, totalTime: 15, callCount: 2 });

    const otherCaller = findRowByText(subOther._children ?? [], 'other');
    expect(otherCaller).toMatchObject({ totalSelfTime: 15, totalTime: 15 });

    const outerCaller = findRowByText(otherCaller._children ?? [], 'Outer');
    expect(outerCaller).toMatchObject({ totalSelfTime: 15, totalTime: 15 });

    const otherRow = findRowByText(rows, 'other');
    expect(otherRow).toMatchObject({ totalSelfTime: 10, totalTime: 25 });
    const otherOuter = findRowByText(otherRow._children ?? [], 'Outer');
    expect(otherOuter).toMatchObject({ totalSelfTime: 10, totalTime: 25 });
  });

  it('matches worked example C (nested Search)', async () => {
    const rows = await bottomUpOf(
      m(
        'Outer',
        100,
        // Search > Search > { method > sub method, Search > { method > sub method, Search }, function }
        m(
          'Search',
          20,
          m(
            'Search',
            70,
            m('method', 30, m('sub method', 170)),
            m('Search', 30, m('method', 60, m('sub method', 120)), m('Search', 140)),
            m('function', 170),
          ),
        ),
        // Sibling Search directly under Outer
        m('Search', 30),
      ),
    );

    const search = findRowByText(rows, 'Search');
    expect(search).toMatchObject({ totalSelfTime: 290, totalTime: 840 });

    const searchOuter = findRowByText(search._children ?? [], 'Outer');
    expect(searchOuter).toMatchObject({ totalSelfTime: 50, totalTime: 50 });

    const searchSearch = findRowByText(search._children ?? [], 'Search');
    expect(searchSearch).toMatchObject({ totalSelfTime: 240, totalTime: 790 });

    const ssOuter = findRowByText(searchSearch._children ?? [], 'Outer');
    expect(ssOuter).toMatchObject({ totalSelfTime: 70, totalTime: 440 });

    const sss = findRowByText(searchSearch._children ?? [], 'Search');
    expect(sss).toMatchObject({ totalSelfTime: 170, totalTime: 350 });

    const sssOuter = findRowByText(sss._children ?? [], 'Outer');
    expect(sssOuter).toMatchObject({ totalSelfTime: 30, totalTime: 210 });

    const ssss = findRowByText(sss._children ?? [], 'Search');
    expect(ssss).toMatchObject({ totalSelfTime: 140, totalTime: 140 });

    const ssssOuter = findRowByText(ssss._children ?? [], 'Outer');
    expect(ssssOuter).toMatchObject({ totalSelfTime: 140, totalTime: 140 });

    const method = findRowByText(rows, 'method');
    expect(method).toMatchObject({ totalSelfTime: 90, totalTime: 380 });

    const subMethod = findRowByText(rows, 'sub method');
    expect(subMethod).toMatchObject({ totalSelfTime: 290, totalTime: 290 });

    const fn = findRowByText(rows, 'function');
    expect(fn).toMatchObject({ totalSelfTime: 170, totalTime: 170 });

    assertPartitionInvariant(rows);
  });

  it('partitions every metric pair (time, dml, soql, dmlRow, soqlRow) at every level', async () => {
    const rows = await bottomUpOf(
      m(
        'Outer',
        10,
        m(
          'Search',
          20,
          dml(5),
          soql(3),
          soql(9),
          m('Search', 30, dml(4), dml(4), soql(2), m('Search', 40, dml(2), soql(1))),
        ),
        m('Search', 50, dml(7), soql(5), soql(4)),
      ),
    );
    assertPartitionInvariant(rows);

    const search = findRowByText(rows, 'Search');
    // Outer runs 10 + 20 + 30 + 40 + 50 ns: no bottom-up row may exceed it.
    expect(search.totalTime).toBeLessThanOrEqual(150);
  });

  it('expands methods to callers (parents), not callees (children)', async () => {
    const rows = await bottomUpOf(
      m('CallerA', 10, m('MethodB', 25, m('LeafD', 35))),
      m('CallerC', 12, m('MethodB', 30)),
    );
    const methodB = findRowByText(rows, 'MethodB');
    const callers = methodB._children ?? [];

    const callerNames = callers.map((row) => row.text).sort();
    expect(callerNames).toEqual(['CallerA', 'CallerC']);
    expect(callers.some((row) => row.text === 'LeafD')).toBe(false);
  });

  it('includes zero-time frames so DML/SOQL/exception counts and callCount roll up', async () => {
    const rows = await bottomUpOf(m('LimitOnly', 0, dml(), thrown));

    const limitOnly = findRowByText(rows, 'LimitOnly');
    expect(limitOnly.callCount).toBe(1);
    expect(limitOnly.dmlCount.total).toBe(1);
    expect(limitOnly.thrownCount.total).toBe(1);
    // A statement counts itself, so its own row holds the self count.
    expect(findRowByText(rows, DML_TEXT).dmlCount.self).toBe(1);
  });

  it('orders roots deterministically by totalSelfTime desc, then name asc for ties', async () => {
    const rows = await bottomUpOf(m('Zulu', 30), m('Alpha', 20), m('Beta', 20));

    expect(rows.map((row) => row.text)).toEqual(['Zulu', 'Alpha', 'Beta']);
  });

  it('keeps every bottom-up total metric within the top-down global root totals', async () => {
    const store = await parsed(
      m(
        'Outer',
        50,
        dml(20),
        soql(10),
        thrown,
        m('Search', 25, dml(10), soql(4), m('Search', 10, dml(5), soql(2), thrown)),
        m('Worker', 60, dml(8), soql(3), thrown),
      ),
    );
    const rows = toBottomUpTree(await store.logIndex(), store) as PartitionRow[];
    const outer = store.log.event(indexOf(store.log, 'Outer'))!; // written above
    const part = (count: { self: number; total: number } | null) => ({
      self: count?.self ?? 0,
      total: count?.total ?? 0,
    });
    const globalRoot: PartitionRow = {
      text: 'Outer',
      totalTime: outer.duration.total,
      totalSelfTime: outer.duration.self,
      dmlCount: part(outer.dmlCount),
      soqlCount: part(outer.soqlCount),
      dmlRowCount: part(outer.dmlRowCount),
      soqlRowCount: part(outer.soqlRowCount),
      _children: null,
    };

    assertRowsDoNotExceedGlobalTotals(rows, globalRoot);
  });
});

describe('bottom-up caller row scope', () => {
  /** A -> B -> A on one branch, A -> C -> A on the other, so a caller bucket
   *  reaches a strict subset of the root bucket's occurrences. */
  const recursiveRoot = (): Spec[] => [
    m('A', 10, m('B', 20, m('A', 70))),
    m('A', 5, m('C', 15, m('A', 30))),
  ];

  /** Every bucket with the root bucket that holds the calls it derives from. */
  function bucketsWithRoots(
    rows: BottomUpRow[],
    root?: BottomUpRow,
  ): Array<{ row: BottomUpRow; root: BottomUpRow }> {
    return rows.flatMap((row) => {
      const held = root ?? row;
      return [{ row, root: held }, ...bucketsWithRoots(row._children ?? [], held)];
    });
  }

  /** The root bucket's calls whose own chain of callers runs through the row,
   *  which is what the grid counts the row's totals from. */
  function derivedFor(store: LogStore, root: BottomUpRow, row: BottomUpRow): number[] {
    const paths = store.keyPathIds();
    return root.instances.filter((id) => paths.chainNodeAt(id, row._pathId) !== 0);
  }

  async function built(): Promise<{ store: LogStore; roots: BottomUpRow[] }> {
    const store = await parsed(...recursiveRoot());
    return { store, roots: toBottomUpTree(await store.logIndex(), store) };
  }

  it('counts one call per occurrence the row derives', async () => {
    const { store, roots } = await built();

    const buckets = bucketsWithRoots(roots);
    expect(buckets.length).toBeGreaterThan(roots.length);
    for (const { row, root } of buckets) {
      expect(derivedFor(store, root, row)).toHaveLength(row.callCount);
    }
  });

  it('scopes a caller row to the calls made through it, not to every call', async () => {
    const { store, roots } = await built();

    const recursive = findRowByText(roots, 'A');
    const throughB = findRowByText(recursive._children ?? [], 'B');
    expect(recursive.callCount).toBe(4);
    expect(throughB.callCount).toBe(1);
    expect(derivedFor(store, recursive, throughB)).toEqual([
      recursive.instances.find((id) => store.log.event(id)?.parent?.text === 'B'),
    ]);
  });

  it('agrees with the row totals the grid shows', async () => {
    const { store, roots } = await built();
    const { durationTotal, durationSelf } = store.log.columns;

    for (const { row, root } of bucketsWithRoots(roots)) {
      const derived = derivedFor(store, root, row);
      const totalTime = outermostIds(store.log, derived).reduce(
        (sum, id) => sum + durationTotal[id]!,
        0,
      );
      const selfTime = derived.reduce((sum, id) => sum + durationSelf[id]!, 0);
      expect(row.totalTime).toBeCloseTo(totalTime, 6);
      expect(row.totalSelfTime).toBeCloseTo(selfTime, 6);
    }
  });
});

describe('buildBottomUpTree', () => {
  /** Enough frames to cross a slice, nested so callers repeat. */
  const wideRoot = (): Spec[] =>
    Array.from({ length: 40 }, (_, i) =>
      m(
        `Outer${i % 4}`,
        1,
        ...Array.from({ length: 10 }, (_, j) => m(`Inner${j % 3}`, 2, m('Leaf', 1))),
      ),
    );

  it('builds the rows toBottomUpTree builds, handing the thread back between slices', async () => {
    const store = await parsed(...wideRoot());
    const index = await store.logIndex();
    const yieldSlice = jest.fn(() => Promise.resolve());
    // Every clock read is past the slice, so every tick yields.
    let t = 0;
    const now = jest.spyOn(performance, 'now').mockImplementation(() => (t += 100));
    const sliced = await buildBottomUpTree(store, { yieldSlice });
    now.mockRestore();

    expect(sliced).toEqual(toBottomUpTree(index, store));
    expect(yieldSlice.mock.calls.length).toBeGreaterThan(1);
  });

  it('returns null once the signal aborts', async () => {
    const store = await parsed(...wideRoot());
    await store.logIndex();
    const controller = new AbortController();
    controller.abort();
    let t = 0;
    const now = jest.spyOn(performance, 'now').mockImplementation(() => (t += 100));
    const sliced = await buildBottomUpTree(store, {
      yieldSlice: () => Promise.resolve(),
      signal: controller.signal,
    });
    now.mockRestore();

    expect(sliced).toBeNull();
  });
});

describe('buildAggregatedTree', () => {
  /** Enough frames to cross a slice, nested so callees repeat. */
  async function wideStore(): Promise<LogStore> {
    let body = '';
    let t = 1000;
    for (let i = 0; i < 400; i++) {
      body += `09:18:22.6 (${(t += 10)})|METHOD_ENTRY|[1]|01p|ns.Outer${i % 4}.run()\n`;
      for (let j = 0; j < 3; j++) {
        body += `09:18:22.6 (${(t += 10)})|METHOD_ENTRY|[2]|01p|ns.Inner${j}.run()\n`;
        body += `09:18:22.6 (${(t += 10)})|METHOD_EXIT|[2]|ns.Inner${j}.run()\n`;
      }
      body += `09:18:22.6 (${(t += 10)})|METHOD_EXIT|[1]|ns.Outer${i % 4}.run()\n`;
    }
    return (await storeOf(body)).store;
  }

  it('builds the rows toAggregatedCallTree builds, handing the thread back between slices', async () => {
    const store = await wideStore();
    const index = await store.logIndex();
    const yieldSlice = jest.fn(() => Promise.resolve());
    // Every clock read is past the slice, so every tick yields.
    let t = 0;
    const now = jest.spyOn(performance, 'now').mockImplementation(() => (t += 100));
    const sliced = await buildAggregatedTree(store, { yieldSlice });
    now.mockRestore();

    expect(sliced).toEqual(toAggregatedCallTree(index, store));
    expect(yieldSlice.mock.calls.length).toBeGreaterThan(1);
  });

  it('groups every call once where a slice ends partway through a row', async () => {
    const store = await wideStore();
    const rows = (of: AggregatedRow[]): AggregatedRow[] =>
      of.flatMap((row) => [row, ...rows(row._children ?? [])]);
    const all = rows(toAggregatedCallTree(await store.logIndex(), store));

    const counts = (prefix: string): number[] =>
      all.filter((row) => row.text.startsWith(prefix)).map((row) => row.callCount);
    expect(counts('ns.Outer')).toEqual([100, 100, 100, 100]);
    expect(counts('ns.Inner')).toEqual(Array(12).fill(100));
  });
});

describe('toAggregatedCallTree', () => {
  it('includes zero-time frames so DML/SOQL/exception counts and callCount roll up', async () => {
    const rows = await aggregatedOf(m('LimitOnly', 0, soql(), soql()));

    const limitOnly = findRowByText(rows, 'LimitOnly');
    expect(limitOnly.callCount).toBe(1);
    expect(limitOnly.soqlCount.total).toBe(2);
  });

  // A frame's own id, so a name cell and a menu land on its first call.
  it('names each row by the id of its first call', async () => {
    const store = await parsed(m('Outer', 10, m('Work', 5), m('Work', 7)));
    const rows = toAggregatedCallTree(await store.logIndex(), store);

    const work = findRowByText(findRowByText(rows, 'Outer')._children ?? [], 'Work');
    expect(work.instances).toHaveLength(2);
    expect(work.eventIndex).toBe(work.instances[0]);
    expect(store.log.event(work.eventIndex)?.duration.total).toBe(5);
  });
});

describe('_hasDetailsDeep precomputation', () => {
  it('aggregated: marks zero-time leaf with no excluded type as not significant', async () => {
    const rows = await aggregatedOf(m('NoTime', 0));

    expect(findRowByText(rows, 'NoTime')._hasDetailsDeep).toBe(false);
  });

  it('aggregated: marks zero-time leaf with excluded type as significant', async () => {
    const rows = await aggregatedOf(limits);

    expect(findRowByText(rows, 'CUMULATIVE_LIMIT_USAGE')._hasDetailsDeep).toBe(true);
  });

  it('aggregated: marks zero-time parent as significant when any descendant is', async () => {
    const rows = await aggregatedOf(m('ZeroParent', 0, limits));

    const zeroParent = findRowByText(rows, 'ZeroParent');
    expect(zeroParent.totalTime).toBe(0);
    expect(zeroParent._hasDetailsDeep).toBe(true);
  });

  it('aggregated: marks zero-time parent as not significant when no descendant is', async () => {
    const rows = await aggregatedOf(m('ZeroParent', 0, m('ZeroChild', 0)));

    expect(findRowByText(rows, 'ZeroParent')._hasDetailsDeep).toBe(false);
  });

  it('bottom-up: rolls up significance from callers (children)', async () => {
    const rows = await bottomUpOf(m('Caller', 0, m('Callee', 5)));

    const callee = findRowByText(rows, 'Callee');
    expect(callee._hasDetailsDeep).toBe(true);
    // Caller appears as a child of Callee in bottom-up
    const callerChild = findRowByText(callee._children ?? [], 'Caller');
    expect(callerChild._hasDetailsDeep).toBe(true);
  });

  it('bottom-up: zero-time with excluded type is significant', async () => {
    const rows = await bottomUpOf(limits);

    const usage = findRowByText(rows, '(default)');
    expect(usage.type).toBe('LIMIT_USAGE_FOR_NS');
    expect(usage._hasDetailsDeep).toBe(true);
  });
});

describe('SOSL rollup', () => {
  it('aggregated: sums SOSL count and rows across instances', async () => {
    // Two calls to the same signature; their SOSL metrics are summed on the row.
    const rows = await aggregatedOf(m('Search', 1, sosl(10)), m('Search', 1, sosl(5)));

    const searchRow = findRowByText(rows, 'Search');
    expect(searchRow.soslCount.total).toBe(2);
    expect(searchRow.soslRowCount.total).toBe(15);
  });

  it('bottom-up: attributes SOSL totals to the callee bucket and self to the statement', async () => {
    const rows = await bottomUpOf(m('Caller', 0, m('Callee', 2, sosl(7))));

    const callee = findRowByText(rows, 'Callee');
    expect(callee.soslCount.total).toBe(1);
    expect(callee.soslRowCount.total).toBe(7);
    expect(findRowByText(rows, SOSL_TEXT).soslCount.self).toBe(1);
  });
});

describe('reported usage', () => {
  const query = (at: number): string =>
    `09:18:22.6 (${at})|SOQL_EXECUTE_BEGIN|[2]|Aggregations:0|SELECT Id FROM Account\n` +
    `09:18:22.6 (${at + 50})|SOQL_EXECUTE_END|[2]|Rows:1\n`;
  const entry = (at: number, name: string): string =>
    `09:18:22.6 (${at})|METHOD_ENTRY|[1]|01p|${name}\n`;
  const exit = (at: number, name: string): string => `09:18:22.6 (${at})|METHOD_EXIT|[1]|${name}\n`;

  // The log's lines sit inside the code unit `storeOf` wraps them in.
  function findDeep(rows: AggregatedRow[], text: string): AggregatedRow {
    const pending = [...rows];
    for (let row = pending.pop(); row; row = pending.pop()) {
      if (row.text === text) {
        return row;
      }
      pending.push(...(row._children ?? []));
    }
    throw new Error(`Unable to find row for ${text}`);
  }

  async function built(
    text: string,
  ): Promise<{ bottomUp: BottomUpRow[]; aggregated: AggregatedRow[] }> {
    const { store } = await storeOf(text);
    const index = await store.logIndex();
    const usage = await store.derive(reportedUsage);
    return {
      bottomUp: toBottomUpTree(index, store, usage),
      aggregated: toAggregatedCallTree(index, store, usage),
    };
  }

  it('counts the queries of a recursive method once, not again for the inner call', async () => {
    const { bottomUp } = await built(
      entry(1000, 'ns.A.run()') +
        query(1100) +
        entry(1300, 'ns.A.run()') +
        query(1400) +
        exit(1600, 'ns.A.run()') +
        exit(1700, 'ns.A.run()'),
    );

    // Two queries ran in all; summing both calls of A would say 3.
    expect(findRowByText(bottomUp, 'ns.A.run()').reported.soqlQueries).toBe(2);
  });

  it('splits a method across the callers that ran it', async () => {
    const { bottomUp, aggregated } = await built(
      entry(1000, 'ns.A.run()') +
        entry(1100, 'ns.B.run()') +
        query(1200) +
        exit(1300, 'ns.B.run()') +
        exit(1400, 'ns.A.run()') +
        entry(2000, 'ns.C.run()') +
        entry(2100, 'ns.B.run()') +
        query(2200) +
        query(2300) +
        exit(2400, 'ns.B.run()') +
        exit(2500, 'ns.C.run()'),
    );

    const b = findRowByText(bottomUp, 'ns.B.run()');
    expect(b.reported.soqlQueries).toBe(3);
    expect(findRowByText(b._children ?? [], 'ns.A.run()').reported.soqlQueries).toBe(1);
    expect(findRowByText(b._children ?? [], 'ns.C.run()').reported.soqlQueries).toBe(2);
    const underC = findRowByText(findDeep(aggregated, 'ns.C.run()')._children ?? [], 'ns.B.run()');
    expect(underC.reported.soqlQueries).toBe(2);
  });

  it('adds up every call of a method an aggregated row groups', async () => {
    const { aggregated } = await built(
      entry(1000, 'ns.A.run()') +
        entry(1100, 'ns.B.run()') +
        query(1200) +
        exit(1300, 'ns.B.run()') +
        entry(1400, 'ns.B.run()') +
        query(1500) +
        query(1600) +
        exit(1700, 'ns.B.run()') +
        exit(1800, 'ns.A.run()'),
    );

    // A called B twice: once with one query, once with two.
    const underA = findRowByText(findDeep(aggregated, 'ns.A.run()')._children ?? [], 'ns.B.run()');
    expect(underA.reported.soqlQueries).toBe(3);
  });
});
