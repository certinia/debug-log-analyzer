/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 * @jest-environment jsdom
 */
import formatDuration from '../core/utility/Util.js';

describe('Format duration tests', () => {
  it('Value converted from nanoseconds to milliseconds', () => {
    expect(formatDuration(1000)).toBe('0.001 ms');
  });
  it('Value always has 3dp', () => {
    expect(formatDuration(1000000)).toBe('1.000 ms');
  });
  it('Value truncated at 3dp', () => {
    expect(formatDuration(1234567)).toBe('1.234 ms');
  });
  it('pads microseconds correctly for short durations', () => {
    expect(formatDuration(5)).toBe('0.000 ms');
    expect(formatDuration(50)).toBe('0.000 ms');
    expect(formatDuration(500)).toBe('0.000 ms');
  });
});

describe('Adds out off suffix', () => {
  it('rounds up to 0dp', () => {
    expect(formatDuration(1000, 2_000_600_000)).toBe('0.001/2001 ms');
  });

  it('handles zero duration and total', () => {
    expect(formatDuration(0, 0)).toBe('0.000 ms');
  });

  it('handles zero duration with totalNs', () => {
    expect(formatDuration(0, 1_000_000)).toBe('0.000/1 ms');
  });

  it('handles large duration and totalNs', () => {
    expect(formatDuration(12_345_678_900, 123_456_789_000)).toBe('12345.678/123457 ms');
  });
});
