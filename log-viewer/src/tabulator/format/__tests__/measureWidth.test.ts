/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { describe, expect, it } from '@jest/globals';

import { progressColumnWidth } from '../measureWidth.js';

describe('progressColumnWidth', () => {
  it('clamps to a minimum and grows with the value', () => {
    const small = progressColumnWidth(0);
    const large = progressColumnWidth(9_999_999_000_000); // ~9,999,999 ms
    expect(small).toBeGreaterThanOrEqual(110);
    expect(large).toBeGreaterThan(small);
  });
});
