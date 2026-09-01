/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * Timing and heap helpers shared by the measure scripts.
 *
 * Heap figures need `--expose-gc`, which the `measure` scripts pass.
 */

const gc = globalThis.gc as (() => void) | undefined;

/** Heap after a collection, so a figure is what the step retained, not its litter. */
export function heapMb(): number {
  gc?.();
  return Math.round(process.memoryUsage().heapUsed / 1048576);
}

/** Fractional milliseconds: a density query lands under 10ms, a cached one under 0.1ms. */
export const nowMs = (): number => Number(process.hrtime.bigint()) / 1e6;

export function report(label: string, ms: number, before: number): void {
  const rounded = String(Math.round(ms));
  console.log(`${label.padEnd(32)} ${rounded.padStart(7)}ms  heap ${before} -> ${heapMb()}MB`);
}

export async function time<T>(label: string, body: () => T | Promise<T>): Promise<T> {
  const before = heapMb();
  const start = nowMs();
  const out = await body();
  report(label, nowMs() - start, before);
  return out;
}
