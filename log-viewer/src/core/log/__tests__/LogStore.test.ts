/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { indexesOf, storeOf } from '#test-helpers/apexLog.js';
import type { LogIndex } from '../LogIndex.js';
import { currentLogStore, LogStore, logStoreFor, setCurrentLog } from '../LogStore.js';

describe('LogStore', () => {
  it('resolves stack by eventIndex when timestamps are duplicated', () => {
    const { log, store } = storeOf(
      '09:18:22.6 (7000000)|METHOD_ENTRY|[1]|01p|ns.ClassOne.first()\n' +
        '09:18:22.6 (7100000)|METHOD_EXIT|[1]|ns.ClassOne.first()\n' +
        '09:18:22.6 (7000000)|METHOD_ENTRY|[2]|01p|ns.ClassTwo.second()\n' +
        '09:18:22.6 (7200000)|METHOD_EXIT|[2]|ns.ClassTwo.second()\n',
    );
    const [methodTwo] = indexesOf(log, 'ns.ClassTwo.second()');

    const stack = store.stackByEventIndex(methodTwo!);
    expect(stack[stack.length - 1]?.text).toBe('ns.ClassTwo.second()');
  });

  it('gives one log one store, whichever view asks', () => {
    const { log } = storeOf('');

    expect(logStoreFor(log)).toBe(logStoreFor(log));
    expect(setCurrentLog(log)).toBe(currentLogStore());
    expect(currentLogStore()?.log).toBe(log);
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
    const { store } = storeOf(LOG);
    const derive = jest.fn(rowCount);

    const [first, second] = await Promise.all([store.derive(derive), store.derive(derive)]);

    const { rowCount: rows } = await store.logIndex();
    expect(first).toBe(rows);
    expect(second).toBe(rows);
    expect(derive).toHaveBeenCalledTimes(1);
  });

  it('keeps each derivation apart', async () => {
    const { store } = storeOf(LOG);

    const index = await store.logIndex();

    expect(await store.derive(rowCount)).toBe(index.rowCount);
    expect(await store.derive(categoryNames)).toBe(index.categoryNames);
  });

  it('forgets a failed derivation, so the next caller runs it again', async () => {
    const { store } = storeOf(LOG);
    const failure = new Error('index build failed');
    jest.spyOn(LogStore.prototype, 'logIndex').mockRejectedValueOnce(failure);

    await expect(store.derive(rowCount)).rejects.toBe(failure);
    expect(await store.derive(rowCount)).toBe((await store.logIndex()).rowCount);
  });

  it('forgets a derivation that throws', async () => {
    const { store } = storeOf(LOG);
    const failure = new Error('derivation failed');
    const derive = jest.fn(rowCount).mockImplementationOnce(() => {
      throw failure;
    });

    await expect(store.derive(derive)).rejects.toBe(failure);
    expect(await store.derive(derive)).toBe((await store.logIndex()).rowCount);
  });
});
