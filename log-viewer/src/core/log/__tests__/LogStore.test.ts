/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { indexesOf, storeOf } from '#test-helpers/apexLog.js';
import type { LogIndex } from '../LogIndex.js';
import { currentLogStore, LogStore, logStoreFor, setCurrentLog } from '../LogStore.js';

describe('LogStore', () => {
  it('Only DML and SOQL are collected', () => {
    const { store } = storeOf(
      '17:33:36.2 (1672655920)|SOQL_EXECUTE_BEGIN|[198]|Aggregations:0|SELECT Id FROM Account\n' +
        '17:33:36.2 (1678684460)|SOQL_EXECUTE_END|[198]|Rows:3\n' +
        '07:54:17.2 (1684126610)|DML_BEGIN|[774]|Op:Insert|Type:codaCompany__c|Rows:2\n',
    );

    const firstSOQL = store.soqlLines()[0];
    expect(firstSOQL?.text).toEqual('SELECT Id FROM Account');

    const firstDML = store.dmlLines()[0];
    expect(firstDML?.text).toEqual('DML Op:Insert Type:codaCompany__c');
    expect(firstDML?.sObjectType).toEqual('codaCompany__c');
  });

  it('collects SOSL statements', () => {
    const soslLines = storeOf(
      '17:33:36.2 (1672655920)|SOSL_EXECUTE_BEGIN|[12]|FIND :searchQuery RETURNING Account(Id, Name)\n' +
        '17:33:36.2 (1678684460)|SOSL_EXECUTE_END|[12]|Rows:5\n',
    ).store.soslLines();

    expect(soslLines.length).toEqual(1);
    expect(soslLines[0]?.soslRowCount.self).toEqual(5);
  });

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
