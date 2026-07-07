/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * Shared constants and utilities for time-axis rendering.
 *
 * Consolidates duplicated logic from MeshAxisRenderer, AxisRenderer,
 * ClockTimeAxisRenderer, ElapsedTimeAxisRenderer, and TimeGridCalculator.
 */

/**
 * Nanoseconds per millisecond conversion constant.
 */
export const NS_PER_MS = 1_000_000;

/**
 * Label positioning offsets in pixels.
 */
export const LABEL_OFFSET_X = 3;
export const LABEL_OFFSET_Y = 5;

/**
 * 1-2-5 sequence intervals in milliseconds for tick selection.
 * Covers from 1 microsecond (0.001 ms) to 10 seconds.
 */
const BASE_INTERVALS_MS: readonly number[] = [
  // Sub-millisecond (microseconds in ms)
  0.001, 0.002, 0.005,
  // Tens of microseconds
  0.01, 0.02, 0.05,
  // Hundreds of microseconds
  0.1, 0.2, 0.5,
  // Milliseconds
  1, 2, 5, 10, 20, 50, 100, 200, 500,
  // Seconds
  1000, 2000, 5000, 10000,
] as const;

/**
 * Select appropriate interval using 1-2-5 sequence.
 * Returns interval in milliseconds and skip factor for label density.
 */
export function selectInterval(targetMs: number): { interval: number; skipFactor: number } {
  // Find smallest interval >= targetMs
  let interval = BASE_INTERVALS_MS[BASE_INTERVALS_MS.length - 1] ?? 1000;
  for (const candidate of BASE_INTERVALS_MS) {
    if (candidate >= targetMs) {
      interval = candidate;
      break;
    }
  }

  // Default skip factor of 1 (show all labels)
  let skipFactor = 1;

  // If labels are still too close, increase skip factor
  // This happens when zoomed way out
  if (interval >= 1000) {
    if (targetMs > interval * 1.5) {
      skipFactor = 2;
    }
    if (targetMs > interval * 3) {
      skipFactor = 5;
    }
  }

  return { interval, skipFactor };
}

/**
 * Format time with appropriate units and precision.
 * - Whole seconds: "1 s", "2 s" (not "1000 ms")
 * - Milliseconds: up to 3 decimal places: "18800.345 ms"
 * - Omit zero: don't show "0 s" or "0 ms"
 */
export function formatMilliseconds(timeMs: number): string {
  if (timeMs === 0) {
    return '';
  }

  if (timeMs >= 1000 && timeMs % 1000 === 0) {
    const seconds = timeMs / 1000;
    return `${seconds} s`;
  }

  const formatted = timeMs.toFixed(3);
  const trimmed = formatted.replace(/\.?0+$/, '');
  return `${trimmed} ms`;
}
