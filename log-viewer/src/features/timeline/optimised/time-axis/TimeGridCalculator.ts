/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * TimeGridCalculator
 *
 * Shared utility for calculating time grid intervals using the 1-2-5 sequence.
 * Used by both the metric strip and main timeline axis to ensure consistent alignment.
 *
 * The 1-2-5 sequence provides visually pleasing intervals that align with
 * human-readable time units (microseconds, milliseconds, seconds).
 */

/**
 * 1-2-5 sequence intervals in nanoseconds for time grid lines.
 * Covers from 1 microsecond to 50 seconds.
 */
export const TIME_GRID_INTERVALS: readonly number[] = [
  1e3,
  2e3,
  5e3, // 1, 2, 5 microseconds
  1e4,
  2e4,
  5e4, // 10, 20, 50 microseconds
  1e5,
  2e5,
  5e5, // 100, 200, 500 microseconds
  1e6,
  2e6,
  5e6, // 1, 2, 5 milliseconds
  1e7,
  2e7,
  5e7, // 10, 20, 50 milliseconds
  1e8,
  2e8,
  5e8, // 100, 200, 500 milliseconds
  1e9,
  2e9,
  5e9, // 1, 2, 5 seconds
  1e10,
  2e10,
  5e10, // 10, 20, 50 seconds
] as const;

/**
 * Default target pixel spacing between grid lines.
 */
export const DEFAULT_GRID_SPACING_PX = 80;

/**
 * Select appropriate grid interval using 1-2-5 sequence.
 * Returns the first interval >= target.
 *
 * @param targetNs - Target interval in nanoseconds (typically calculated from zoom level)
 * @returns Interval in nanoseconds from the 1-2-5 sequence
 */
export function selectGridInterval(targetNs: number): number {
  for (const interval of TIME_GRID_INTERVALS) {
    if (interval >= targetNs) {
      return interval;
    }
  }
  return TIME_GRID_INTERVALS[TIME_GRID_INTERVALS.length - 1]!;
}

/**
 * Calculate the target interval based on zoom level and desired pixel spacing.
 *
 * @param zoom - Pixels per nanosecond
 * @param targetSpacingPx - Desired pixel spacing between grid lines
 * @returns Target interval in nanoseconds
 */
export function calculateTargetInterval(
  zoom: number,
  targetSpacingPx: number = DEFAULT_GRID_SPACING_PX,
): number {
  return targetSpacingPx / zoom;
}

/**
 * Calculate the first grid line position aligned to the interval.
 * Matches AxisRenderer's logic: starts one tick before visible range
 * to ensure left edge coverage.
 *
 * @param timeStartNs - Start of visible time range in nanoseconds
 * @param intervalNs - Grid interval in nanoseconds
 * @returns First grid line time in nanoseconds
 */
export function calculateFirstGridLineTime(timeStartNs: number, intervalNs: number): number {
  // Match AxisRenderer: go back one tick to ensure left edge coverage
  return (Math.floor(timeStartNs / intervalNs) - 1) * intervalNs;
}

/**
 * Calculate the last grid line index.
 * Matches AxisRenderer's logic: extends one tick past visible range.
 *
 * @param timeEndNs - End of visible time range in nanoseconds
 * @param intervalNs - Grid interval in nanoseconds
 * @returns Last grid line time in nanoseconds
 */
export function calculateLastGridLineTime(timeEndNs: number, intervalNs: number): number {
  // Match AxisRenderer: go forward one tick to ensure right edge coverage
  return (Math.ceil(timeEndNs / intervalNs) + 1) * intervalNs;
}

/**
 * Base intervals in milliseconds using 1-2-5 sequence.
 * Matches AxisRenderer's baseIntervals for consistent grid alignment.
 */
const BASE_INTERVALS_MS: readonly number[] = [
  // Sub-millisecond (microseconds in ms)
  0.001, // 1 microsecond
  0.002, // 2 microseconds
  0.005, // 5 microseconds
  // Tens of microseconds
  0.01, // 10 microseconds
  0.02, // 20 microseconds
  0.05, // 50 microseconds
  // Hundreds of microseconds
  0.1, // 100 microseconds
  0.2, // 200 microseconds
  0.5, // 500 microseconds
  // Milliseconds
  1,
  2,
  5,
  10,
  20,
  50,
  100,
  200,
  500,
  // Seconds
  1000,
  2000,
  5000,
  10000,
] as const;

/**
 * Nanoseconds per millisecond conversion constant.
 */
const NS_PER_MS = 1_000_000;

/**
 * Calculate grid interval in nanoseconds using AxisRenderer's exact logic.
 * Ensures metric strip and main timeline use identical intervals.
 *
 * @param zoom - Pixels per nanosecond
 * @param minSpacingPx - Minimum pixel spacing between grid lines (default: 80)
 * @returns Interval in nanoseconds
 */
export function calculateGridIntervalNs(
  zoom: number,
  minSpacingPx: number = DEFAULT_GRID_SPACING_PX,
): number {
  const targetIntervalNs = minSpacingPx / zoom;
  const targetIntervalMs = targetIntervalNs / NS_PER_MS;

  // Find smallest interval >= targetMs (same logic as AxisRenderer.selectInterval)
  let intervalMs = BASE_INTERVALS_MS[BASE_INTERVALS_MS.length - 1]!;
  for (const candidate of BASE_INTERVALS_MS) {
    if (candidate >= targetIntervalMs) {
      intervalMs = candidate;
      break;
    }
  }

  return intervalMs * NS_PER_MS;
}
