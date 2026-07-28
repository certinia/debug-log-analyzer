/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

/** Apex log durations/timestamps are in nanoseconds. Convert to milliseconds. */
export function nsToMs(ns: number | null | undefined): number {
  return (ns || 0) / 1_000_000;
}

/** Format a nanosecond duration as a millisecond string. */
export function formatMs(ns: number | null | undefined, precision = 2): string {
  return nsToMs(ns).toFixed(precision);
}
