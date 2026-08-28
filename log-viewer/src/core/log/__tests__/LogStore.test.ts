/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';
import { parse } from 'apex-log-parser';

import { currentLogStore, logStoreFor, setCurrentLog } from '../LogStore.js';

describe('LogStore', () => {
  it('Only DML and SOQL are collected', () => {
    const log =
      '09:18:22.6 (6508409)|USER_INFO|[EXTERNAL]|0050W000006W3LM|user@example.com|Greenwich Mean Time|GMT+01:00\n' +
      '09:18:22.6 (6574780)|EXECUTION_STARTED\n' +
      '09:18:22.6 (6586704)|CODE_UNIT_STARTED|[EXTERNAL]|066d0000002m8ij|pse.VFRemote: pse.SenchaTCController invoke(saveTimecard)\n' +
      '17:33:36.2 (1672655920)|SOQL_EXECUTE_BEGIN|[198]|Aggregations:0|SELECT Id FROM Account\n' +
      '17:33:36.2 (1678684460)|SOQL_EXECUTE_END|[198]|Rows:3\n' +
      '07:54:17.2 (1684126610)|DML_BEGIN|[774]|Op:Insert|Type:codaCompany__c|Rows:2\n' +
      '09:19:13.82 (51592737891)|CODE_UNIT_FINISHED|pse.VFRemote: pse.SenchaTCController invoke(saveTimecard)\n' +
      '09:19:13.82 (51595120059)|EXECUTION_FINISHED\n';

    const store = logStoreFor(parse(log));

    const firstSOQL = store.soqlLines()[0];
    expect(firstSOQL?.text).toEqual('SELECT Id FROM Account');

    const firstDML = store.dmlLines()[0];
    expect(firstDML?.text).toEqual('DML Op:Insert Type:codaCompany__c');
    expect(firstDML?.sObjectType).toEqual('codaCompany__c');
  });

  it('collects SOSL statements', () => {
    const log =
      '09:18:22.6 (6574780)|EXECUTION_STARTED\n' +
      '09:18:22.6 (6586704)|CODE_UNIT_STARTED|[EXTERNAL]|066d0000002m8ij|apex://pkg.Entry\n' +
      '17:33:36.2 (1672655920)|SOSL_EXECUTE_BEGIN|[12]|FIND :searchQuery RETURNING Account(Id, Name)\n' +
      '17:33:36.2 (1678684460)|SOSL_EXECUTE_END|[12]|Rows:5\n' +
      '09:18:22.6 (7300000)|CODE_UNIT_FINISHED|apex://pkg.Entry\n' +
      '09:18:22.6 (7400000)|EXECUTION_FINISHED\n';

    const soslLines = logStoreFor(parse(log)).soslLines();

    expect(soslLines.length).toEqual(1);
    expect(soslLines[0]?.soslRowCount.self).toEqual(5);
  });

  it('resolves stack by eventIndex when timestamps are duplicated', () => {
    const log =
      '09:18:22.6 (6574780)|EXECUTION_STARTED\n' +
      '09:18:22.6 (6586704)|CODE_UNIT_STARTED|[EXTERNAL]|066d0000002m8ij|apex://pkg.Entry\n' +
      '09:18:22.6 (7000000)|METHOD_ENTRY|[1]|01p|ns.ClassOne.first()\n' +
      '09:18:22.6 (7100000)|METHOD_EXIT|[1]|ns.ClassOne.first()\n' +
      '09:18:22.6 (7000000)|METHOD_ENTRY|[2]|01p|ns.ClassTwo.second()\n' +
      '09:18:22.6 (7200000)|METHOD_EXIT|[2]|ns.ClassTwo.second()\n' +
      '09:18:22.6 (7300000)|CODE_UNIT_FINISHED|apex://pkg.Entry\n' +
      '09:18:22.6 (7400000)|EXECUTION_FINISHED\n';

    const apexLog = parse(log);
    const store = logStoreFor(apexLog);
    const methodTwo = apexLog.eventsById.find((evt) => evt.text === 'ns.ClassTwo.second()');

    expect(methodTwo).toBeDefined();
    const stack = store.stackByEventIndex(methodTwo!.eventIndex);
    expect(stack[stack.length - 1]?.text).toBe('ns.ClassTwo.second()');
  });

  it('gives a frame one interned key, and tells the two vocabularies apart', () => {
    const log =
      '09:18:22.6 (6574780)|EXECUTION_STARTED\n' +
      '09:18:22.6 (6586704)|CODE_UNIT_STARTED|[EXTERNAL]|066d0000002m8ij|ns.Thing.run()\n' +
      '09:19:13.82 (51592737891)|CODE_UNIT_FINISHED|ns.Thing.run()\n' +
      '09:19:13.82 (51595120059)|EXECUTION_FINISHED\n';

    const apexLog = parse(log);
    const store = logStoreFor(apexLog);
    const unit = apexLog.eventsById.find((event) => event.text === 'ns.Thing.run()')!;

    // Asked twice, kept once — the mark reads the same frame per occurrence.
    expect(store.keyIdOf(unit)).toBe(store.keyIdOf(unit));
    // The bucket key carries the event type and the stack key does not, so a
    // frame's two ids are not the same id.
    expect(store.stackIdOf(unit)).not.toBe(store.keyIdOf(unit));
  });

  it('keys a frame the log index does not cover', () => {
    const apexLog = parse('09:18:22.6 (6574780)|EXECUTION_STARTED\n');
    const store = logStoreFor(apexLog);
    // Built rather than parsed, so it has no slot in the log's own index.
    const loose = { type: 'METHOD_ENTRY', namespace: '', text: 'made up', eventIndex: 9999 };

    expect(store.keyIdOf(loose as never)).toBe(store.keyIdOf(loose as never));
  });

  it('gives one log one store, whichever view asks', () => {
    const log =
      '09:18:22.6 (6574780)|EXECUTION_STARTED\n' + '09:18:22.6 (7400000)|EXECUTION_FINISHED\n';

    const apexLog = parse(log);

    expect(logStoreFor(apexLog)).toBe(logStoreFor(apexLog));
    expect(setCurrentLog(apexLog)).toBe(currentLogStore());
    expect(currentLogStore()?.log).toBe(apexLog);
  });
});
