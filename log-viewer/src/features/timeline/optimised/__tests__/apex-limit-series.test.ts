/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';
import type { ApexLog } from 'apex-log-parser';

import { emptyLimits } from '../../../../components/__tests__/limitsTestUtils.js';
import { apexLimitTimeSeries } from '../apex-limit-series.js';

const aLog = (logIssues: ApexLog['logIssues']) =>
  ({
    children: [],
    logIssues,
    governorLimits: {
      snapshots: [{ timestamp: 1_000, namespace: 'default', limits: emptyLimits() }],
    },
  }) as unknown as ApexLog;

describe('apexLimitTimeSeries', () => {
  it('carries the spans the log recorded nothing in, for every surface that draws it', () => {
    const series = apexLimitTimeSeries(
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

  it('reports no gaps for a log that recorded throughout', () => {
    expect(apexLimitTimeSeries(aLog([])).gaps).toEqual([]);
  });
});
