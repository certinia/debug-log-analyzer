import type { LogEvent } from 'apex-log-parser';

import { toAggregatedCallTree, toBottomUpTree } from '../Aggregation.js';

type EventOptions = {
  text: string;
  self: number;
  total: number;
  parent?: LogEvent | null;
  type?: string;
  dmlSelf?: number;
  dmlTotal?: number;
  soqlSelf?: number;
  soqlTotal?: number;
  dmlRowSelf?: number;
  dmlRowTotal?: number;
  soqlRowSelf?: number;
  soqlRowTotal?: number;
  thrown?: number;
};

let nextTimestamp = 1;

function createEvent(options: EventOptions): LogEvent {
  const event = {
    logParser: null,
    parent: options.parent ?? null,
    children: [],
    type: (options.type ?? 'METHOD_ENTRY') as LogEvent['type'],
    logLine: '',
    text: options.text,
    acceptsText: false,
    isExit: false,
    isParent: false,
    isTruncated: false,
    nextLineIsExit: false,
    lineNumber: null,
    namespace: 'default',
    hasValidSymbols: true,
    suffix: null,
    discontinuity: false,
    timestamp: nextTimestamp++,
    exitStamp: null,
    category: '',
    debugCategory: '',
    debugLevel: '',
    cpuType: '',
    duration: { self: options.self, total: options.total },
    dmlRowCount: { self: options.dmlRowSelf ?? 0, total: options.dmlRowTotal ?? 0 },
    soqlRowCount: { self: options.soqlRowSelf ?? 0, total: options.soqlRowTotal ?? 0 },
    soslRowCount: { self: 0, total: 0 },
    dmlCount: { self: options.dmlSelf ?? 0, total: options.dmlTotal ?? 0 },
    soqlCount: { self: options.soqlSelf ?? 0, total: options.soqlTotal ?? 0 },
    soslCount: { self: 0, total: 0 },
    totalThrownCount: options.thrown ?? 0,
    exitTypes: [],
  } as unknown as LogEvent;

  if (options.parent) {
    options.parent.children.push(event);
  }

  return event;
}

function findRowByText<T extends { text: string }>(rows: T[], text: string): T {
  const row = rows.find((candidate) => candidate.text === text);
  if (!row) {
    throw new Error(`Unable to find row for ${text}`);
  }
  return row;
}

function assertTotalIsAtLeastSelf(
  rows: Array<{ totalTime: number; totalSelfTime: number; _children: unknown }>,
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
  _children: PartitionRow[] | null;
};

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

function sumTraceSelfTime(events: LogEvent[]): number {
  let total = 0;
  for (const event of events) {
    if (event.duration.self > 0) {
      total += event.duration.self;
    }
    total += sumTraceSelfTime(event.children);
  }
  return total;
}

describe('toBottomUpTree', () => {
  beforeEach(() => {
    nextTimestamp = 1;
  });

  it('attributes caller rows using the current node contribution, not the caller event metrics', () => {
    const root = createEvent({ text: 'LOG_ROOT', self: 0, total: 0, type: 'EXECUTION_STARTED' });
    const parentA = createEvent({
      text: 'ParentA',
      self: 5,
      total: 15,
      parent: root,
      dmlSelf: 9,
      dmlTotal: 12,
      thrown: 4,
    });
    createEvent({
      text: 'Child',
      self: 10,
      total: 10,
      parent: parentA,
      dmlSelf: 1,
      dmlTotal: 2,
      soqlSelf: 3,
      soqlTotal: 5,
      dmlRowSelf: 7,
      dmlRowTotal: 8,
      soqlRowSelf: 11,
      soqlRowTotal: 13,
      thrown: 1,
    });

    const parentB = createEvent({
      text: 'ParentB',
      self: 8,
      total: 28,
      parent: root,
      dmlSelf: 15,
      dmlTotal: 18,
      thrown: 6,
    });
    createEvent({
      text: 'Child',
      self: 20,
      total: 20,
      parent: parentB,
      dmlSelf: 2,
      dmlTotal: 4,
      soqlSelf: 6,
      soqlTotal: 10,
      dmlRowSelf: 14,
      dmlRowTotal: 16,
      soqlRowSelf: 22,
      soqlRowTotal: 26,
      thrown: 2,
    });

    const rows = toBottomUpTree(root.children);
    const childRow = findRowByText(rows, 'Child');
    expect(childRow).toMatchObject({
      totalSelfTime: 30,
      totalTime: 30,
      dmlCount: { self: 3, total: 6 },
      soqlCount: { self: 9, total: 15 },
      dmlRowCount: { self: 21, total: 24 },
      soqlRowCount: { self: 33, total: 39 },
      totalThrownCount: 3,
    });

    const callers = childRow._children ?? [];
    const callerA = findRowByText(callers, 'ParentA');
    const callerB = findRowByText(callers, 'ParentB');

    expect(callerA.instances.map((instance) => instance.text)).toEqual(['ParentA']);
    expect(callerA).toMatchObject({
      totalSelfTime: 10,
      totalTime: 10,
      dmlCount: { self: 1, total: 2 },
      soqlCount: { self: 3, total: 5 },
      dmlRowCount: { self: 7, total: 8 },
      soqlRowCount: { self: 11, total: 13 },
      totalThrownCount: 1,
    });

    expect(callerB.instances.map((instance) => instance.text)).toEqual(['ParentB']);
    expect(callerB).toMatchObject({
      totalSelfTime: 20,
      totalTime: 20,
      dmlCount: { self: 2, total: 4 },
      soqlCount: { self: 6, total: 10 },
      dmlRowCount: { self: 14, total: 16 },
      soqlRowCount: { self: 22, total: 26 },
      totalThrownCount: 2,
    });
  });

  it('shows every frame at the root including zero-self wrappers and keeps path totals when grouping callers', () => {
    const root = createEvent({ text: 'LOG_ROOT', self: 0, total: 0, type: 'EXECUTION_STARTED' });

    const parentA = createEvent({ text: 'ParentA', self: 5, total: 85, parent: root });
    const methodFromA = createEvent({
      text: 'MethodB',
      self: 20,
      total: 80,
      parent: parentA,
      dmlSelf: 1,
      dmlTotal: 3,
    });
    createEvent({ text: 'LeafC', self: 60, total: 60, parent: methodFromA });

    const parentB = createEvent({ text: 'ParentB', self: 10, total: 40, parent: root });
    createEvent({
      text: 'MethodB',
      self: 30,
      total: 30,
      parent: parentB,
      dmlSelf: 2,
      dmlTotal: 5,
    });

    const zeroSelfWrapper = createEvent({
      text: 'ZeroSelfWrapper',
      self: 0,
      total: 40,
      parent: root,
    });
    createEvent({ text: 'WrappedLeaf', self: 40, total: 40, parent: zeroSelfWrapper });

    const rows = toBottomUpTree(root.children);

    expect(rows.some((row) => row.text === 'ZeroSelfWrapper')).toBe(true);
    expect(rows.some((row) => row.text === 'WrappedLeaf')).toBe(true);

    const methodRow = findRowByText(rows, 'MethodB');
    expect(methodRow).toMatchObject({
      totalSelfTime: 50,
      totalTime: 110,
      dmlCount: { self: 3, total: 8 },
    });

    const callers = methodRow._children ?? [];
    expect(findRowByText(callers, 'ParentA')).toMatchObject({
      totalSelfTime: 20,
      totalTime: 80,
      dmlCount: { self: 1, total: 3 },
    });
    expect(findRowByText(callers, 'ParentB')).toMatchObject({
      totalSelfTime: 30,
      totalTime: 30,
      dmlCount: { self: 2, total: 5 },
    });
  });

  it('accumulates global totals at root and attributes splits to caller rows', () => {
    const root = createEvent({ text: 'LOG_ROOT', self: 60, total: 100, type: 'EXECUTION_STARTED' });

    const parentA = createEvent({ text: 'ParentA', self: 10, total: 80, parent: root });
    createEvent({
      text: 'HotMethod',
      self: 40,
      total: 80,
      parent: parentA,
      dmlSelf: 4,
      dmlTotal: 8,
      soqlSelf: 2,
      soqlTotal: 6,
      dmlRowSelf: 20,
      dmlRowTotal: 30,
      soqlRowSelf: 10,
      soqlRowTotal: 18,
      thrown: 4,
    });

    const parentB = createEvent({ text: 'ParentB', self: 15, total: 70, parent: root });
    createEvent({
      text: 'HotMethod',
      self: 35,
      total: 70,
      parent: parentB,
      dmlSelf: 3,
      dmlTotal: 7,
      soqlSelf: 4,
      soqlTotal: 5,
      dmlRowSelf: 15,
      dmlRowTotal: 25,
      soqlRowSelf: 12,
      soqlRowTotal: 16,
      thrown: 3,
    });

    const rows = toBottomUpTree(root.children);
    const hotMethod = findRowByText(rows, 'HotMethod');

    expect(hotMethod.callCount).toBe(2);
    expect(hotMethod.totalSelfTime).toBe(75);
    expect(hotMethod.totalTime).toBe(150);
    expect(hotMethod.dmlCount).toEqual({ self: 7, total: 15 });
    expect(hotMethod.soqlCount).toEqual({ self: 6, total: 11 });
    expect(hotMethod.dmlRowCount).toEqual({ self: 35, total: 55 });
    expect(hotMethod.soqlRowCount).toEqual({ self: 22, total: 34 });
    expect(hotMethod.totalThrownCount).toBe(7);

    const callers = hotMethod._children ?? [];
    const callerA = findRowByText(callers, 'ParentA');
    const callerB = findRowByText(callers, 'ParentB');

    expect(callerA.callCount).toBe(1);
    expect(callerB.callCount).toBe(1);
    expect(callerA.totalTime + callerB.totalTime).toBeCloseTo(hotMethod.totalTime, 6);
    expect(callerA.totalSelfTime + callerB.totalSelfTime).toBeCloseTo(hotMethod.totalSelfTime, 6);
  });

  it('keeps events with different entry types as separate root rows for the same name', () => {
    const root = createEvent({ text: 'LOG_ROOT', self: 0, total: 0, type: 'EXECUTION_STARTED' });
    createEvent({ text: 'MyMethod', self: 10, total: 10, parent: root, type: 'CODE_UNIT_STARTED' });
    createEvent({ text: 'MyMethod', self: 15, total: 15, parent: root, type: 'METHOD_ENTRY' });

    const rows = toBottomUpTree(root.children);

    const myMethodRows = rows.filter((r) => r.text === 'MyMethod');
    expect(myMethodRows).toHaveLength(2);
    const codeUnitRow = myMethodRows.find((r) => r.type === 'CODE_UNIT_STARTED');
    const methodEntryRow = myMethodRows.find((r) => r.type === 'METHOD_ENTRY');
    if (!codeUnitRow || !methodEntryRow) throw new Error('Expected both type rows');
    expect(codeUnitRow.callCount).toBe(1);
    expect(codeUnitRow.totalSelfTime).toBe(10);
    expect(codeUnitRow.totalTime).toBe(10);
    expect(methodEntryRow.callCount).toBe(1);
    expect(methodEntryRow.totalSelfTime).toBe(15);
    expect(methodEntryRow.totalTime).toBe(15);
  });

  it('keeps caller rows with different entry types separate for the same name', () => {
    const root = createEvent({ text: 'LOG_ROOT', self: 0, total: 0, type: 'EXECUTION_STARTED' });
    const parentA = createEvent({
      text: 'ParentMethod',
      self: 10,
      total: 20,
      parent: root,
      type: 'CODE_UNIT_STARTED',
    });
    createEvent({ text: 'Leaf', self: 5, total: 5, parent: parentA });

    const parentB = createEvent({
      text: 'ParentMethod',
      self: 15,
      total: 25,
      parent: root,
      type: 'METHOD_ENTRY',
    });
    createEvent({ text: 'Leaf', self: 7, total: 7, parent: parentB });

    const rows = toBottomUpTree(root.children);

    const leafRow = findRowByText(rows, 'Leaf');
    const callerRows = leafRow._children ?? [];
    const parentMethodRows = callerRows.filter((row) => row.text === 'ParentMethod');

    expect(parentMethodRows).toHaveLength(2);
    const codeUnitCaller = parentMethodRows.find((r) => r.type === 'CODE_UNIT_STARTED');
    const methodEntryCaller = parentMethodRows.find((r) => r.type === 'METHOD_ENTRY');
    if (!codeUnitCaller || !methodEntryCaller) throw new Error('Expected both caller type rows');
    expect(codeUnitCaller.callCount).toBe(1);
    expect(codeUnitCaller.totalSelfTime).toBe(5);
    expect(codeUnitCaller.totalTime).toBe(5);
    expect(methodEntryCaller.callCount).toBe(1);
    expect(methodEntryCaller.totalSelfTime).toBe(7);
    expect(methodEntryCaller.totalTime).toBe(7);
  });

  it('uses only the outermost recursive call for totalTime, but sums all self times', () => {
    const root = createEvent({ text: 'LOG_ROOT', self: 0, total: 1000, type: 'EXECUTION_STARTED' });
    const caller = createEvent({ text: 'Outer', self: 100, total: 1000, parent: root });
    const rec1 = createEvent({ text: 'Search', self: 50, total: 900, parent: caller });
    const rec2 = createEvent({ text: 'Search', self: 50, total: 800, parent: rec1 });
    createEvent({ text: 'Search', self: 50, total: 700, parent: rec2 });

    const rows = toBottomUpTree(root.children);

    const searchRow = rows.find((r) => r.text === 'Search');
    if (!searchRow) throw new Error('Search row not found');

    expect(searchRow.callCount).toBe(3);
    expect(searchRow.totalSelfTime).toBe(150);
    expect(searchRow.totalTime).toBe(900);
  });

  it('recursive self-caller row uses only outermost entry total and maintains self ≤ total', () => {
    const root = createEvent({ text: 'LOG_ROOT', self: 0, total: 1000, type: 'EXECUTION_STARTED' });
    const outer = createEvent({ text: 'Outer', self: 100, total: 1000, parent: root });
    const rec1 = createEvent({ text: 'Search', self: 50, total: 900, parent: outer });
    const rec2 = createEvent({ text: 'Search', self: 50, total: 800, parent: rec1 });
    createEvent({ text: 'Search', self: 50, total: 700, parent: rec2 });

    const rows = toBottomUpTree(root.children);

    const searchRow = rows.find((r) => r.text === 'Search');
    if (!searchRow) throw new Error('Search row not found');

    const callerRows = searchRow._children ?? [];
    const selfCallerRow = callerRows.find((r) => r.text === 'Search');
    if (!selfCallerRow) throw new Error('Self-caller row not found');

    expect(selfCallerRow.totalTime).toBe(800);
    expect(selfCallerRow.totalSelfTime).toBeLessThanOrEqual(selfCallerRow.totalTime);
  });

  it('renders recursive self-callers one level at a time until the real stack is exhausted', () => {
    const root = createEvent({ text: 'LOG_ROOT', self: 0, total: 1000, type: 'EXECUTION_STARTED' });
    const outer = createEvent({ text: 'Outer', self: 100, total: 1000, parent: root });
    const rec1 = createEvent({ text: 'Search', self: 50, total: 900, parent: outer });
    const rec2 = createEvent({ text: 'Search', self: 50, total: 800, parent: rec1 });
    createEvent({ text: 'Search', self: 50, total: 700, parent: rec2 });

    const rows = toBottomUpTree(root.children);

    const searchRow = findRowByText(rows, 'Search');
    const callerRows = searchRow._children ?? [];
    const selfCallerRow = findRowByText(callerRows, 'Search');

    expect(selfCallerRow.totalTime).toBe(800);
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

  it('attributes each recursive caller level to the matching immediate parent window', () => {
    const root = createEvent({ text: 'LOG_ROOT', self: 0, total: 1200, type: 'EXECUTION_STARTED' });
    const outer = createEvent({ text: 'Outer', self: 80, total: 1200, parent: root });
    const rec1 = createEvent({ text: 'Search', self: 40, total: 900, parent: outer });
    const rec2 = createEvent({ text: 'Search', self: 30, total: 600, parent: rec1 });
    createEvent({ text: 'Search', self: 20, total: 300, parent: rec2 });

    const rows = toBottomUpTree(root.children);
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

  it('does not double-count DML/SOQL totals for recursive calls', () => {
    const root = createEvent({ text: 'LOG_ROOT', self: 0, total: 1000, type: 'EXECUTION_STARTED' });
    const outer = createEvent({ text: 'Outer', self: 100, total: 1000, parent: root });
    // rec1 is the outermost recursive Search — its totals are the canonical scope
    const rec1 = createEvent({
      text: 'Search',
      self: 50,
      total: 900,
      parent: outer,
      dmlTotal: 10,
      dmlSelf: 2,
      soqlTotal: 6,
      soqlSelf: 1,
      dmlRowTotal: 100,
      dmlRowSelf: 20,
      soqlRowTotal: 50,
      soqlRowSelf: 5,
      thrown: 3,
    });
    const rec2 = createEvent({
      text: 'Search',
      self: 50,
      total: 800,
      parent: rec1,
      dmlTotal: 8,
      dmlSelf: 2,
      soqlTotal: 5,
      soqlSelf: 1,
      dmlRowTotal: 80,
      dmlRowSelf: 20,
      soqlRowTotal: 40,
      soqlRowSelf: 5,
      thrown: 2,
    });
    createEvent({
      text: 'Search',
      self: 50,
      total: 700,
      parent: rec2,
      dmlTotal: 5,
      dmlSelf: 2,
      soqlTotal: 3,
      soqlSelf: 1,
      dmlRowTotal: 50,
      dmlRowSelf: 20,
      soqlRowTotal: 20,
      soqlRowSelf: 5,
      thrown: 1,
    });

    const rows = toBottomUpTree(root.children);

    const searchRow = rows.find((r) => r.text === 'Search');
    if (!searchRow) throw new Error('Search row not found');

    // totalTime uses outermost only (rec1.total = 900) — already tested separately
    expect(searchRow.totalTime).toBe(900);
    // self sums all three invocations
    expect(searchRow.totalSelfTime).toBe(150);

    // *.total metrics must apply the same outermost-only rule as totalTime
    // rec1 is the outermost, so only its totals count
    expect(searchRow.dmlCount.self).toBe(6); // 2+2+2 — all self invocations sum
    expect(searchRow.dmlCount.total).toBe(10); // outermost only
    expect(searchRow.soqlCount.self).toBe(3);
    expect(searchRow.soqlCount.total).toBe(6); // outermost only
    expect(searchRow.dmlRowCount.self).toBe(60); // 20+20+20
    expect(searchRow.dmlRowCount.total).toBe(100); // outermost only
    expect(searchRow.soqlRowCount.self).toBe(15);
    expect(searchRow.soqlRowCount.total).toBe(50); // outermost only
    expect(searchRow.totalThrownCount).toBe(3); // outermost only
  });

  it('keeps totalTime greater than or equal to totalSelfTime for all bottom-up rows', () => {
    const root = createEvent({ text: 'LOG_ROOT', self: 0, total: 1000, type: 'EXECUTION_STARTED' });

    const constructor = createEvent({ text: 'Constructor', self: 20, total: 200, parent: root });
    createEvent({
      text: 'buildNode',
      self: 25,
      total: 140,
      parent: constructor,
      type: 'CODE_UNIT_STARTED',
    });
    createEvent({
      text: 'buildNode',
      self: 15,
      total: 60,
      parent: constructor,
      type: 'METHOD_ENTRY',
    });

    const service = createEvent({ text: 'Service', self: 40, total: 700, parent: root });
    const search1 = createEvent({ text: 'buildNode', self: 17, total: 500, parent: service });
    const search2 = createEvent({ text: 'buildNode', self: 11, total: 300, parent: search1 });
    createEvent({ text: 'buildNode', self: 9, total: 120, parent: search2 });

    const rows = toBottomUpTree(root.children);

    assertTotalIsAtLeastSelf(rows);
    const buildNodeRows = rows.filter((row) => row.text === 'buildNode');
    // Different entry types are now bucketed separately: CODE_UNIT_STARTED + METHOD_ENTRY.
    expect(buildNodeRows).toHaveLength(2);
  });

  it('shows each unique method exactly once at root even with mixed entry types and recursion', () => {
    const root = createEvent({ text: 'LOG_ROOT', self: 0, total: 400, type: 'EXECUTION_STARTED' });

    const topLevel = createEvent({
      text: 'search',
      self: 10,
      total: 300,
      parent: root,
      type: 'CODE_UNIT_STARTED',
    });
    const recursive = createEvent({
      text: 'search',
      self: 8,
      total: 220,
      parent: topLevel,
      type: 'METHOD_ENTRY',
    });
    createEvent({ text: 'search', self: 7, total: 140, parent: recursive, type: 'METHOD_ENTRY' });
    createEvent({ text: 'helper', self: 20, total: 20, parent: topLevel, type: 'METHOD_ENTRY' });

    const rows = toBottomUpTree(root.children);

    const uniqueKeys = new Set(rows.map((row) => row.key));
    expect(uniqueKeys.size).toBe(rows.length);

    // CODE_UNIT_STARTED + METHOD_ENTRY are now bucketed separately by type.
    const searchRows = rows.filter((row) => row.text === 'search');
    expect(searchRows).toHaveLength(2);
    expect(searchRows.find((r) => r.type === 'CODE_UNIT_STARTED')).toBeDefined();
    expect(searchRows.find((r) => r.type === 'METHOD_ENTRY')).toBeDefined();
  });

  it('keeps bottom-up root self-time budget equal to full trace self-time', () => {
    const root = createEvent({ text: 'LOG_ROOT', self: 0, total: 500, type: 'EXECUTION_STARTED' });

    const a = createEvent({ text: 'A', self: 30, total: 250, parent: root });
    const b = createEvent({ text: 'B', self: 20, total: 200, parent: a });
    createEvent({ text: 'B', self: 15, total: 120, parent: b });
    createEvent({ text: 'C', self: 25, total: 25, parent: b });
    createEvent({ text: 'D', self: 40, total: 40, parent: root });

    const rows = toBottomUpTree(root.children);
    const rootSelfBudget = rows.reduce((sum, row) => sum + row.totalSelfTime, 0);
    const traceSelfBudget = sumTraceSelfTime(root.children);

    expect(rootSelfBudget).toBe(traceSelfBudget);
  });

  it('matches worked example A (pure recursion) from BOTTOM_UP_CALL_TREE_SPEC.md', () => {
    const root = createEvent({ text: 'LOG_ROOT', self: 0, total: 0, type: 'EXECUTION_STARTED' });
    const outer = createEvent({ text: 'Outer', self: 100, total: 1000, parent: root });
    const r1 = createEvent({ text: 'recursive', self: 10, total: 35, parent: outer });
    const r2 = createEvent({ text: 'recursive', self: 8, total: 25, parent: r1 });
    createEvent({ text: 'recursive', self: 17, total: 17, parent: r2 });

    const rows = toBottomUpTree(root.children);

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

  it('matches worked example B (other / sub other) from BOTTOM_UP_CALL_TREE_SPEC.md', () => {
    const root = createEvent({ text: 'LOG_ROOT', self: 0, total: 0, type: 'EXECUTION_STARTED' });
    const outer = createEvent({ text: 'Outer', self: 0, total: 25, parent: root });
    const other = createEvent({ text: 'other', self: 10, total: 25, parent: outer });
    createEvent({ text: 'sub other', self: 6, total: 6, parent: other });
    createEvent({ text: 'sub other', self: 9, total: 9, parent: other });

    const rows = toBottomUpTree(root.children);

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

  it('matches worked example C (nested Search) from top-down-to-bottom-up-example.md', () => {
    const root = createEvent({ text: 'LOG_ROOT', self: 0, total: 0, type: 'EXECUTION_STARTED' });
    const outer = createEvent({ text: 'Outer', self: 100, total: 1000, parent: root });

    // First Search branch: Search > Search > { method > sub method, Search > { method > sub method, Search }, function }
    const s1 = createEvent({ text: 'Search', self: 20, total: 810, parent: outer });
    const s2 = createEvent({ text: 'Search', self: 70, total: 790, parent: s1 });
    const method1 = createEvent({ text: 'method', self: 30, total: 200, parent: s2 });
    createEvent({ text: 'sub method', self: 170, total: 170, parent: method1 });
    const s3 = createEvent({ text: 'Search', self: 30, total: 350, parent: s2 });
    const method2 = createEvent({ text: 'method', self: 60, total: 180, parent: s3 });
    createEvent({ text: 'sub method', self: 120, total: 120, parent: method2 });
    createEvent({ text: 'Search', self: 140, total: 140, parent: s3 });
    createEvent({ text: 'function', self: 170, total: 170, parent: s2 });

    // Sibling Search directly under Outer
    createEvent({ text: 'Search', self: 30, total: 30, parent: outer });

    const rows = toBottomUpTree(root.children);

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

  it('partitions every metric pair (time, dml, soql, dmlRow, soqlRow) at every level', () => {
    const root = createEvent({ text: 'LOG_ROOT', self: 0, total: 0, type: 'EXECUTION_STARTED' });
    const outer = createEvent({ text: 'Outer', self: 10, total: 200, parent: root });
    const s1 = createEvent({
      text: 'Search',
      self: 20,
      total: 150,
      parent: outer,
      dmlSelf: 1,
      dmlTotal: 6,
      soqlSelf: 2,
      soqlTotal: 8,
      dmlRowSelf: 5,
      dmlRowTotal: 15,
      soqlRowSelf: 3,
      soqlRowTotal: 12,
    });
    const s2 = createEvent({
      text: 'Search',
      self: 30,
      total: 100,
      parent: s1,
      dmlSelf: 2,
      dmlTotal: 4,
      soqlSelf: 1,
      soqlTotal: 5,
      dmlRowSelf: 4,
      dmlRowTotal: 8,
      soqlRowSelf: 2,
      soqlRowTotal: 6,
    });
    createEvent({
      text: 'Search',
      self: 40,
      total: 40,
      parent: s2,
      dmlSelf: 1,
      dmlTotal: 1,
      soqlSelf: 1,
      soqlTotal: 1,
      dmlRowSelf: 2,
      dmlRowTotal: 2,
      soqlRowSelf: 1,
      soqlRowTotal: 1,
    });
    createEvent({
      text: 'Search',
      self: 50,
      total: 50,
      parent: outer,
      dmlSelf: 3,
      dmlTotal: 3,
      soqlSelf: 4,
      soqlTotal: 4,
      dmlRowSelf: 7,
      dmlRowTotal: 7,
      soqlRowSelf: 5,
      soqlRowTotal: 5,
    });

    const rows = toBottomUpTree(root.children);
    assertPartitionInvariant(rows);

    const search = findRowByText(rows, 'Search');
    // Global: no bottom-up row may exceed the outermost totals of any metric.
    expect(search.totalTime).toBeLessThanOrEqual(outer.duration.total);
  });

  it('expands methods to callers (parents), not callees (children)', () => {
    const root = createEvent({ text: 'LOG_ROOT', self: 0, total: 300, type: 'EXECUTION_STARTED' });

    const callerA = createEvent({ text: 'CallerA', self: 10, total: 120, parent: root });
    const methodBFromA = createEvent({ text: 'MethodB', self: 25, total: 100, parent: callerA });
    createEvent({ text: 'LeafD', self: 35, total: 35, parent: methodBFromA });

    const callerC = createEvent({ text: 'CallerC', self: 12, total: 90, parent: root });
    createEvent({ text: 'MethodB', self: 30, total: 70, parent: callerC });

    const rows = toBottomUpTree(root.children);
    const methodB = findRowByText(rows, 'MethodB');
    const callers = methodB._children ?? [];

    const callerNames = callers.map((row) => row.text).sort();
    expect(callerNames).toEqual(['CallerA', 'CallerC']);
    expect(callers.some((row) => row.text === 'LeafD')).toBe(false);
  });

  it('includes zero-time frames so DML/SOQL/exception counts and callCount roll up', () => {
    const root = createEvent({ text: 'LOG_ROOT', self: 0, total: 0, type: 'EXECUTION_STARTED' });
    // Frame with no timing but a DML and a thrown exception — must still contribute.
    createEvent({
      text: 'LimitOnly',
      self: 0,
      total: 0,
      parent: root,
      dmlSelf: 1,
      dmlTotal: 1,
      thrown: 1,
    });

    const rows = toBottomUpTree(root.children);
    const limitOnly = findRowByText(rows, 'LimitOnly');
    expect(limitOnly.callCount).toBe(1);
    expect(limitOnly.dmlCount.self).toBe(1);
    expect(limitOnly.totalThrownCount).toBe(1);
  });
});

describe('toAggregatedCallTree', () => {
  beforeEach(() => {
    nextTimestamp = 1;
  });

  it('includes zero-time frames so DML/SOQL/exception counts and callCount roll up', () => {
    const root = createEvent({ text: 'LOG_ROOT', self: 0, total: 0, type: 'EXECUTION_STARTED' });
    createEvent({
      text: 'LimitOnly',
      self: 0,
      total: 0,
      parent: root,
      soqlSelf: 2,
      soqlTotal: 2,
    });

    const rows = toAggregatedCallTree(root.children);
    const limitOnly = findRowByText(rows, 'LimitOnly');
    expect(limitOnly.callCount).toBe(1);
    expect(limitOnly.soqlCount.self).toBe(2);
  });
});
