/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';

import { seekWindow } from '../utils/navigate-window.js';

const MS = 1_000_000;

describe('seekWindow', () => {
  it('takes its width from the log', () => {
    const { start, width } = seekWindow(6_000 * MS, 24_000 * MS);

    // 2% of a 24s log, centred on the instant.
    expect(width).toBe(480 * MS);
    expect(start + width / 2).toBe(6_000 * MS);
  });

  it('holds a short log at the smallest window', () => {
    expect(seekWindow(500 * MS, 1_000 * MS).width).toBe(100 * MS);
  });

  it('keeps the window inside the log at the start', () => {
    expect(seekWindow(0, 24_000 * MS).start).toBe(0);
  });
});
