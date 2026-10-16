/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { LogEvent } from '@apexdevtools/apex-log-parser';

import { outermostEventsSteps } from '../../../core/utility/EventTree.js';
import { sum, type Calc } from '../../../grid/index.js';

/**
 * Sums `valueOf` over the events every row stands for, counting an event only when none
 * of its ancestors is counted too. Bottom-up rows overlap, so a plain sum counts a nested
 * call twice. The same rule as `sumTotalForRootEvents`, run in slices.
 */
export function outermostSum<R extends { instances: readonly LogEvent[] }>(
  valueOf: (event: LogEvent) => number,
): Calc<R> {
  const total = sum(valueOf);
  return {
    *of(rows) {
      const events = yield* outermostOf(rows);
      const summed = total.of(events);
      return typeof summed === 'number' ? summed : yield* summed;
    },
  };
}

/** Held per row list: each total of one footer or group reads the same events. */
const outermostCache = new WeakMap<readonly object[], readonly LogEvent[]>();

function* instancesOf(rows: readonly { instances: readonly LogEvent[] }[]): Generator<LogEvent> {
  for (const row of rows) {
    yield* row.instances;
  }
}

function* outermostOf(
  rows: readonly { instances: readonly LogEvent[] }[],
): Generator<void, readonly LogEvent[], void> {
  let outermost = outermostCache.get(rows);
  if (!outermost) {
    outermost = yield* outermostEventsSteps(instancesOf(rows));
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
