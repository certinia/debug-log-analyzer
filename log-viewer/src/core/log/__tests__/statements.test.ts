/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';

import { storeOf } from '#test-helpers/apexLog.js';
import { statements } from '../statements.js';

describe('statements', () => {
  it('gives the row of every statement, nested ones included, in log order', async () => {
    const { store } = await storeOf(
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
