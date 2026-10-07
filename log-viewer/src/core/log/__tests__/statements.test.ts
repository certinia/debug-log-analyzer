/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';

import { storeOf } from '#test-helpers/apexLog.js';
import { statements } from '../statements.js';

describe('statements', () => {
  it('collects SOQL and DML statements', async () => {
    const { store } = storeOf(
      '17:33:36.2 (1672655920)|SOQL_EXECUTE_BEGIN|[198]|Aggregations:0|SELECT Id FROM Account\n' +
        '17:33:36.2 (1678684460)|SOQL_EXECUTE_END|[198]|Rows:3\n' +
        '07:54:17.2 (1684126610)|DML_BEGIN|[774]|Op:Insert|Type:codaCompany__c|Rows:2\n',
    );
    const { soql, dml } = await store.derive(statements);

    expect(soql[0]?.text).toEqual('SELECT Id FROM Account');
    expect(dml[0]?.text).toEqual('DML Op:Insert Type:codaCompany__c');
    expect(dml[0]?.sObjectType).toEqual('codaCompany__c');
  });

  it('collects SOSL statements', async () => {
    const { store } = storeOf(
      '17:33:36.2 (1672655920)|SOSL_EXECUTE_BEGIN|[12]|FIND :searchQuery RETURNING Account(Id, Name)\n' +
        '17:33:36.2 (1678684460)|SOSL_EXECUTE_END|[12]|Rows:5\n',
    );
    const { sosl } = await store.derive(statements);

    expect(sosl.length).toEqual(1);
    expect(sosl[0]?.soslRowCount.self).toEqual(5);
  });

  it('gives the row of every statement, nested ones included, in log order', async () => {
    const { store } = storeOf(
      '09:18:22.6 (1000)|DML_BEGIN|[1]|Op:Insert|Type:Account|Rows:1\n' +
        '09:18:22.6 (2000)|SOQL_EXECUTE_BEGIN|[2]|Aggregations:0|SELECT Id FROM Contact\n' +
        '09:18:22.6 (3000)|SOQL_EXECUTE_END|[2]|Rows:1\n' +
        '09:18:22.6 (4000)|DML_END|[1]\n' +
        '09:18:22.6 (5000)|SOSL_EXECUTE_BEGIN|[3]|FIND :term RETURNING Account(Id)\n' +
        '09:18:22.6 (6000)|SOSL_EXECUTE_END|[3]|Rows:0\n',
    );
    const { rows } = await store.derive(statements);
    const index = await store.logIndex();

    expect(rows.map((row) => index.event(row).text)).toEqual([
      'DML Op:Insert Type:Account',
      'SELECT Id FROM Contact',
      'SOSL: FIND :term RETURNING Account(Id)',
    ]);
  });
});
