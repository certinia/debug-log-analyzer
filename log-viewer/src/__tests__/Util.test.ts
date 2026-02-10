/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import { formatDuration } from '../core/utility/Util.js';

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
