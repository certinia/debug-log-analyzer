/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it, jest } from '@jest/globals';

import { frameBudget, waitForNextTask } from '../FrameBudget.js';

describe('waitForNextTask', () => {
  it('resolves without an animation frame, which is the whole point', async () => {
    // A frame that never comes: awaiting one here would hang the test.
    globalThis.requestAnimationFrame = () => 0;

    await expect(waitForNextTask()).resolves.toBeUndefined();
  });
});

describe('frameBudget', () => {
  it('yields once the slice is spent, and reports an abandoned build', async () => {
    const controller = new AbortController();
    const yieldSlice = jest.fn(() => Promise.resolve());
    // Runs the clock past the 8ms slice, so the next tick must yield.
    const now = jest.spyOn(performance, 'now');
    now.mockReturnValue(0);
    const tick = frameBudget({ yieldSlice, signal: controller.signal });

    expect(await tick()).toBe(true);
    expect(yieldSlice).not.toHaveBeenCalled();

    now.mockReturnValue(100);
    expect(await tick()).toBe(true);
    expect(yieldSlice).toHaveBeenCalledTimes(1);

    now.mockReturnValue(200);
    controller.abort();
    expect(await tick()).toBe(false);
    now.mockRestore();
  });
});
