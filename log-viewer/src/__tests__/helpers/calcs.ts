/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { Calc } from '../../grid/index.js';

/** A calc's total over `rows`, its slices run to the end. */
export function runCalc<R>(calc: Calc<R> | undefined, rows: readonly R[]): number | undefined {
  const total = calc?.of(rows);
  if (typeof total !== 'object') {
    return total;
  }
  let step = total.next();
  while (!step.done) {
    step = total.next();
  }
  return step.value;
}
