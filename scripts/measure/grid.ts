/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * Times the grid's core steps on the Call Tree's Time Order rows, with the longest
 * slice each step held the thread for: the figure the 50ms budget is about.
 */
import type { ApexLog, LogEvent } from '@apexdevtools/apex-log-parser';

import {
  toTimeOrderTree,
  type TimeOrderRow,
} from '../../log-viewer/src/features/call-tree/utils/TimeOrderTree.js';
import {
  GridStore,
  sortComparator,
  type RowFilter,
  type Scheduler,
} from '../../log-viewer/src/grid/index.js';
import { heapMb, line, ms, nowMs } from './harness.js';

/** A Node scheduler that records the longest run between yields. */
function timedScheduler(): Scheduler & { longest(): number; reset(): void } {
  let sliceStart = nowMs();
  let longest = 0;
  return {
    now: nowMs,
    yield: () => {
      longest = Math.max(longest, nowMs() - sliceStart);
      return new Promise<void>((resolve) =>
        setImmediate(() => {
          sliceStart = nowMs();
          resolve();
        }),
      );
    },
    longest: () => Math.max(longest, nowMs() - sliceStart),
    reset: () => {
      sliceStart = nowMs();
      longest = 0;
    },
  };
}

/** The deepest event in the middle of the log: the worst go-to-row a user can ask for. */
function deepPath(log: ApexLog): number[] {
  let best: LogEvent | null = null;
  let bestDepth = -1;
  const stack = log.children.map((event) => ({ event, depth: 0 }));
  const all: { event: LogEvent; depth: number }[] = [];
  while (stack.length) {
    const item = stack.pop()!; // the loop guard keeps the stack non-empty
    all.push(item);
    for (const child of item.event.children) {
      stack.push({ event: child, depth: item.depth + 1 });
    }
  }
  all.sort((a, b) => a.event.eventIndex - b.event.eventIndex);
  for (const item of all.slice(Math.floor(all.length * 0.45), Math.floor(all.length * 0.55))) {
    if (item.depth > bestDepth) {
      best = item.event;
      bestDepth = item.depth;
    }
  }
  const path: number[] = [];
  for (let e: LogEvent | null = best; e?.parent; e = e.parent) {
    path.push(e.eventIndex);
  }
  return path.reverse();
}

export async function measureGrid(log: ApexLog): Promise<void> {
  const roots = toTimeOrderTree(log.children, log.governorLimits) ?? [];
  const scheduler = timedScheduler();
  const path = deepPath(log);

  const step = async (label: string, body: () => Promise<unknown>): Promise<void> => {
    const before = heapMb();
    scheduler.reset();
    const start = nowMs();
    await body();
    const took = nowMs() - start;
    const rows = store.snapshot().rows.size;
    line(
      label,
      `${ms(took)}ms  longest slice ${ms(scheduler.longest())}ms  ${String(rows).padStart(7)} rows  heap ${before} -> ${heapMb()}MB`,
    );
  };

  const detail: RowFilter<TimeOrderRow> = { test: (r) => r._hasDetailsDeep };
  const soqlOnly: RowFilter<TimeOrderRow> = {
    test: (r) => r.type === 'SOQL_EXECUTE_BEGIN',
    keepAncestors: true,
  };
  const bySelf = sortComparator<TimeOrderRow>({ value: (r) => r.duration.self }, 'desc');

  let store!: GridStore<TimeOrderRow>; // assigned by the first step, before any read
  await step('store: first build', () => {
    store = new GridStore<TimeOrderRow>(
      { roots, children: (r) => r._children, key: (r) => r.id },
      { scheduler },
    );
    return store.settled();
  });
  await step('detail filter on', () => store.setFilters([detail]));
  await step('expand all', () => store.expandAll());
  await step('sort by self time', () => store.setSort(bySelf));
  await step('clear sort', () => store.setSort(null));
  await step('detail filter off', () => store.setFilters([]));
  await step('detail filter on', () => store.setFilters([detail]));
  await step('SOQL filter, keep ancestors', () => store.setFilters([detail, soqlOnly]));
  await step('SOQL filter off', () => store.setFilters([detail]));
  await step('collapse all', () => store.collapseAll());
  await step(`reveal deep row (depth ${path.length})`, () => store.reveal(path));
  await step('toggle first root open', () => store.toggle(store.snapshot().rows.keyAt(0), true));
  await step('toggle first root shut', () => store.toggle(store.snapshot().rows.keyAt(0), false));
}
