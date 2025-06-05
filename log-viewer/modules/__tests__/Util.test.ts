/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 * @jest-environment jsdom
 */
import formatDuration from '../Util.js';

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
});
