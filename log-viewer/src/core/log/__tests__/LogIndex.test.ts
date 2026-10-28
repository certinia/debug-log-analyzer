/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ApexEvent, ApexLog } from '@apexdevtools/apex-log-parser';
import { describe, expect, it } from '@jest/globals';

import { storeOf } from '#test-helpers/apexLog.js';
import { buildLogIndex, type LogIndex, NO_ROW, sharedChildRows } from '../LogIndex.js';

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

/** Every event below the log, parents before children and siblings in order, by walking the tree. */
function preOrder(log: ApexLog): ApexEvent[] {
  const out: ApexEvent[] = [];
  const stack = [...log.children].reverse();
  while (stack.length) {
    const event = stack.pop()!; // non-empty: the loop condition just checked
    out.push(event);
    stack.push(...event.children.toReversed());
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
    eventId: [...index.eventId],
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
  it('holds every tree event in pre-order, with its parent, depth, subtree and category', async () => {
    const { log } = await storeOf(NESTED);
    const index = buildLogIndex(log);
    const events = preOrder(log);

    expect(index.rowCount).toBe(events.length);
    events.forEach((event, row) => {
      expect(index.eventId[row]).toBe(event.id);
      const parent = index.parent[row]!;
      expect(parent === NO_ROW ? null : index.eventId[parent]).toBe(event.parent?.id ?? null);
      expect(childrenOf(index, row).map((child) => index.eventId[child])).toEqual(
        event.children.map((child) => child.id),
      );
      expect(index.depth[row]).toBe(event.depth - 1);
      expect(index.start[row]).toBe(event.startTimestamp);
      expect(index.end[row]).toBe(event.endTimestamp);
      expect(index.total[row]).toBe(event.duration.total);
      expect(index.self[row]).toBe(event.duration.self);
    });
    const category = (type: string) =>
      index.categoryNames[index.categoryId[events.findIndex((event) => event.type === type)]!];
    expect(category('METHOD_ENTRY')).toBe('Apex');
    expect(category('SOQL_EXECUTE_BEGIN')).toBe('SOQL');
    expect(category('STATEMENT_EXECUTE')).toBe('Apex');
  });

  it('finds the row of every event by id, and none for the log or an unknown id', async () => {
    const { log } = await storeOf(NESTED);
    const index = buildLogIndex(log);

    expect(index.rowOf(0)).toBe(NO_ROW);
    expect(index.rowOf(log.eventCount + 1)).toBe(NO_ROW);
    for (let row = 0; row < index.rowCount; row++) {
      expect(index.rowOf(index.eventId[row]!)).toBe(row);
    }
  });

  it('reads a column of the parse by row', async () => {
    const { log } = await storeOf(NESTED);
    const index = buildLogIndex(log);

    const lines = index.column(log.columns.lineNumber);

    expect(lines[index.rowOf(log.ofType('SOQL_EXECUTE_BEGIN')[0]!.id)]).toBe(4);
  });

  it('keeps log order when timestamps go backwards', async () => {
    const { log } = await storeOf(
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
    const { log, store } = await storeOf(MANY);
    const sliced = store.logIndex({ yieldSlice: () => Promise.resolve() });

    expect(store.logIndex()).toBe(sliced);
    expect(columnsOf(await sliced)).toEqual(columnsOf(buildLogIndex(log)));
  });
});

describe('sharedChildRows', () => {
  // A window edge reads the same wide parent on every frame of a drag.
  const WIDE =
    '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.Outer.run()\n' +
    Array.from(
      { length: 100 },
      (_, i) =>
        `09:18:22.6 (${1001 + i * 10})|METHOD_ENTRY|[2]|01p|ns.Inner.call()\n` +
        `09:18:22.6 (${1005 + i * 10})|METHOD_EXIT|[2]|ns.Inner.call()\n`,
    ).join('') +
    '09:18:22.6 (3000)|METHOD_EXIT|[1]|ns.Outer.run()\n';

  const outerOf = (index: LogIndex): number =>
    Array.from({ length: index.rowCount }, (_, row) => row).find(
      (row) => index.event(row).text === 'ns.Outer.run()',
    )!;
  const typesOf = (index: LogIndex, rows: readonly number[]): string[] =>
    rows.map((row) => index.event(row).type);

  it('walks a wide row once, then hands back the same list', async () => {
    const { log } = await storeOf(WIDE);
    const index = buildLogIndex(log);
    const outer = outerOf(index);
    const first = sharedChildRows(index, outer);

    expect(typesOf(index, first)).toEqual(Array(100).fill('METHOD_ENTRY'));
    expect(sharedChildRows(index, outer)).toBe(first);
  });

  it('reads the rows under a narrow row', async () => {
    const { log } = await storeOf(NESTED);
    const index = buildLogIndex(log);

    // The query sits under Inner.first, not beside it.
    expect(typesOf(index, sharedChildRows(index, outerOf(index)))).toEqual([
      'STATEMENT_EXECUTE',
      'METHOD_ENTRY',
      'METHOD_ENTRY',
    ]);
  });
});
