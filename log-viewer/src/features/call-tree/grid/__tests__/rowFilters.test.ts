/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import {
  callTreeFilters,
  NO_FILTERS,
  RowFilterCache,
  type CallTreeFilterFields,
} from '../rowFilters.js';

interface Row {
  type: string;
  namespace: string;
  total: number;
  self: number;
}

const method: Row = { type: 'METHOD_ENTRY', namespace: 'ns', total: 5e6, self: 1e6 };
const query: Row = { type: 'SOQL_EXECUTE_BEGIN', namespace: 'ns', total: 2e6, self: 2e6 };
const debug: Row = { type: 'USER_DEBUG', namespace: 'other', total: 0, self: 0 };
const ROWS = [method, query, debug];

const UNTYPED: CallTreeFilterFields<Row> = {
  namespace: (row) => row.namespace,
  total: (row) => row.total,
  self: (row) => row.self,
  withoutDetails: { test: (row) => row.type !== 'USER_DEBUG' },
};

describe('callTreeFilters', () => {
  // Analysis has no Type or Debug Only control, so no view test reaches this.
  it('ignores type and Debug Only for a table whose rows have no type', () => {
    const inputs = { ...NO_FILTERS, details: true, type: 'SOQL_EXECUTE_BEGIN', debugOnly: true };
    const filters = callTreeFilters(inputs, UNTYPED, new RowFilterCache(), 't');

    expect(ROWS.filter((row) => filters.every((filter) => filter.test(row)))).toEqual(ROWS);
  });
});
