/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/** Work slice before the thread is handed back: half a 60fps frame. */
const SLICE_MS = 8;

/** Items between clock reads. Reading the clock per item costs more than the odd overrun. */
export const CHECK_EVERY = 256;

/**
 * How core shares the thread. Core has no DOM, so the host supplies both: in a page,
 * `performance.now` and `scheduler.yield`; in a test, a clock that never runs out.
 */
export interface Scheduler {
  now(): number;
  yield(): Promise<void>;
}

/** Never yields: every step finishes in one go. For tests and small grids. */
export const immediateScheduler: Scheduler = {
  now: () => 0,
  yield: () => Promise.resolve(),
};

/**
 * A slice timer for one long step. Call it every {@link CHECK_EVERY} items; it yields
 * once the slice is spent, and resolves false once `cancelled` says the step is stale.
 */
export function sliceTimer(scheduler: Scheduler, cancelled: () => boolean): () => Promise<boolean> {
  let deadline = scheduler.now() + SLICE_MS;
  return async () => {
    if (scheduler.now() < deadline) {
      return !cancelled();
    }
    await scheduler.yield();
    deadline = scheduler.now() + SLICE_MS;
    return !cancelled();
  };
}
