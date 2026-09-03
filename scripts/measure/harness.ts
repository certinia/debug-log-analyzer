/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * Timing and heap helpers shared by the measure scripts.
 *
 * Heap figures need `--expose-gc`, which the `measure` scripts pass.
 */

const gc = globalThis.gc as (() => void) | undefined;

/** Width of the label column, so every reported line aligns into one table. */
const LABEL_WIDTH = 32;

/** Width of the millisecond column, shared by `report` and `ms`. */
const MS_WIDTH = 7;

if (!gc) {
  console.warn('no --expose-gc: heap figures include uncollected litter\n');
}

/** Heap after a collection, so a figure is what the step retained, not its litter. */
export function heapMb(): number {
  gc?.();
  return Math.round(retainedMb());
}

/**
 * Heap plus typed-array bytes, without collecting.
 *
 * `heapUsed` alone misses every typed array: their backing stores are counted in
 * `arrayBuffers`. The minimap's skyline is 15.6MB of typed arrays, so leaving them
 * out reports its cost as zero.
 */
function retainedMb(): number {
  const usage = process.memoryUsage();
  return (usage.heapUsed + usage.arrayBuffers) / 1048576;
}

/** Fractional milliseconds: a density query lands under 10ms, a cached one under 0.1ms. */
export const nowMs = (): number => Number(process.hrtime.bigint()) / 1e6;

/** Two decimals, in `report`'s number column: a cached query lands under 0.1ms. */
export const ms = (value: number): string => value.toFixed(2).padStart(MS_WIDTH);

/** One reported line, in the same label column as `report`. */
export function line(label: string, text: string): void {
  console.log(`${label.padEnd(LABEL_WIDTH)} ${text}`);
}

export function report(label: string, milliseconds: number, before: number): void {
  const rounded = String(Math.round(milliseconds)).padStart(MS_WIDTH);
  line(label, `${rounded}ms  heap ${before} -> ${heapMb()}MB`);
}

/**
 * Time a step, and report what it retained.
 *
 * The `after` figure collects, so it is retention rather than litter - which means
 * it lands just before the next step and costs that step ~26% in first-touch. So
 * compare a line against the same line on another branch, never against a budget.
 */
export async function time<T>(label: string, body: () => T | Promise<T>): Promise<T> {
  const before = Math.round(retainedMb());
  const start = nowMs();
  const out = await body();
  report(label, nowMs() - start, before);
  return out;
}

/** Report a usage error the way every other bad input is reported, and stop. */
export function die(message: string): never {
  console.error(message);
  process.exit(1);
}
