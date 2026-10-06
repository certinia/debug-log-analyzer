/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ApexLog, LogEvent } from '@apexdevtools/apex-log-parser';
import { describe, expect, it } from '@jest/globals';

import { storeOf } from '#test-helpers/apexLog.js';
import { buildLogIndex, type LogIndex, NO_ROW } from '../LogIndex.js';

const NESTED =
  '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.Outer.run()\n' +
  '09:18:22.6 (1100)|STATEMENT_EXECUTE|[2]\n' +
  '09:18:22.6 (1200)|METHOD_ENTRY|[3]|01p|ns.Inner.first()\n' +
  '09:18:22.6 (1300)|SOQL_EXECUTE_BEGIN|[4]|Aggregations:0|SELECT Id FROM Account\n' +
  '09:18:22.6 (1400)|SOQL_EXECUTE_END|[4]|Rows:1\n' +
  '09:18:22.6 (1500)|METHOD_EXIT|[3]|ns.Inner.first()\n' +
  '09:18:22.6 (1600)|METHOD_ENTRY|[5]|01p|ns.Inner.second()\n' +
  '09:18:22.6 (1700)|METHOD_EXIT|[5]|ns.Inner.second()\n' +
  '09:18:22.6 (1800)|METHOD_EXIT|[1]|ns.Outer.run()\n';

/** Every event below the root, parents before children and siblings in order. */
function preOrder(log: ApexLog): LogEvent[] {
  const out: LogEvent[] = [];
  const stack = [...log.children].reverse();
  while (stack.length) {
    const event = stack.pop()!; // non-empty: the loop condition just checked
    out.push(event);
    for (let i = event.children.length - 1; i >= 0; i--) {
      stack.push(event.children[i]!);
    }
  }
  return out;
}

function childrenOf(index: LogIndex, row: number): number[] {
  const children: number[] = [];
  for (let child = row + 1; child < index.subtreeEnd[row]!; child = index.subtreeEnd[child]!) {
    children.push(child);
  }
  return children;
}

function columnsOf(index: LogIndex) {
  return {
    eventIndex: [...index.eventIndex],
    start: [...index.start],
    total: [...index.total],
    self: [...index.self],
    depth: [...index.depth],
    parent: [...index.parent],
    subtreeEnd: [...index.subtreeEnd],
    categoryId: [...index.categoryId],
  };
}

describe('LogIndex', () => {
  it('holds every tree event in pre-order, with its parent, depth and subtree', () => {
    const { log } = storeOf(NESTED);
    const index = buildLogIndex(log);
    const events = preOrder(log);

    expect(index.rowCount).toBe(events.length);
    for (let row = 0; row < index.rowCount; row++) {
      const event = index.event(row);
      expect(event).toBe(events[row]);
      const parent = index.parent[row]!;
      expect(parent === NO_ROW ? log : index.event(parent)).toBe(event.parent);
      expect(childrenOf(index, row).map((child) => index.event(child))).toEqual(event.children);
      expect(index.start[row]).toBe(event.timestamp);
      expect(index.total[row]).toBe(event.duration.total);
      expect(index.self[row]).toBe(event.duration.self);
      expect(index.categoryNames[index.categoryId[row]!]).toBe(event.category);
    }
    const run = index.rowOfEvent(events.find((event) => event.text === 'ns.Inner.first()')!);
    expect(index.depth[run]).toBe(index.depth[index.parent[run]!]! + 1);
  });

  it('ascends by eventIndex, which rowOf searches on', () => {
    const { log } = storeOf(NESTED);
    const index = buildLogIndex(log);

    for (let row = 1; row < index.rowCount; row++) {
      expect(index.eventIndex[row]!).toBeGreaterThan(index.eventIndex[row - 1]!);
    }
  });

  it('has no row for the root or an exit line', () => {
    const { log } = storeOf(NESTED);
    const index = buildLogIndex(log);
    const exit = log.eventsById.find((event) => event.type === 'METHOD_EXIT')!;

    expect(index.rowOf(0)).toBe(NO_ROW);
    expect(index.rowOf(exit.eventIndex)).toBe(NO_ROW);
    expect(index.rowOfEvent(exit)).toBe(NO_ROW);
    for (let row = 0; row < index.rowCount; row++) {
      expect(index.rowOf(index.eventIndex[row]!)).toBe(row);
    }
  });

  it('has no row for a managed package event the parser merged away', () => {
    const { log } = storeOf(
      '09:18:22.6 (300)|ENTERING_MANAGED_PKG|ns\n' +
        '09:18:22.6 (400)|ENTERING_MANAGED_PKG|ns\n' +
        '09:18:22.6 (500)|ENTERING_MANAGED_PKG|ns\n',
    );
    const index = buildLogIndex(log);
    const packages = log.eventsById.filter((event) => event.type === 'ENTERING_MANAGED_PKG');
    const inTree = new Set(preOrder(log));

    expect(packages.some((event) => !inTree.has(event))).toBe(true);
    for (const event of packages) {
      expect(index.rowOfEvent(event) !== NO_ROW).toBe(inTree.has(event));
    }
  });

  it('keeps log order when timestamps go backwards', () => {
    const { log } = storeOf(
      '09:18:22.6 (7000000)|METHOD_ENTRY|[1]|01p|ns.ClassOne.first()\n' +
        '09:18:22.6 (7100000)|METHOD_EXIT|[1]|ns.ClassOne.first()\n' +
        '09:18:22.6 (7000000)|METHOD_ENTRY|[2]|01p|ns.ClassTwo.second()\n' +
        '09:18:22.6 (7200000)|METHOD_EXIT|[2]|ns.ClassTwo.second()\n',
    );
    const index = buildLogIndex(log);
    const texts = Array.from({ length: index.rowCount }, (_, row) => index.event(row).text);

    expect(texts.indexOf('ns.ClassOne.first()')).toBeLessThan(
      texts.indexOf('ns.ClassTwo.second()'),
    );
  });
});

describe('LogStore.logIndex', () => {
  // More rows than one slice holds, so the sliced build hands back at least once.
  const MANY = Array.from(
    { length: 600 },
    (_, i) =>
      `09:18:22.6 (${1000 + i * 10})|METHOD_ENTRY|[1]|01p|ns.Loop.call()\n` +
      `09:18:22.6 (${1005 + i * 10})|METHOD_EXIT|[1]|ns.Loop.call()\n`,
  ).join('');

  it('builds the same index in slices as in one go, once', async () => {
    const { log, store } = storeOf(MANY);
    const sliced = store.logIndex({ yieldSlice: () => Promise.resolve() });

    expect(store.logIndex()).toBe(sliced);
    expect(columnsOf(await sliced)).toEqual(columnsOf(buildLogIndex(log)));
  });
});
