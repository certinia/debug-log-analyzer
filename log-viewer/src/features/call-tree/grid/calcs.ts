/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { LogEvent } from '@apexdevtools/apex-log-parser';

import { ROWS_PER_YIELD, type Calc } from '../../../grid/index.js';

/**
 * Sums `valueOf` over the events every row stands for, counting an event only when none
 * of its ancestors is counted too. Bottom-up rows overlap, so a plain sum counts a nested
 * call twice. The same rule as `sumTotalForRootEvents`, run in slices.
 */
export function outermostSum<R extends { instances: readonly LogEvent[] }>(
  valueOf: (event: LogEvent) => number,
): Calc<R> {
  return {
    *of(rows) {
      const events = yield* outermostOf(rows);
      let total = 0;
      for (let i = 0; i < events.length; i++) {
        total += valueOf(events[i] as LogEvent);
        if (i % ROWS_PER_YIELD === ROWS_PER_YIELD - 1) {
          yield;
        }
      }
      return total;
    },
  };
}

/** Held per row list: each total of one footer or group reads the same events. */
const outermostCache = new WeakMap<readonly object[], readonly LogEvent[]>();

function* outermostOf(
  rows: readonly { instances: readonly LogEvent[] }[],
): Generator<void, readonly LogEvent[], void> {
  const cached = outermostCache.get(rows);
  if (cached) {
    return cached;
  }
  const all = new Set<LogEvent>();
  for (const row of rows) {
    for (const event of row.instances) {
      all.add(event);
      yield;
    }
  }
  // Whether an event has an ancestor in `all`, kept for each event a walk passes, so no
  // stretch of the tree is walked twice.
  const enclosed = new Map<LogEvent, boolean>();
  const isEnclosed = (event: LogEvent): boolean => {
    const passed: LogEvent[] = [];
    let answer = false;
    for (let node = event; ;) {
      const parent = node.parent;
      if (!parent) {
        break;
      }
      if (all.has(parent)) {
        answer = true;
        break;
      }
      const known = enclosed.get(parent);
      if (known !== undefined) {
        answer = known;
        break;
      }
      passed.push(parent);
      node = parent;
    }
    for (const node of passed) {
      enclosed.set(node, answer);
    }
    return answer;
  };
  const outermost: LogEvent[] = [];
  for (const event of all) {
    if (!isEnclosed(event)) {
      outermost.push(event);
    }
    yield;
  }
  outermostCache.set(rows, outermost);
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
