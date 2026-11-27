/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';
import { LIMIT_METRICS, type LimitMetric } from '@apexdevtools/apex-log-parser';

import { GOVERNOR_METRIC } from '../governorMetrics.js';

describe('GOVERNOR_METRIC', () => {
  it('names every parser metric, in reading order', () => {
    expect(
      Object.values(GOVERNOR_METRIC).map(({ key, label, unit }) => [key, label, unit]),
    ).toEqual([
      ['cpuTime', 'CPU Time', 'millisecond'],
      ['heapSize', 'Heap Size', 'byte'],
      ['soqlQueries', 'SOQL', 'count'],
      ['queryRows', 'SOQL Rows', 'count'],
      ['dmlStatements', 'DML', 'count'],
      ['dmlRows', 'DML Rows', 'count'],
      ['soslQueries', 'SOSL', 'count'],
      ['publishImmediateDml', 'Publish Immediate DML', 'count'],
      ['callouts', 'Callouts', 'count'],
      ['emailInvocations', 'Email Invocations', 'count'],
      ['futureCalls', 'Future Calls', 'count'],
      ['queueableJobsAddedToQueue', 'Queueable Jobs', 'count'],
      ['mobileApexPushCalls', 'Mobile Push Calls', 'count'],
    ]);
  });

  it('takes each key and unit from the parser', () => {
    const metrics = Object.entries(LIMIT_METRICS) as [LimitMetric, string][];
    for (const [key, unit] of metrics) {
      expect(GOVERNOR_METRIC[key]).toMatchObject({ key, unit });
    }
    expect(Object.keys(GOVERNOR_METRIC)).toHaveLength(metrics.length);
  });

  it('gives every metric its own strip priority', () => {
    const priorities = Object.values(GOVERNOR_METRIC).map(({ priority }) => priority);
    expect(new Set(priorities).size).toBe(priorities.length);
  });
});
