/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';

import { computeWallClockMs, formatByteSize, formatWallClockTime } from '../Util.js';

describe('formatWallClockTime', () => {
  it('should format midnight as 00:00:00.000', () => {
    expect(formatWallClockTime(0)).toBe('00:00:00.000');
  });

  it('should format a mid-day time', () => {
    // 14:30:05.122 = (14*3600 + 30*60 + 5) * 1000 + 122 = 52205122
    expect(formatWallClockTime(52205122)).toBe('14:30:05.122');
  });

  it('should format end-of-day time', () => {
    // 23:59:59.999
    expect(formatWallClockTime(86399999)).toBe('23:59:59.999');
  });

  it('should pad single-digit hours, minutes, seconds', () => {
    // 01:02:03.004
    expect(formatWallClockTime(3723004)).toBe('01:02:03.004');
  });

  it('should handle exact seconds (no fractional ms)', () => {
    // 10:00:00.000
    expect(formatWallClockTime(36000000)).toBe('10:00:00.000');
  });

  it('should handle sub-millisecond precision by rounding', () => {
    // 1000.5 ms → rounds to 1001 ms fraction → 00:00:01.001
    expect(formatWallClockTime(1000.5)).toBe('00:00:01.001');
  });
});

describe('computeWallClockMs', () => {
  it('should return startTime when event is the first event', () => {
    const result = computeWallClockMs(37764600, 6329577, 6329577);
    expect(result).toBe(37764600);
  });

  it('should compute wall-clock for a later event', () => {
    // Event is 1ms (1,000,000 ns) after first event
    const result = computeWallClockMs(37764600, 6329577, 7329577);
    expect(result).toBe(37764601);
  });

  it('should compute wall-clock for an event 1 second later', () => {
    // 1 second = 1,000,000,000 ns
    const result = computeWallClockMs(37764600, 6329577, 1006329577);
    expect(result).toBe(37765600);
  });

  it('should handle fractional nanosecond differences', () => {
    // 500,000 ns = 0.5 ms
    const result = computeWallClockMs(0, 0, 500000);
    expect(result).toBe(0.5);
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
