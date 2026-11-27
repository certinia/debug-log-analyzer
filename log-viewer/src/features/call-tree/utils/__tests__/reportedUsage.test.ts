/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';

import { seriesEvent, timeSeries } from '#test-helpers/limits.js';
import { emptyReported, ReportedUsage, WHOLE_LOG, type TimeSpan } from '../reportedUsage.js';

/** A series of SOQL levels: each point is `[timestamp, used]`. */
const soqlSeries = (...points: [number, number][]) =>
  timeSeries(points.map(([at, used]) => seriesEvent(at, { soqlQueries: { used, limit: 100 } })));

/** A row from `startTimestamp` to `endTimestamp`; a null end is a row with no duration. */
const row = (startTimestamp: number, endTimestamp: number | null): TimeSpan => ({
  startTimestamp,
  endTimestamp: endTimestamp ?? startTimestamp,
});

describe('ReportedUsage', () => {
  it('gives a point to the row that starts at it, not the one that ends there', () => {
    const usage = new ReportedUsage(soqlSeries([10, 1], [20, 2], [30, 3], [40, 4]));

    // Rows meeting at 20 and at 40: the one from 20 to 40 holds the queries at 20 and 30.
    expect(usage.span(row(10, 20))?.soqlQueries).toBe(1);
    expect(usage.delta('soqlQueries', row(20, 40))).toBe(2);
    expect(usage.span(row(40, 50))?.soqlQueries).toBe(1);
  });

  it('gives nothing to a row with no duration, though it sits on a point', () => {
    // A CUMULATIVE_LIMIT_USAGE line reports the change; its ancestors made it.
    const usage = new ReportedUsage(soqlSeries([20, 3]));

    expect(usage.span(row(20, 20))).toBeNull();
    expect(usage.span(row(20, null))).toBeNull();
    expect(usage.delta('soqlQueries', row(20, null))).toBe(0);
    expect(usage.span(row(10, 30))?.soqlQueries).toBe(3);
  });

  it('includes a cumulative correction reported inside the row', () => {
    // Two queries seen, then the code unit's cumulative block says 12 in all.
    const usage = new ReportedUsage(soqlSeries([10, 1], [20, 2], [30, 12]));

    expect(usage.delta('soqlQueries', row(5, 35))).toBe(12);
  });

  it('is null for a metric the log never reported', () => {
    const usage = new ReportedUsage(soqlSeries([10, 1]));

    expect(usage.delta('dmlRows', WHOLE_LOG)).toBeNull();
  });

  it('is 0 for a row before the first point', () => {
    const usage = new ReportedUsage(soqlSeries([10, 1], [20, 2]));

    expect(usage.delta('soqlQueries', row(0, 9))).toBe(0);
  });

  it('gives every metric of a row, 0 for the ones the log never reported', () => {
    const usage = new ReportedUsage(soqlSeries([10, 1], [20, 3]));

    expect(usage.span(row(0, 25))).toEqual({ ...emptyReported(), soqlQueries: 3 });
  });

  it('gives no counts for a row that holds no point', () => {
    const usage = new ReportedUsage(soqlSeries([10, 1], [20, 2]));

    expect(usage.span(row(11, 19))).toBeNull();
  });

  it('gives zero counts, not null, for a row whose points made no change', () => {
    // A null span lets the builds skip every row inside it, so a point must never read as null.
    const usage = new ReportedUsage(soqlSeries([10, 1], [20, 1]));

    expect(usage.span(row(15, 25))).toEqual(emptyReported());
  });
});
