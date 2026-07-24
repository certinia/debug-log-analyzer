/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';
import { parse } from 'apex-log-parser';

import { DatabaseAccess } from '../features/database/services/Database.js';

describe('Analyse database tests', () => {
  it('Only DML and SOQL are collected', async () => {
    const log =
      '09:18:22.6 (6508409)|USER_INFO|[EXTERNAL]|0050W000006W3LM|user@example.com|Greenwich Mean Time|GMT+01:00\n' +
      '09:18:22.6 (6574780)|EXECUTION_STARTED\n' +
      '09:18:22.6 (6586704)|CODE_UNIT_STARTED|[EXTERNAL]|066d0000002m8ij|pse.VFRemote: pse.SenchaTCController invoke(saveTimecard)\n' +
      '17:33:36.2 (1672655920)|SOQL_EXECUTE_BEGIN|[198]|Aggregations:0|SELECT Id FROM Account\n' +
      '17:33:36.2 (1678684460)|SOQL_EXECUTE_END|[198]|Rows:3\n' +
      '07:54:17.2 (1684126610)|DML_BEGIN|[774]|Op:Insert|Type:codaCompany__c|Rows:2\n' +
      '09:19:13.82 (51592737891)|CODE_UNIT_FINISHED|pse.VFRemote: pse.SenchaTCController invoke(saveTimecard)\n' +
      '09:19:13.82 (51595120059)|EXECUTION_FINISHED\n';

    const apexLog = parse(log);
    const result = await DatabaseAccess.create(apexLog);

    const firstSOQL = result.getSOQLLines()[0];
    expect(firstSOQL?.text).toEqual('SELECT Id FROM Account');

    const firstDML = result.getDMLLines()[0];
    expect(firstDML?.text).toEqual('DML Op:Insert Type:codaCompany__c');
    expect(firstDML?.sObjectType).toEqual('codaCompany__c');
  });

  it('collects SOSL statements', async () => {
    const log =
      '09:18:22.6 (6574780)|EXECUTION_STARTED\n' +
      '09:18:22.6 (6586704)|CODE_UNIT_STARTED|[EXTERNAL]|066d0000002m8ij|apex://pkg.Entry\n' +
      '17:33:36.2 (1672655920)|SOSL_EXECUTE_BEGIN|[12]|FIND :searchQuery RETURNING Account(Id, Name)\n' +
      '17:33:36.2 (1678684460)|SOSL_EXECUTE_END|[12]|Rows:5\n' +
      '09:18:22.6 (7300000)|CODE_UNIT_FINISHED|apex://pkg.Entry\n' +
      '09:18:22.6 (7400000)|EXECUTION_FINISHED\n';

    const apexLog = parse(log);
    const result = await DatabaseAccess.create(apexLog);

    const soslLines = result.getSOSLLines();
    expect(soslLines.length).toEqual(1);
    expect(soslLines[0]?.soslRowCount.self).toEqual(5);
  });

  it('resolves stack by eventIndex when timestamps are duplicated', async () => {
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
    const result = await DatabaseAccess.create(apexLog);
    const methodTwo = apexLog.eventsById.find((evt) => evt.text === 'ns.ClassTwo.second()');

    expect(methodTwo).toBeDefined();
    const stack = result.getStackByEventIndex(methodTwo!.eventIndex);
    expect(stack[stack.length - 1]?.text).toBe('ns.ClassTwo.second()');
  });
});
