/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/** Work slice before the frame is handed back (ms) — half a 60fps frame, so a
 *  build never takes more than half of any frame it runs in. */
const SLICE_MS = 8;

/** Items between deadline checks. Reading the clock per item costs more than
 *  the odd overrun it saves. */
export const CHECK_EVERY = 256;

export interface FrameBudgetOptions {
  /** Hands the thread back between work slices. Defaults to
   *  {@link waitForNextTask}, which is what a walk wants. */
  yieldSlice?: () => Promise<void>;
  /** Aborting it abandons the build, which then returns null. */
  signal?: AbortSignal;
}

/** Returns false once the build has been abandoned. */
export type Tick = () => Promise<boolean>;

/** Resolve after the next animation frame: what lets a just-shown host lay
 *  itself out before anything measures it. */
export function waitForNextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

/** Resolve after the next task. A frame yield hands back a whole frame per 8ms
 *  slice, which caps a walk at half the machine; a task yield costs about
 *  nothing, and the slice is short enough that paint still gets in. */
export function waitForNextTask(): Promise<void> {
  return new Promise((resolve) => {
    // A channel per yield rather than one shared: a live port with a handler
    // holds Node's event loop open, and this module is loaded outside a browser.
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}

/** A slice timer: cheap while the slice has time left, yields once it doesn't. */
export function frameBudget(options: FrameBudgetOptions): Tick {
  const yieldSlice = options.yieldSlice ?? waitForNextTask;
  let deadline = performance.now() + SLICE_MS;
  return async () => {
    if (performance.now() < deadline) {
      return true;
    }
    await yieldSlice();
    deadline = performance.now() + SLICE_MS;
    return !options.signal?.aborted;
  };
}
