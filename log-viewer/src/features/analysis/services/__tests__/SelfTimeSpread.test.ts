/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { beforeEach, describe, expect, it } from '@jest/globals';
import type { ApexLog, LogEvent } from 'apex-log-parser';

import { computeSelfTimeSpread, getSelfTimeSpread } from '../SelfTimeSpread.js';

let nextIndex = 0;

/** One timed call of `text`, in the shape the two passes read. */
function call(text: string, self: number): LogEvent {
  return {
    type: 'METHOD_ENTRY',
    text,
    namespace: 'default',
    category: 'Apex',
    eventIndex: nextIndex++,
    duration: { total: self, self },
  } as unknown as LogEvent;
}

function logOf(events: LogEvent[]): ApexLog {
  return { eventsById: events } as unknown as ApexLog;
}

/** `count` calls of `text`, each of `self`. */
function calls(text: string, count: number, self: number): LogEvent[] {
  return Array.from({ length: count }, () => call(text, self));
}

describe('computeSelfTimeSpread', () => {
  beforeEach(() => {
    nextIndex = 0;
  });

  it('gives no reading for a log that timed nothing', () => {
    const spread = computeSelfTimeSpread(logOf([call('A', 0), call('B', -5)]));

    expect(spread.concentration).toBeNull();
    expect(spread.lanes).toEqual([]);
    expect(spread.singles).toEqual([]);
  });

  it('counts how few signatures hold most of the self time', () => {
    // 90 of 100: the first two signatures pass 80% between them.
    const spread = computeSelfTimeSpread(
      logOf([...calls('A', 2, 30), ...calls('B', 2, 15), ...calls('C', 2, 5)]),
    );

    expect(spread.concentration).toEqual({ signatures: 2, total: 3 });
  });

  it('ranks the signatures by self time and keeps the one-off calls apart', () => {
    const spread = computeSelfTimeSpread(
      logOf([...calls('Small', 2, 1), ...calls('Big', 2, 50), call('Once', 900)]),
    );

    // A histogram needs more than one call, so a one-off gets a row of its own.
    expect(spread.lanes.map((row) => row.text)).toEqual(['Big', 'Small']);
    expect(spread.singles).toEqual([
      { text: 'Once', category: 'Apex', eventIndex: 4, selfTime: 900 },
    ]);
    // The one-off still counts against the log, so it holds 90% on its own.
    expect(spread.concentration).toEqual({ signatures: 1, total: 3 });
  });

  it('names only the costliest one-off calls', () => {
    const spread = computeSelfTimeSpread(
      logOf([call('A', 4), call('B', 3), call('C', 2), call('D', 1)]),
    );

    expect(spread.singles.map((row) => row.text)).toEqual(['A', 'B', 'C']);
  });

  it('reads the shape of a signature whose calls are all alike', () => {
    const spread = computeSelfTimeSpread(logOf(calls('Steady', 4, 10)));

    const row = spread.lanes[0]!;
    expect(row).toMatchObject({ count: 4, selfTime: 40, median: 10, p95: 10, max: 10 });
    // Every call sits at the top of the scale, so the shape is one bin.
    expect(row.bins.filter((count) => count > 0)).toEqual([4]);
    expect(row.bins[row.bins.length - 1]).toBe(4);
  });

  it('separates one slow call from the many quick ones', () => {
    const spread = computeSelfTimeSpread(logOf([...calls('Spiky', 9, 2), call('Spiky', 200)]));

    const row = spread.lanes[0]!;
    expect(row).toMatchObject({ count: 10, median: 2, p95: 200, max: 200 });
    // Nine calls near nothing, one at the top: the verdict the average hides.
    expect(row.bins[0]).toBe(9);
    expect(row.bins[row.bins.length - 1]).toBe(1);
    // The bins draw against the fullest, so the nine set the top of the lane.
    expect(row.heights[0]).toBe(100);
  });

  it('keeps a bin holding one call visible beside a bin holding many', () => {
    const spread = computeSelfTimeSpread(logOf([...calls('Spiky', 40, 2), call('Spiky', 200)]));

    const row = spread.lanes[0]!;
    // One call in forty is 2.5% of the fullest bin: too little to see, so it floors.
    expect(row.heights[row.heights.length - 1]).toBe(10);
  });

  it('points at the worst call of the signature', () => {
    const events = [...calls('Spiky', 3, 2), call('Spiky', 90)];
    const spread = computeSelfTimeSpread(logOf(events));

    expect(spread.lanes[0]?.eventIndex).toBe(3);
  });

  it('ignores the untimed calls, so the count says what it measured', () => {
    const spread = computeSelfTimeSpread(logOf([...calls('Mixed', 3, 0), ...calls('Mixed', 2, 5)]));

    expect(spread.lanes[0]).toMatchObject({ count: 2, selfTime: 10 });
  });

  it('leaves the log root out, since no grid row stands for it', () => {
    const root = call('LOG_ROOT', 500);
    const log = Object.assign(root, { eventsById: [root, ...calls('A', 2, 10)] });

    const spread = computeSelfTimeSpread(log as unknown as ApexLog);

    expect(spread.singles).toEqual([]);
    expect(spread.lanes.map((row) => row.text)).toEqual(['A']);
    expect(spread.concentration).toEqual({ signatures: 1, total: 1 });
  });

  it('reads the same log once', () => {
    const log = logOf(calls('A', 2, 10));

    expect(getSelfTimeSpread(log)).toBe(getSelfTimeSpread(log));
  });
});
