/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import {
  computeWallClockMs,
  formatByteSize,
  formatDuration,
  formatWallClockTime,
  isVisible,
} from '../Util.js';

describe('formatWallClockTime', () => {
  it.each([
    ['midnight', 0, '00:00:00.000'],
    ['a mid-day time', 52_205_122, '14:30:05.122'],
    ['the last millisecond of the day', 86_399_999, '23:59:59.999'],
    ['single-digit hours, minutes and seconds, padded', 3_723_004, '01:02:03.004'],
    ['an exact second, with no fraction', 36_000_000, '10:00:00.000'],
    ['a fraction of a millisecond, rounded up', 1000.5, '00:00:01.001'],
  ])('should format %s', (_case, ms, expected) => {
    expect(formatWallClockTime(ms)).toBe(expected);
  });
});

describe('computeWallClockMs', () => {
  it.each([
    ['the first event itself', 6_329_577, 37_764_600],
    ['one millisecond later', 7_329_577, 37_764_601],
    ['one second later', 1_006_329_577, 37_765_600],
  ])('should give the wall-clock time of %s', (_case, eventNs, expected) => {
    expect(computeWallClockMs(37_764_600, 6_329_577, eventNs)).toBe(expected);
  });

  it('should keep a fraction of a millisecond', () => {
    expect(computeWallClockMs(0, 0, 500000)).toBe(0.5);
  });
});

describe('formatByteSize', () => {
  it('writes megabytes with one decimal at most', () => {
    expect(formatByteSize(5_400_000)).toBe('5.4 MB');
    expect(formatByteSize(6_000_000)).toBe('6 MB');
    expect(formatByteSize(12_345_678)).toBe('12.3 MB');
  });

  it('writes kilobytes below a megabyte', () => {
    expect(formatByteSize(2_048)).toBe('2 KB');
    expect(formatByteSize(999_900)).toBe('999.9 KB');
  });

  it('writes small and negative counts as bytes', () => {
    expect(formatByteSize(0)).toBe('0 bytes');
    expect(formatByteSize(940)).toBe('940 bytes');
    // A net heap figure can be negative; the sign survives.
    expect(formatByteSize(-1_500_000)).toBe('-1.5 MB');
  });
});

describe('isVisible', () => {
  /** Observers standing, so a release can be counted. */
  let observing = 0;

  /** Reports nothing, so only the abort can settle the wait. */
  class NeverIntersects {
    observe(): void {
      observing++;
    }
    disconnect(): void {
      observing--;
    }
  }

  beforeEach(() => {
    observing = 0;
    globalThis.IntersectionObserver = NeverIntersects as unknown as typeof IntersectionObserver;
  });

  it('releases its observer where the wait is aborted', async () => {
    const controller = new AbortController();
    const waiting = isVisible({} as HTMLElement, undefined, controller.signal);

    controller.abort();

    await expect(waiting).resolves.toBe(false);
    expect(observing).toBe(0);
  });

  it('observes nothing for a signal that aborted first', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(isVisible({} as HTMLElement, undefined, controller.signal)).resolves.toBe(false);
    expect(observing).toBe(0);
  });
});

describe('formatDuration', () => {
  // Input is ns. Trailing zeros are dropped in every unit. Sub-ms rounds to 3
  // decimal places, ms and s to 2, and the seconds inside a minute to 1.
  it.each([
    [0, '0 ms'],
    [5, '0 ms'], // 0.000005 ms rounds to 0
    [50, '0 ms'], // 0.00005 ms rounds to 0
    [500, '0.001 ms'],
    [1000, '0.001 ms'],
    [1234, '0.001 ms'],
    [5000, '0.005 ms'],
    [9876, '0.01 ms'],
    [9999, '0.01 ms'],
    [10000, '0.01 ms'],
    [50000, '0.05 ms'],
    [99999, '0.1 ms'],
    [100_000, '0.1 ms'],
    [500_000, '0.5 ms'],
    [1_000_000, '1 ms'],
    [1_234_567, '1.23 ms'],
    [9_876_543, '9.88 ms'],
    [9_999_999, '10 ms'],
    [10_000_000, '10 ms'],
    [99_999_999, '100 ms'],
    [100_000_000, '100 ms'],
    [999_000_000, '999 ms'],
    [1_234_567_890, '1.23 s'],
    [5_000_000_000, '5 s'],
    [9_876_543_210, '9.88 s'],
    [59_500_000_000, '59.5 s'],
    [60_000_000_000, '1m'],
    [125_000_000_000, '2m 5s'],
    [125_500_000_000, '2m 5.5s'],
    [125_670_000_000, '2m 5.7s'],
  ])('formats %d ns as %s', (ns, expected) => {
    expect(formatDuration(ns)).toBe(expected);
  });

  it.each([
    [0, '0ms'],
    [50000, '0.05ms'],
    [1_000_000, '1ms'],
    [1_234_567, '1.23ms'],
    [100_000_000, '100ms'],
    [5_000_000_000, '5s'],
    [59_500_000_000, '59.5s'],
    [60_000_000_000, '1m'],
    [125_000_000_000, '2m5s'],
    [125_500_000_000, '2m5.5s'],
  ])('compact: formats %d ns as %s, with no spaces', (ns, expected) => {
    expect(formatDuration(ns, { compact: true })).toBe(expected);
  });
});
