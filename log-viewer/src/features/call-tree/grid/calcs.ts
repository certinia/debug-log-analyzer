/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ApexLog } from '@apexdevtools/apex-log-parser';

import { outermostIdsSteps } from '#core/utility/EventTree.js';
import { sum, type Calc } from '../../../grid/index.js';

/**
 * Sums `valueOf` over the events every row stands for, counting an event only when none
 * of its ancestors is counted too. Bottom-up rows overlap, so a plain sum counts a nested
 * call twice. The same rule as `outermostIds`, run in slices.
 */
export function outermostSum<R extends { instances: readonly number[] }>(
  log: ApexLog,
  valueOf: (eventId: number) => number,
): Calc<R> {
  const total = sum(valueOf);
  return {
    *of(rows) {
      const events = yield* outermostOf(log, rows);
      const summed = total.of(events);
      return typeof summed === 'number' ? summed : yield* summed;
    },
  };
}

/** Held per row list: each total of one footer or group reads the same events. */
const outermostCache = new WeakMap<readonly object[], readonly number[]>();

function* instancesOf(rows: readonly { instances: readonly number[] }[]): Generator<number> {
  for (const row of rows) {
    yield* row.instances;
  }
}

function* outermostOf(
  log: ApexLog,
  rows: readonly { instances: readonly number[] }[],
): Generator<void, readonly number[], void> {
  let outermost = outermostCache.get(rows);
  if (!outermost) {
    outermost = yield* outermostIdsSteps(log, instancesOf(rows));
    outermostCache.set(rows, outermost);
  }
  return outermost;
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
