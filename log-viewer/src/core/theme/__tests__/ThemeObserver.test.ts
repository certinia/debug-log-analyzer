/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { getThemeKind, themeObserver } from '../ThemeObserver.js';

/**
 * Lets jsdom deliver the queued MutationObserver records (a microtask), then runs
 * the frame the observer coalesces them into.
 */
async function flushFrame(): Promise<void> {
  await Promise.resolve();
  jest.advanceTimersByTime(32);
}

describe('getThemeKind', () => {
  afterEach(() => {
    document.body.className = '';
  });

  it('reads the kind from the webview body class', () => {
    document.body.className = 'vscode-light';
    expect(getThemeKind()).toBe('light');

    document.body.className = 'vscode-dark';
    expect(getThemeKind()).toBe('dark');
  });

  it('prefers the high contrast variants over the plain kind', () => {
    // The preload sets both, so the more specific class has to win.
    document.body.className = 'vscode-high-contrast vscode-dark';
    expect(getThemeKind()).toBe('high-contrast');

    document.body.className = 'vscode-high-contrast-light vscode-high-contrast vscode-light';
    expect(getThemeKind()).toBe('high-contrast-light');
  });

  it('falls back to the OS preference with no body class', () => {
    // jsdom's matchMedia always reports no match, so light is never preferred.
    expect(getThemeKind()).toBe('dark');
  });
});

describe('themeObserver', () => {
  let unsubscribe: (() => void) | null = null;

  beforeEach(() => {
    jest.useFakeTimers();
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
    jest.useRealTimers();
  });

  it('notifies with the new kind when the body class changes', async () => {
    const listener = jest.fn();
    unsubscribe = themeObserver.on(listener);

    document.body.className = 'vscode-light';
    await flushFrame();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith('light');
  });

  it('notifies when the injected --vscode-* block is re-applied', async () => {
    const listener = jest.fn();
    unsubscribe = themeObserver.on(listener);

    document.documentElement.style.setProperty('--vscode-editor-background', '#ffffff');
    await flushFrame();

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('coalesces a burst of mutations into one notification', async () => {
    const listener = jest.fn();
    unsubscribe = themeObserver.on(listener);

    document.documentElement.style.setProperty('--vscode-editor-background', '#ffffff');
    document.documentElement.style.setProperty('--vscode-editor-foreground', '#000000');
    document.body.className = 'vscode-light';
    document.body.dataset.vscodeThemeKind = 'vscode-light';
    await flushFrame();

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('stops notifying once unsubscribed', async () => {
    const listener = jest.fn();
    themeObserver.on(listener)();

    document.body.className = 'vscode-light';
    await flushFrame();

    expect(listener).not.toHaveBeenCalled();
  });

  it('keeps notifying the remaining listeners when one unsubscribes', async () => {
    const kept = jest.fn();
    const dropped = jest.fn();
    unsubscribe = themeObserver.on(kept);
    themeObserver.on(dropped)();

    document.body.className = 'vscode-light';
    await flushFrame();

    expect(kept).toHaveBeenCalledTimes(1);
    expect(dropped).not.toHaveBeenCalled();
  });
});
