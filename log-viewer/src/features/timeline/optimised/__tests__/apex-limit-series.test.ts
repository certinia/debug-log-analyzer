/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';
import type { ApexLog } from '@apexdevtools/apex-log-parser';

import { storeOf } from '#test-helpers/apexLog.js';
import { emptyLimits } from '#test-helpers/limits.js';
import { logStoreFor } from '../../../../core/log/LogStore.js';
import { apexLimitSeries } from '../apex-limit-series.js';

const aLog = (logIssues: ApexLog['logIssues']) =>
  ({
    children: [],
    eventsById: [],
    logIssues,
    governorLimits: {
      snapshots: [{ timestamp: 1_000, namespace: 'default', limits: emptyLimits() }],
    },
  }) as unknown as ApexLog;

const seriesOf = (log: ApexLog) => logStoreFor(log).derive(apexLimitSeries);

describe('apexLimitSeries', () => {
  it('carries the spans the log recorded nothing in, for every surface that draws it', async () => {
    const series = await seriesOf(
      aLog([
        {
          type: 'skip',
          startTime: 2_000,
          endTime: 5_000,
          summary: 'Skipped 12 lines',
          description: 'The log hit its size cap',
        },
      ]),
    );

    expect(series.gaps).toHaveLength(1);
    expect(series.gaps?.[0]).toMatchObject({ startTime: 2_000, endTime: 5_000 });
  });

  it('reads the usage of statements and allocations nested at any depth', async () => {
    const { store } = storeOf(
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

  it('reports no gaps for a log that recorded throughout', async () => {
    expect((await seriesOf(aLog([]))).gaps).toEqual([]);
  });
});
