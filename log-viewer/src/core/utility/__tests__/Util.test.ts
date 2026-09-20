/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';

import { computeWallClockMs, formatByteSize, formatWallClockTime } from '../Util.js';

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
