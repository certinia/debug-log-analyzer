/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/** Resolves after the next frame has painted: a rAF runs before paint, the task after it runs after. */
export function nextPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
}

/** Resolves once `frames` frames in a row have each come within 20ms, so deferred work is done. */
export async function settled(frames = 3, limitMs = 5000): Promise<void> {
  const start = performance.now();
  let quiet = 0;
  let last = start;
  while (quiet < frames && performance.now() - start < limitMs) {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const now = performance.now();
    quiet = now - last < 20 ? quiet + 1 : 0;
    last = now;
  }
}

export interface Timing {
  /** Start of the action to the first frame painted after it. */
  ms: number;
  /** Start of the action to the screen going quiet: deferred renders and idle work included. */
  settledMs: number;
  /** Longest single task during the action. The budget is 50ms. */
  longestTaskMs: number;
}

/** Times `action` to its first paint and to settling, and records the longest task in that span. */
export async function timed(action: () => unknown): Promise<Timing> {
  const tasks: number[] = [];
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      tasks.push(entry.duration);
    }
  });
  observer.observe({ type: 'longtask' });

  const start = performance.now();
  await action();
  await nextPaint();
  const ms = performance.now() - start;
  await settled();
  const settledMs = performance.now() - start;

  // Long tasks are delivered asynchronously; give the last one a frame to arrive.
  await nextPaint();
  observer.disconnect();
  return { ms, settledMs, longestTaskMs: Math.max(0, ...tasks) };
}

export interface FrameStats {
  frames: number;
  p50: number;
  p95: number;
  max: number;
  /** Frames over 25ms: at least one 60Hz frame missed, not timer jitter. */
  dropped: number;
}

export function frameStats(deltas: number[]): FrameStats {
  const sorted = deltas.toSorted((a, b) => a - b);
  const at = (q: number): number =>
    sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
  return {
    frames: sorted.length,
    p50: at(0.5),
    p95: at(0.95),
    max: sorted.at(-1) ?? 0,
    dropped: sorted.filter((d) => d > 25).length,
  };
}

/** Runs `step(i)` once per frame for `count` frames and returns each frame's duration. */
export async function perFrame(count: number, step: (i: number) => void): Promise<number[]> {
  const deltas: number[] = [];
  let last = await new Promise<number>((resolve) => requestAnimationFrame(resolve));
  for (let i = 0; i < count; i++) {
    step(i);
    const now = await new Promise<number>((resolve) => requestAnimationFrame(resolve));
    deltas.push(now - last);
    last = now;
  }
  return deltas;
}
