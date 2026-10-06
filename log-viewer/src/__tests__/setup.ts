/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
/**
 * jsdom implements no layout, so it ships no `ResizeObserver` either. Components that observe
 * their own size construct one on connect, so without this every such suite throws before it can
 * assert anything. A suite that needs to *drive* resizes replaces this with its own stub.
 */
class NoopResizeObserver implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

if (!('ResizeObserver' in globalThis)) {
  (globalThis as unknown as Record<string, unknown>).ResizeObserver = NoopResizeObserver;
}

// Retired: vitest's jsdom env copies node's `TextEncoder` onto the window. Re-add this (and the
// `node:util` declaration in `declarations.d.ts`) for a DOM env that does not; the parser needs it.
// import { TextEncoder } from 'node:util';
// if (!('TextEncoder' in globalThis)) {
//   (globalThis as unknown as Record<string, unknown>).TextEncoder = TextEncoder;
// }

/**
 * jsdom paces frames at 60 Hz, so every awaited frame costs 16 ms of real time. This keeps its
 * semantics without the wait: one task runs every callback queued for the frame, so a test's
 * frame and a component's frame still resolve together.
 */
if ('requestAnimationFrame' in globalThis) {
  const queued = new Map<number, FrameRequestCallback>();
  let lastHandle = 0;
  const runFrame = (): void => {
    const callbacks = [...queued.values()];
    queued.clear();
    const now = performance.now();
    callbacks.forEach((callback) => callback(now));
  };
  globalThis.requestAnimationFrame = (callback: FrameRequestCallback): number => {
    queued.set(++lastHandle, callback);
    setTimeout(runFrame, 0);
    return lastHandle;
  };
  globalThis.cancelAnimationFrame = (handle: number): void => {
    queued.delete(handle);
  };
}
