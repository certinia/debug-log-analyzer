/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { Scheduler } from '../core/index.js';

interface YieldingScheduler {
  yield?: () => Promise<void>;
}

const native = (globalThis as { scheduler?: YieldingScheduler }).scheduler;

/** A task-queue turn: lets input and paint run, unlike a microtask. */
function macrotask(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => resolve();
    channel.port2.postMessage(null);
  });
}

/**
 * Hands the thread back between slices of a long step. `scheduler.yield` resumes ahead of
 * other tasks, so the step finishes sooner; Firefox and Safari lack it and take a task.
 */
export const browserScheduler: Scheduler = {
  now: () => performance.now(),
  yield: native?.yield ? () => (native.yield as () => Promise<void>).call(native) : macrotask,
};
