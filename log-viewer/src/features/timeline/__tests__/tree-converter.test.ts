/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * Unit tests for the time range the unified conversion reports, which sets the
 * chart's own width.
 */

import { describe, expect, it } from '@jest/globals';
import type { LogEvent } from 'apex-log-parser';
import { logEventToTreeAndRects } from '../utils/tree-converter.js';

/** A root frame spanning `start` to `end`; equal stamps give it no duration. */
function event(start: number, end: number): LogEvent {
  const duration = end - start;
  return {
    text: 'event',
    type: 'METHOD_ENTRY',
    category: 'Apex',
    duration: { self: duration, total: duration },
    timestamp: start,
    exitStamp: end,
    children: [],
  } as unknown as LogEvent;
}

const categories = new Set(['Apex']);

describe('logEventToTreeAndRects totalDuration', () => {
  it('reaches the last frame when the log ends with it', () => {
    const { totalDuration } = logEventToTreeAndRects([event(0, 500)], categories, 500);

    expect(totalDuration).toBe(500);
  });

  it('reaches the log end when the frames stop short of it', () => {
    // A truncated log: the last logged frame ends long before the log does, and
    // the trailing FATAL_ERROR that closes it carries no duration of its own.
    const frames = [event(0, 500), event(2000, 2000)];

    const { totalDuration } = logEventToTreeAndRects(frames, categories, 2000);

    expect(totalDuration).toBe(2000);
  });

  it('still reaches the last frame when it outlives the given log end', () => {
    const { totalDuration } = logEventToTreeAndRects([event(0, 900)], categories, 100);

    expect(totalDuration).toBe(900);
  });
});
