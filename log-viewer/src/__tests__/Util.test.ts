/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import { formatDuration } from '../core/utility/Util.js';

describe('Format duration tests', () => {
  it('Shows µs for very small values', () => {
    expect(formatDuration(5)).toBe('0.01 µs');
    expect(formatDuration(50)).toBe('0.05 µs');
    expect(formatDuration(500)).toBe('0.5 µs');
    expect(formatDuration(1000)).toBe('1 µs');
    expect(formatDuration(5000)).toBe('5 µs');
    expect(formatDuration(9999)).toBe('10 µs');
    expect(formatDuration(10000)).toBe('10 µs');
  });

  it('handles ms duration', () => {
    expect(formatDuration(100_000)).toBe('0.1 ms');
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
    expect(formatDuration(5000)).toBe('5 µs');
    expect(formatDuration(100_000)).toBe('0.1 ms');
    expect(formatDuration(5_000_000_000)).toBe('5 s');
    expect(formatDuration(60_000_000_000)).toBe('1m');
  });

  it('handles rounding to 2dp for µs, ms, s', () => {
    // microseconds
    expect(formatDuration(1234)).toBe('1.23 µs');
    expect(formatDuration(9876)).toBe('9.88 µs');

    // milliseconds
    expect(formatDuration(1_234_567)).toBe('1.23 ms');
    expect(formatDuration(9_876_543)).toBe('9.88 ms');

    // seconds
    expect(formatDuration(1_234_567_890)).toBe('1.23 s');
    expect(formatDuration(9_876_543_210)).toBe('9.88 s');
  });

  it('rounds to 1dp for min and s', () => {
    // minutes with fractional seconds
    expect(formatDuration(125_670_000_000)).toBe('2m 5.7s');
  });
});
