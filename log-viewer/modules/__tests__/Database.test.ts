/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 * @jest-environment jsdom
 */
import { DatabaseAccess, DatabaseEntry } from '../Database';
import parseLog from '../parsers/TreeParser';
import { getRootMethod } from '../parsers/TreeParser';

describe('Analyse database tests', () => {
  it('Only DML and SOQL are collected', async () => {
    const log =
      '09:18:22.6 (6508409)|USER_INFO|[EXTERNAL]|0050W000006W3LM|jwilson@57dev.financialforce.com|Greenwich Mean Time|GMT+01:00\n' +
      '09:18:22.6 (6574780)|EXECUTION_STARTED\n' +
      '09:18:22.6 (6586704)|CODE_UNIT_STARTED|[EXTERNAL]|066d0000002m8ij|pse.VFRemote: pse.SenchaTCController invoke(saveTimecard)\n' +
      '17:33:36.2 (1672655920)|SOQL_EXECUTE_BEGIN|[198]|Aggregations:0|SELECT Id FROM Account\n' +
      '17:33:36.2 (1678684460)|SOQL_EXECUTE_END|[198]|Rows:3\n' +
      '07:54:17.2 (1684126610)|DML_BEGIN|[774]|Op:Insert|Type:codaCompany__c|Rows:2\n' +
      '09:19:13.82 (51592737891)|CODE_UNIT_FINISHED|pse.VFRemote: pse.SenchaTCController invoke(saveTimecard)\n' +
      '09:19:13.82 (51595120059)|EXECUTION_FINISHED\n';

    await parseLog(log);
    const result = await DatabaseAccess.create(getRootMethod());

    expect(result.dmlMap).toEqual(
      new Map<string, DatabaseEntry>([
        ['DML Op:Insert Type:codaCompany__c', new DatabaseEntry(1, 2, [1])],
      ])
    );

    expect(result.soqlMap).toEqual(
      new Map<string, DatabaseEntry>([
        ['SOQL: Aggregations:0 - SELECT Id FROM Account', new DatabaseEntry(1, 3, [0])],
      ])
    );
  });

  it('Aggregation traverses method trees', async () => {
    const log =
      '09:18:22.6 (6508409)|USER_INFO|[EXTERNAL]|0050W000006W3LM|jwilson@57dev.financialforce.com|Greenwich Mean Time|GMT+01:00\n' +
      '09:18:22.6 (6574780)|EXECUTION_STARTED\n' +
      '09:18:22.6 (6586704)|CODE_UNIT_STARTED|[EXTERNAL]|066d0000002m8ij|pse.VFRemote: pse.SenchaTCController invoke(saveTimecard)\n' +
      '07:54:17.2 (1684126610)|DML_BEGIN|[774]|Op:Insert|Type:codaCompany__c|Rows:1\n' +
      '17:33:36.2 (1684126611)|SOQL_EXECUTE_BEGIN|[198]|Aggregations:0|SELECT Id FROM Account\n' +
      '17:33:36.2 (1684126612)|SOQL_EXECUTE_END|[198]|Rows:1\n' +
      '07:54:17.2 (1684126613)|DML_BEGIN|[774]|Op:Insert|Type:codaCompany__c|Rows:5\n' +
      '17:33:36.2 (1684126614)|SOQL_EXECUTE_BEGIN|[198]|Aggregations:0|SELECT Id FROM Account\n' +
      '17:33:36.2 (1684126615)|SOQL_EXECUTE_END|[198]|Rows:10\n' +
      '09:19:13.82 (51592737891)|CODE_UNIT_FINISHED|pse.VFRemote: pse.SenchaTCController invoke(saveTimecard)\n' +
      '09:19:13.82 (51595120059)|EXECUTION_FINISHED\n';

    await parseLog(log);
    const result = await DatabaseAccess.create(getRootMethod());

    expect(result.dmlMap).toEqual(
      new Map<string, DatabaseEntry>([
        ['DML Op:Insert Type:codaCompany__c', new DatabaseEntry(2, 6, [0, 2])],
      ])
    );

    expect(result.soqlMap).toEqual(
      new Map<string, DatabaseEntry>([
        ['SOQL: Aggregations:0 - SELECT Id FROM Account', new DatabaseEntry(2, 11, [1, 3])],
      ])
    );
  });
});
