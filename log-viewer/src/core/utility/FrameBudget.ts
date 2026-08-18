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
  /** Hands the frame back between work slices. */
  yieldFrame: () => Promise<void>;
  /** Polled after each yield; true abandons the build, which then returns null. */
  cancelled?: () => boolean;
}

/** Returns false once the build has been abandoned. */
export type Tick = () => Promise<boolean>;

/** Resolve after the next animation frame — the usual `yieldFrame`, and what
 *  lets a just-shown host lay itself out before anything measures it. */
export function waitForNextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

/** A slice timer: cheap while the slice has time left, yields once it doesn't. */
export function frameBudget(options: FrameBudgetOptions): Tick {
  let deadline = performance.now() + SLICE_MS;
  return async () => {
    if (performance.now() < deadline) {
      return true;
    }
    await options.yieldFrame();
    deadline = performance.now() + SLICE_MS;
    return !options.cancelled?.();
  };
}
