/**
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';

import { inCountRange, inMsRange } from '../MinMax.js';

const NS = 1_000_000;

describe('inMsRange (durations stored in ns, compared in ms)', () => {
  it('matches when value is within [start, end] (ms)', () => {
    expect(inMsRange({ start: 1, end: 10 }, 5 * NS)).toBe(true);
  });

  it('rejects when value is below start', () => {
    expect(inMsRange({ start: 5, end: null }, 1 * NS)).toBe(false);
  });

  it('rejects when value is above end', () => {
    expect(inMsRange({ start: null, end: 5 }, 10 * NS)).toBe(false);
  });

  it('passes everything when both bounds are null', () => {
    expect(inMsRange({ start: null, end: null }, 0)).toBe(true);
  });
});

describe('inCountRange (plain numbers, no ns→ms conversion)', () => {
  it('matches when a raw count is within [start, end]', () => {
    expect(inCountRange({ start: 1, end: 10 }, 5)).toBe(true);
  });

  it('rejects a count below start', () => {
    expect(inCountRange({ start: 5, end: null }, 1)).toBe(false);
  });

  it('rejects a count above end', () => {
    expect(inCountRange({ start: null, end: 5 }, 10)).toBe(false);
  });

  it('passes everything when both bounds are null', () => {
    expect(inCountRange({ start: null, end: null }, 0)).toBe(true);
  });
});
