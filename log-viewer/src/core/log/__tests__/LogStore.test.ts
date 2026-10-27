/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { indexesOf, indexOf, rawStoreOf, storeOf } from '#test-helpers/apexLog.js';
import type { LogIndex } from '../LogIndex.js';
import {
  currentLogStore,
  filterByLevels,
  LogStore,
  logStoreFor,
  setCurrentLog,
} from '../LogStore.js';

describe('LogStore', () => {
  it('resolves stack by eventIndex when timestamps are duplicated', async () => {
    const { log, store } = await storeOf(
      '09:18:22.6 (7000000)|METHOD_ENTRY|[1]|01p|ns.ClassOne.first()\n' +
        '09:18:22.6 (7100000)|METHOD_EXIT|[1]|ns.ClassOne.first()\n' +
        '09:18:22.6 (7000000)|METHOD_ENTRY|[2]|01p|ns.ClassTwo.second()\n' +
        '09:18:22.6 (7200000)|METHOD_EXIT|[2]|ns.ClassTwo.second()\n',
    );
    const [methodTwo] = indexesOf(log, 'ns.ClassTwo.second()');

    const stack = store.stackByEventIndex(methodTwo!);
    expect(stack[stack.length - 1]?.text).toBe('ns.ClassTwo.second()');
  });

  it('gives one log one store, whichever view asks', async () => {
    const { log } = await storeOf('');

    expect(logStoreFor(log)).toBe(logStoreFor(log));
    expect(setCurrentLog(logStoreFor(log))).toBe(currentLogStore());
    expect(currentLogStore()?.log).toBe(log);
  });

  // A path given leaf-first, or without the event itself, opens the wrong row.
  it('gives the ids from the top of the log down to an event, the event last', async () => {
    const { log, store } = await rawStoreOf(
      '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.Outer.run()\n' +
        '09:18:22.6 (1100)|METHOD_ENTRY|[2]|01p|ns.Inner.go()\n' +
        '09:18:22.6 (1150)|USER_DEBUG|[3]|DEBUG|hello\n' +
        '09:18:22.6 (1200)|METHOD_EXIT|[2]|ns.Inner.go()\n' +
        '09:18:22.6 (1300)|METHOD_EXIT|[1]|ns.Outer.run()\n',
    );
    const outer = indexOf(log, 'ns.Outer.run()');
    const inner = indexOf(log, 'ns.Inner.go()');
    const debug = indexOf(log, 'DEBUG | hello');

    expect(store.pathTo(debug)).toEqual([outer, inner, debug]);
    expect(store.pathTo(0)).toEqual([]);
  });

  it('links a log filtered by level to the store of the log as captured', async () => {
    const { store } = await storeOf(
      '09:18:22.6 (1000)|SOQL_EXECUTE_BEGIN|[2]|Aggregations:0|SELECT Id FROM Account\n' +
        '09:18:22.6 (1200)|SOQL_EXECUTE_END|[2]|Rows:1\n',
      '64.0 APEX_CODE,FINEST;APEX_PROFILING,NONE;DB,FINEST\n',
    );
    const filtered = (await filterByLevels(store, { database: 'WARN' }))!; // no signal, so never null

    expect(store.captured).toBe(store);
    expect(filtered.captured).toBe(store);
    expect(store.levelGap('queries')).toBeNull();
    expect(filtered.levelGap('queries')).toMatchObject({ kind: 'filtered', chosen: 'WARN' });
  });
});

describe('LogStore.derive', () => {
  const LOG = '09:18:22.6 (1000)|SOQL_EXECUTE_BEGIN|[2]|Aggregations:0|SELECT Id FROM Account\n';
  const rowCount = (index: LogIndex) => index.rowCount;
  const categoryNames = (index: LogIndex) => index.categoryNames;

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('runs a derivation once per log and shares it with every caller', async () => {
    const { store } = await storeOf(LOG);
    const derive = jest.fn(rowCount);

    const [first, second] = await Promise.all([store.derive(derive), store.derive(derive)]);

    const { rowCount: rows } = await store.logIndex();
    expect(first).toBe(rows);
    expect(second).toBe(rows);
    expect(derive).toHaveBeenCalledTimes(1);
  });

  it('keeps each derivation apart', async () => {
    const { store } = await storeOf(LOG);

    const index = await store.logIndex();

    expect(await store.derive(rowCount)).toBe(index.rowCount);
    expect(await store.derive(categoryNames)).toBe(index.categoryNames);
  });

  it('forgets a failed derivation, so the next caller runs it again', async () => {
    const { store } = await storeOf(LOG);
    const failure = new Error('index build failed');
    jest.spyOn(LogStore.prototype, 'logIndex').mockRejectedValueOnce(failure);

    await expect(store.derive(rowCount)).rejects.toBe(failure);
    expect(await store.derive(rowCount)).toBe((await store.logIndex()).rowCount);
  });

  it('forgets a derivation that throws', async () => {
    const { store } = await storeOf(LOG);
    const failure = new Error('derivation failed');
    const derive = jest.fn(rowCount).mockImplementationOnce(() => {
      throw failure;
    });

    await expect(store.derive(derive)).rejects.toBe(failure);
    expect(await store.derive(derive)).toBe((await store.logIndex()).rowCount);
  });
});
