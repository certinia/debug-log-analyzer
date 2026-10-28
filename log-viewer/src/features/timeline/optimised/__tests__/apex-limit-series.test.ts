/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';

import { rawStoreOf, storeOf } from '#test-helpers/apexLog.js';
import type { HeatStripTimeSeries } from '../../types/flamechart.types.js';
import { apexLimitSeries } from '../apex-limit-series.js';

/** Two methods, with `between` written between them. */
async function seriesOf(between: string): Promise<HeatStripTimeSeries> {
  const { store } = await rawStoreOf(
    '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.A.run()\n' +
      '09:18:22.6 (2000)|METHOD_EXIT|[1]|ns.A.run()\n' +
      between +
      '09:18:22.6 (5000)|METHOD_ENTRY|[1]|01p|ns.B.run()\n' +
      '09:18:22.6 (6000)|METHOD_EXIT|[1]|ns.B.run()\n',
  );
  return store.derive(apexLimitSeries);
}

describe('apexLimitSeries', () => {
  it('carries the spans the log recorded nothing in, for every surface that draws it', async () => {
    const series = await seriesOf('*** Skipped 12345 bytes of detailed log\n');

    expect(series.gaps).toHaveLength(1);
    expect(series.gaps?.[0]).toMatchObject({ startTime: 2_000, endTime: 5_000 });
  });

  it('reads the usage of statements and allocations nested at any depth', async () => {
    const { store } = await storeOf(
      '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.Outer.run()\n' +
        '09:18:22.6 (1100)|HEAP_ALLOCATE|[2]|Bytes:40\n' +
        '09:18:22.6 (1200)|SOQL_EXECUTE_BEGIN|[3]|Aggregations:0|SELECT Id FROM Account\n' +
        '09:18:22.6 (1300)|SOQL_EXECUTE_END|[3]|Rows:2\n' +
        '09:18:22.6 (1400)|METHOD_EXIT|[1]|ns.Outer.run()\n',
    );

    const last = (await store.derive(apexLimitSeries)).events.at(-1)?.values;

    expect(last?.get('soqlQueries')?.used).toBe(1);
    expect(last?.get('queryRows')?.used).toBe(2);
    expect(last?.get('heapSize')?.used).toBe(40);
  });

  it('folds readings tied in time in the order a last-child-first walk meets them', async () => {
    // The statement is the later sibling, so its count lands before the block's own report.
    const { store } = await storeOf(
      '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|Outer.run()\n' +
        '09:18:22.6 (1100)|LIMIT_USAGE|[2]|SOQL|5|100\n' +
        '09:18:22.6 (1100)|SOQL_EXECUTE_BEGIN|[3]|Aggregations:0|SELECT Id FROM Account\n' +
        '09:18:22.6 (1200)|SOQL_EXECUTE_END|[3]|Rows:0\n' +
        '09:18:22.6 (1300)|METHOD_EXIT|[1]|Outer.run()\n',
    );

    const last = (await store.derive(apexLimitSeries)).events.at(-1)?.values;

    expect(last?.get('soqlQueries')?.used).toBe(5);
  });

  it('reports no gaps for a log that recorded throughout', async () => {
    expect((await seriesOf('')).gaps).toEqual([]);
  });
});
