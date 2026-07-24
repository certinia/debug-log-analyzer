/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * How many leading items fit in `avail` px, given their measured `widths` and the `gap`
 * between them. If they don't all fit, `reserve` px are held back for the overflow
 * control before counting. Pure (no DOM) so it can be unit-tested.
 */
export function computeVisibleCount(
  widths: readonly number[],
  avail: number,
  gap: number,
  reserve: number,
): number {
  const fits = (limit: number): number => {
    let used = 0;
    let n = 0;
    for (const w of widths) {
      used += (n > 0 ? gap : 0) + w;
      if (used > limit) {
        break;
      }
      n++;
    }
    return n;
  };
  return fits(avail) === widths.length ? widths.length : fits(avail - reserve);
}
