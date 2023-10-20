/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import { DatabaseAccess } from '../Database.js';
import parseLog, { getRootMethod } from '../parsers/TreeParserLegacy.js';

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

    await parseLog(log);
    const result = await DatabaseAccess.create(getRootMethod());
    const firstSOQL = result.getSOQLLines()[0];

    expect(firstSOQL?.text).toEqual('SELECT Id FROM Account');

    const firstDML = result.getDMLLines()[0];
    expect(firstDML?.text).toEqual('DML Op:Insert Type:codaCompany__c');
  });
});
