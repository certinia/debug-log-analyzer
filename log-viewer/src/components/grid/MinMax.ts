/*
 * Copyright (c) 2022 Certinia Inc. All rights reserved.
 */

export type FilterRange = { start: number | null; end: number | null };

const NS_PER_MS = 1_000_000;

/** Range check for durations stored in nanoseconds (compared in ms). */
export function inMsRange(range: FilterRange, valueNs: number): boolean {
  return inRange(range, valueNs, NS_PER_MS);
}

/** Range check for plain counts (no unit conversion), e.g. row counts. */
export function inCountRange(range: FilterRange, value: number): boolean {
  return inRange(range, value, 1);
}

function inRange(range: FilterRange, value: number, divisor: number): boolean {
  const rowVal = +(value / divisor).toFixed(3);
  const { start: min, end: max } = range;
  if (min !== null && max !== null) {
    return rowVal >= min && rowVal <= max;
  }
  if (min !== null) {
    return rowVal >= min;
  }
  if (max !== null) {
    return rowVal <= max;
  }
  return true;
}
