/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { SOSL_ROWS_PER_QUERY_LIMIT, soslRowsMetric } from '../limits.js';

describe('soslRowsMetric', () => {
  it('degrades to "limit n/a" (used null, no ceiling, no note) with no cumulative snapshot', () => {
    const metric = soslRowsMetric(500, 0, false);
    expect(metric.used).toBeNull();
    expect(metric.limit).toBe(0);
    expect(metric.note).toBeUndefined();
  });

  it('derives the ceiling from soslQueries.limit × per-query cap when a snapshot is present', () => {
    const metric = soslRowsMetric(500, 20, true);
    expect(metric.used).toBe(500);
    expect(metric.limit).toBe(20 * SOSL_ROWS_PER_QUERY_LIMIT);
    expect(metric.note).toContain('max per transaction');
  });

  it('shows no ceiling when a snapshot exists but the SOSL-query limit is 0', () => {
    const metric = soslRowsMetric(500, 0, true);
    expect(metric.used).toBe(500); // count is trusted (snapshot present)
    expect(metric.limit).toBe(0); // but no meaningful ceiling to meter against
    expect(metric.note).toBeUndefined();
  });
});
