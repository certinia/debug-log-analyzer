/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';

import {
  computeWallClockMs,
  formatByteSize,
  formatDuration,
  formatWallClockTime,
} from '../Util.js';

describe('formatWallClockTime', () => {
  it.each([
    ['midnight', 0, '00:00:00.000'],
    ['a mid-day time', 52205122, '14:30:05.122'],
    ['the end of the day', 86399999, '23:59:59.999'],
    ['single-digit hours, minutes and seconds, padded', 3723004, '01:02:03.004'],
    ['exact seconds, with no fractional ms', 36000000, '10:00:00.000'],
    ['sub-millisecond precision, rounded up', 1000.5, '00:00:01.001'],
  ])('formats %s', (_case, ms, expected) => {
    expect(formatWallClockTime(ms)).toBe(expected);
  });
});

describe('computeWallClockMs', () => {
  // The first event: stamped FIRST_NS, on the wall clock at START_MS.
  const START_MS = 37764600;
  const FIRST_NS = 6329577;

  it.each([
    ['the first event itself', FIRST_NS, START_MS],
    ['an event 1ms later', FIRST_NS + 1_000_000, START_MS + 1],
    ['an event 1s later', FIRST_NS + 1_000_000_000, START_MS + 1000],
  ])('reads %s', (_case, timestamp, expected) => {
    expect(computeWallClockMs(START_MS, FIRST_NS, timestamp)).toBe(expected);
  });

  it('keeps a fractional millisecond', () => {
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

describe('Format duration tests', () => {
  it('Shows ms with decimals for very small values (sub-millisecond)', () => {
    expect(formatDuration(5)).toBe('0 ms'); // 0.000005 ms rounds to 0
    expect(formatDuration(50)).toBe('0 ms'); // 0.00005 ms rounds to 0
    expect(formatDuration(500)).toBe('0.001 ms');
    expect(formatDuration(1000)).toBe('0.001 ms');
    expect(formatDuration(5000)).toBe('0.005 ms');
    expect(formatDuration(9999)).toBe('0.01 ms');
    expect(formatDuration(10000)).toBe('0.01 ms');
    expect(formatDuration(50000)).toBe('0.05 ms');
    expect(formatDuration(99999)).toBe('0.1 ms');
  });

  it('handles ms duration', () => {
    expect(formatDuration(100_000)).toBe('0.1 ms');
    expect(formatDuration(500_000)).toBe('0.5 ms');
    expect(formatDuration(1_000_000)).toBe('1 ms');
    expect(formatDuration(1_234_567)).toBe('1.23 ms');
    expect(formatDuration(9_999_999)).toBe('10 ms');
    expect(formatDuration(10_000_000)).toBe('10 ms');
    expect(formatDuration(99_999_999)).toBe('100 ms');
    expect(formatDuration(100_000_000)).toBe('100 ms');
    expect(formatDuration(999_000_000)).toBe('999 ms');
  });

  it('handles zero duration', () => {
    expect(formatDuration(0)).toBe('0 ms');
  });

  it('handles seconds', () => {
    expect(formatDuration(5_000_000_000)).toBe('5 s');
    expect(formatDuration(59_500_000_000)).toBe('59.5 s');
  });

  it('handles minutes and seconds', () => {
    expect(formatDuration(60_000_000_000)).toBe('1m');
    expect(formatDuration(125_000_000_000)).toBe('2m 5s');
    expect(formatDuration(125_500_000_000)).toBe('2m 5.5s');
  });

  it('handles remove trailing 0 for all units types', () => {
    expect(formatDuration(5000)).toBe('0.005 ms');
    expect(formatDuration(100_000)).toBe('0.1 ms');
    expect(formatDuration(5_000_000_000)).toBe('5 s');
    expect(formatDuration(60_000_000_000)).toBe('1m');
  });

  it('handles rounding to appropriate precision', () => {
    // sub-milliseconds (up to 3 decimal places)
    expect(formatDuration(1234)).toBe('0.001 ms');
    expect(formatDuration(9876)).toBe('0.01 ms');

    // milliseconds (up to 2 decimal places)
    expect(formatDuration(1_234_567)).toBe('1.23 ms');
    expect(formatDuration(9_876_543)).toBe('9.88 ms');

    // seconds (up to 2 decimal places)
    expect(formatDuration(1_234_567_890)).toBe('1.23 s');
    expect(formatDuration(9_876_543_210)).toBe('9.88 s');
  });

  it('rounds to 1dp for min and s', () => {
    // minutes with fractional seconds
    expect(formatDuration(125_670_000_000)).toBe('2m 5.7s');
  });

  describe('compact option', () => {
    it('omits spaces for milliseconds', () => {
      expect(formatDuration(0, { compact: true })).toBe('0ms');
      expect(formatDuration(50000, { compact: true })).toBe('0.05ms');
      expect(formatDuration(1_000_000, { compact: true })).toBe('1ms');
      expect(formatDuration(1_234_567, { compact: true })).toBe('1.23ms');
      expect(formatDuration(100_000_000, { compact: true })).toBe('100ms');
    });

    it('omits spaces for seconds', () => {
      expect(formatDuration(5_000_000_000, { compact: true })).toBe('5s');
      expect(formatDuration(59_500_000_000, { compact: true })).toBe('59.5s');
    });

    it('omits spaces for minutes', () => {
      expect(formatDuration(60_000_000_000, { compact: true })).toBe('1m');
      expect(formatDuration(125_000_000_000, { compact: true })).toBe('2m5s');
      expect(formatDuration(125_500_000_000, { compact: true })).toBe('2m5.5s');
    });
  });
});
