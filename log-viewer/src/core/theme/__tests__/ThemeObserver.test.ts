/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { themeObserver } from '../ThemeObserver.js';

/**
 * Lets jsdom deliver the queued MutationObserver records (a microtask), then runs
 * the frame the observer coalesces them into.
 */
async function flushFrame(): Promise<void> {
  await Promise.resolve();
  vi.advanceTimersByTime(32);
}

describe('themeObserver', () => {
  let unsubscribe: (() => void) | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    // jsdom has no rAF timing of its own worth relying on; drive it off timers.
    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) =>
      setTimeout(() => callback(0), 16) as unknown as number) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = ((handle: number) =>
      clearTimeout(
        handle as unknown as ReturnType<typeof setTimeout>,
      )) as typeof cancelAnimationFrame;
  });

  afterEach(() => {
    unsubscribe?.();
    unsubscribe = null;
    document.body.className = '';
    document.documentElement.removeAttribute('style');
    vi.useRealTimers();
  });

  it('notifies when the body theme class changes', async () => {
    const listener = vi.fn();
    unsubscribe = themeObserver.on(listener);

    document.body.className = 'vscode-light';
    await flushFrame();

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('notifies when the injected --vscode-* block is re-applied', async () => {
    const listener = vi.fn();
    unsubscribe = themeObserver.on(listener);

    document.documentElement.style.setProperty('--vscode-editor-background', '#ffffff');
    await flushFrame();

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('coalesces a burst of mutations into one notification', async () => {
    const listener = vi.fn();
    unsubscribe = themeObserver.on(listener);

    document.documentElement.style.setProperty('--vscode-editor-background', '#ffffff');
    document.documentElement.style.setProperty('--vscode-editor-foreground', '#000000');
    document.body.className = 'vscode-light';
    document.body.dataset.vscodeThemeKind = 'vscode-light';
    await flushFrame();

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('stops notifying once unsubscribed', async () => {
    const listener = vi.fn();
    themeObserver.on(listener)();

    document.body.className = 'vscode-light';
    await flushFrame();

    expect(listener).not.toHaveBeenCalled();
  });

  it('keeps notifying the remaining listeners when one unsubscribes', async () => {
    const kept = vi.fn();
    const dropped = vi.fn();
    unsubscribe = themeObserver.on(kept);
    themeObserver.on(dropped)();

    document.body.className = 'vscode-light';
    await flushFrame();

    expect(kept).toHaveBeenCalledTimes(1);
    expect(dropped).not.toHaveBeenCalled();
  });
});
