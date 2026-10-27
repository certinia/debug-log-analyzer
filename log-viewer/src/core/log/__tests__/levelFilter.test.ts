/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { indexOf, storeOf } from '#test-helpers/apexLog.js';
import { type DebugLevels, hiddenByLevels, sameLevels } from '../levelFilter.js';
import { buildLogIndex, type LogIndex } from '../LogIndex.js';
import { filterByLevels, type LogStore } from '../LogStore.js';
import { rowMetrics } from '../rowMetrics.js';
import type { SoqlEvent } from '../statements.js';

const SETTINGS = '64.0 APEX_CODE,FINEST;APEX_PROFILING,NONE;DB,FINEST;SYSTEM,FINE\n';

const BODY =
  '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.Outer.run()\n' +
  '09:18:22.6 (2000)|USER_DEBUG|[2]|DEBUG|hello\n' +
  '09:18:22.6 (3000)|METHOD_ENTRY|[3]|01p|ns.Inner.go()\n' +
  '09:18:22.6 (4000)|SOQL_EXECUTE_BEGIN|[4]|Aggregations:0|SELECT Id FROM Account\n' +
  '09:18:22.6 (5000)|SOQL_EXECUTE_END|[4]|Rows:2\n' +
  '09:18:22.6 (5500)|EXCEPTION_THROWN|[5]|System.NullPointerException: boom\n' +
  '09:18:22.6 (6000)|METHOD_EXIT|[3]|ns.Inner.go()\n' +
  '09:18:22.6 (7000)|USER_DEBUG|[8]|DEBUG|bye\n' +
  '09:18:22.6 (8000)|METHOD_EXIT|[1]|ns.Outer.run()\n';

const yieldSlice = (): Promise<void> => Promise.resolve();

async function storeOfBody(body = BODY, settings = SETTINGS): Promise<LogStore> {
  return (await storeOf(body, settings)).store;
}

/** More events than one slice reads, so a build takes several. */
function longBody(): string {
  const debug = Array.from(
    { length: 300 },
    (_, i) => `09:18:22.6 (${2000 + i})|USER_DEBUG|[2]|DEBUG|line ${i}\n`,
  ).join('');
  return (
    '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.Outer.run()\n' +
    debug +
    '09:18:22.6 (9000)|METHOD_EXIT|[1]|ns.Outer.run()\n'
  );
}

async function shown(store: LogStore, chosen: DebugLevels): Promise<LogStore> {
  return (await filterByLevels(store, chosen, { yieldSlice }))!; // no signal, so never null
}

function childrenOf(index: LogIndex, row: number): number[] {
  const children: number[] = [];
  for (let child = row + 1; child < index.subtreeEnd[row]!; child = index.subtreeEnd[child]!) {
    children.push(child);
  }
  return children;
}

function typesOf(index: LogIndex): string[] {
  return Array.from({ length: index.rowCount }, (_, row) => index.event(row).type);
}

function sum(values: ArrayLike<number>): number {
  let total = 0;
  for (let i = 0; i < values.length; i++) {
    total += values[i]!; // i < length
  }
  return total;
}

describe('filterByLevels', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('gives the captured store when no level is lowered', async () => {
    const store = await storeOfBody();

    expect(await shown(store, { ...store.log.debugLevels })).toBe(store);
  });

  it('gives the captured store when a lowered level hides nothing', async () => {
    const store = await storeOfBody();

    expect(await shown(store, { apexCode: 'FINER' })).toBe(store);
  });

  it('hoists kept events to the nearest kept ancestor, in log order', async () => {
    const index = await (await shown(await storeOfBody(), { apexCode: 'DEBUG' })).logIndex();
    const codeUnit = typesOf(index).indexOf('CODE_UNIT_STARTED');

    expect(childrenOf(index, codeUnit).map((row) => index.event(row).type)).toEqual([
      'USER_DEBUG',
      'SOQL_EXECUTE_BEGIN',
      'EXCEPTION_THROWN',
      'USER_DEBUG',
    ]);
    for (let row = 0; row < index.rowCount; row++) {
      const parent = index.parent[row]!;
      expect(parent === -1 || childrenOf(index, parent).includes(row)).toBe(true);
      expect(index.depth[row]).toBe(parent === -1 ? 0 : index.depth[parent]! + 1);
    }
  });

  it('hides a USER_DEBUG line by the level it was written at', async () => {
    const store = await storeOfBody(
      '09:18:22.6 (1000)|USER_DEBUG|[1]|ERROR|kept\n' +
        '09:18:22.6 (2000)|USER_DEBUG|[2]|FINEST|hidden\n',
    );

    const debugs = [...(await shown(store, { apexCode: 'INFO' })).events()].filter(
      (event) => event.type === 'USER_DEBUG',
    );

    expect(debugs.map((event) => event.text)).toEqual(['ERROR | kept']);
  });

  it.each([
    ['keeps', 'INFO', true],
    ['hides', 'NONE', false],
  ] as const)('%s a query plan with its query, at DB %s', async (_verb, database, kept) => {
    const store = await storeOfBody(
      '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.Outer.run()\n' +
        '09:18:22.6 (2000)|SOQL_EXECUTE_BEGIN|[2]|Aggregations:0|SELECT Id FROM Account\n' +
        '09:18:22.6 (2100)|SOQL_EXECUTE_EXPLAIN|[2]|Index on Account : [Id], cardinality: 1, sobjectCardinality: 10, relativeCost 0.1\n' +
        '09:18:22.6 (3000)|SOQL_EXECUTE_END|[2]|Rows:1\n' +
        '09:18:22.6 (4000)|METHOD_EXIT|[1]|ns.Outer.run()\n',
    );

    const query = [...(await shown(store, { apexCode: 'DEBUG', database })).events()].find(
      (event) => event.type === 'SOQL_EXECUTE_BEGIN',
    ) as SoqlEvent | undefined;

    expect(query !== undefined && query.details.explain !== null).toBe(kept);
  });

  it('keeps namespace limit usage with its limit block, and only there', async () => {
    const store = await storeOfBody(
      '09:18:22.6 (1000)|TESTING_LIMITS\n' +
        '09:18:22.6 (1100)|LIMIT_USAGE_FOR_NS|(default)|\n' +
        '  Number of SOQL queries: 2 out of 100\n' +
        '09:18:22.6 (3000)|CUMULATIVE_LIMIT_USAGE\n' +
        '09:18:22.6 (3100)|LIMIT_USAGE_FOR_NS|(default)|\n' +
        '  Number of SOQL queries: 1 out of 100\n' +
        '09:18:22.6 (3200)|CUMULATIVE_LIMIT_USAGE_END\n',
      '64.0 APEX_CODE,FINEST;APEX_PROFILING,FINEST;DB,FINEST\n',
    );

    const usage = [...(await shown(store, { apexProfiling: 'INFO' })).events()].filter(
      (event) => event.type === 'LIMIT_USAGE_FOR_NS',
    );

    expect(usage.map((event) => event.parent?.type)).toEqual(['CUMULATIVE_LIMIT_USAGE']);
  });

  it('keeps the self sum of the tree', async () => {
    const store = await storeOfBody();
    const before = await store.logIndex();

    const after = await (await shown(store, { apexCode: 'DEBUG', database: 'ERROR' })).logIndex();

    expect(after.rowCount).toBeLessThan(before.rowCount);
    expect(sum(after.self)).toBe(sum(before.self));
    expect(sum(rowMetrics(after).soqlCount.self)).toBe(sum(rowMetrics(before).soqlCount.self));
  });

  it('folds a hidden statement count into its parent', async () => {
    const store = await storeOfBody();
    const inner = indexOf(store.log, 'ns.Inner.go()');

    const index = await (await shown(store, { database: 'ERROR' })).logIndex();
    const row = index.rowOf(inner);

    expect(rowMetrics(index).soqlCount.self[row]).toBe(1);
    expect(
      childrenOf(index, row).some((child) => index.event(child).type === 'SOQL_EXECUTE_BEGIN'),
    ).toBe(false);
  });

  it('does not change the captured log', async () => {
    const store = await storeOfBody();
    const before = buildLogIndex(store.log);

    await (await shown(store, { apexCode: 'NONE', database: 'NONE' })).logIndex();

    const after = buildLogIndex(store.log);
    expect(after.rowCount).toBe(before.rowCount);
    expect([...after.self]).toEqual([...before.self]);
  });

  it('finds no event or stack at a hidden id, and no row for it', async () => {
    const store = await storeOfBody();
    const inner = indexOf(store.log, 'ns.Inner.go()');

    const filtered = await shown(store, { apexCode: 'DEBUG' });

    expect(filtered.eventByIndex(inner)).toBeNull();
    expect(filtered.stackByEventIndex(inner)).toEqual([]);
    expect((await filtered.logIndex()).rowOf(inner)).toBe(-1);
  });

  it('lists every kept event and none that is hidden', async () => {
    const store = await storeOfBody();
    const inner = indexOf(store.log, 'ns.Inner.go()');

    const filtered = await shown(store, { apexCode: 'DEBUG' });
    const listed = [...filtered.events()].map((event) => event.id);
    const index = await filtered.logIndex();

    expect(listed).not.toContain(inner);
    expect(listed).toEqual([...index.eventIndex]);
  });

  it('drops hidden exceptions and keeps the entry points', async () => {
    const store = await storeOfBody();

    const kept = await shown(store, { apexCode: 'DEBUG' });
    const hidden = await shown(store, { apexCode: 'WARN' });

    expect(kept.exceptions.map((event) => event.id)).toEqual(
      store.exceptions.map((event) => event.id),
    );
    expect(hidden.exceptions).toHaveLength(0);
    expect(hidden.entryPoints.map((event) => event.id)).toEqual(
      store.entryPoints.map((event) => event.id),
    );
  });

  it('reports the chosen levels as the levels shown, and keeps the captured ones', async () => {
    const store = await storeOfBody();

    const filtered = await shown(store, { apexCode: 'DEBUG' });

    expect(filtered.debugLevels).toEqual({
      apexCode: 'DEBUG',
      apexProfiling: 'NONE',
      database: 'FINEST',
      system: 'FINE',
    });
    expect(filtered.log.debugLevels.apexCode).toBe('FINEST');
    expect(filtered.captured).toBe(store);
  });

  it('hides the same events across many slices as in one', async () => {
    const { log } = await storeOf(longBody(), SETTINGS);
    let now = 0;
    const whole = await hiddenByLevels(log, { apexCode: 'INFO' });
    jest.spyOn(performance, 'now').mockImplementation(() => (now += 1000));

    const sliced = await hiddenByLevels(log, { apexCode: 'INFO' }, { yieldSlice });

    expect(sliced && [...sliced]).toEqual(whole && [...whole]);
  });

  it('gives up once the signal aborts', async () => {
    const store = await storeOfBody(longBody());
    const build = new AbortController();
    build.abort();
    let now = 0;
    jest.spyOn(performance, 'now').mockImplementation(() => (now += 1000));

    expect(
      await filterByLevels(store, { apexCode: 'DEBUG' }, { yieldSlice, signal: build.signal }),
    ).toBeNull();
  });

  it('compares levels by category', () => {
    expect(sameLevels({ apexCode: 'FINE' }, { apexCode: 'FINE' })).toBe(true);
    expect(sameLevels({ apexCode: 'FINE' }, { apexCode: 'DEBUG' })).toBe(false);
    expect(sameLevels({ apexCode: 'FINE' }, { apexCode: 'FINE', database: 'INFO' })).toBe(false);
  });
});
