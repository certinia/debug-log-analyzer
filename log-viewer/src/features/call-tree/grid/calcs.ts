/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { LogEvent } from '@apexdevtools/apex-log-parser';

import type { Calc } from '../../../grid/index.js';

/**
 * Sums `valueOf` over the events every row stands for, counting an event only when none
 * of its ancestors is counted too. Bottom-up rows overlap, so a plain sum counts a nested
 * call twice. The same rule as `sumTotalForRootEvents`, run in slices.
 */
export function outermostSum<R extends { instances: readonly LogEvent[] }>(
  valueOf: (event: LogEvent) => number,
): Calc<R> {
  return { of: (rows) => outermost(rows, valueOf) };
}

function* outermost<R extends { instances: readonly LogEvent[] }>(
  rows: readonly R[],
  valueOf: (event: LogEvent) => number,
): Generator<void, number, void> {
  const all = new Set<LogEvent>();
  for (const row of rows) {
    for (const event of row.instances) {
      all.add(event);
      yield;
    }
  }
  let total = 0;
  for (const event of all) {
    let enclosed = false;
    for (let parent = event.parent; parent && !enclosed; parent = parent.parent) {
      enclosed = all.has(parent);
    }
    if (!enclosed) {
      total += valueOf(event);
    }
    yield;
  }
  return total;
}

/**
 * The highest known value, or NaN where no row has one: an unknown utilisation is not
 * 0%, so the footer shows it as `—`.
 */
export function knownMax<R>(valueOf: (row: R) => number | null): Calc<R> {
  return {
    of: (rows) => {
      let highest = Number.NaN;
      for (const row of rows) {
        const value = valueOf(row);
        if (value !== null && (Number.isNaN(highest) || value > highest)) {
          highest = value;
        }
      }
      return highest;
    },
  };
}
