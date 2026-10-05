/**
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';

import { inCountRange, inMsRange } from '../MinMax.js';

const NS = 1_000_000;

const BOUNDS = [
  ['matches a value within [start, end]', { start: 1, end: 10 }, 5, true],
  ['rejects a value below start', { start: 5, end: null }, 1, false],
  ['rejects a value above end', { start: null, end: 5 }, 10, false],
  ['passes everything when both bounds are null', { start: null, end: null }, 0, true],
] as const;

describe('inMsRange (durations stored in ns, compared in ms)', () => {
  it.each(BOUNDS)('%s', (_name, range, ms, expected) => {
    expect(inMsRange(range, ms * NS)).toBe(expected);
  });
});

describe('inCountRange (plain numbers, no ns→ms conversion)', () => {
  it.each(BOUNDS)('%s', (_name, range, count, expected) => {
    expect(inCountRange(range, count)).toBe(expected);
  });
});
