/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * Times the grid's core steps on the Call Tree's Time Order and Bottom-Up rows, with the
 * longest slice each step held the thread for: the figure the 50ms budget is about.
 */
import type { ApexLog, LogEvent } from '@apexdevtools/apex-log-parser';

import { LogStore } from '../../log-viewer/src/core/log/LogStore.js';
import {
  toBottomUpTree,
  type BottomUpRow,
} from '../../log-viewer/src/features/call-tree/utils/Aggregation.js';
import {
  toTimeOrderTree,
  type TimeOrderRow,
} from '../../log-viewer/src/features/call-tree/utils/TimeOrderTree.js';
import {
  Group,
  GridStore,
  sortComparator,
  sum,
  type Calcs,
  type CellText,
  type ExportColumn,
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

type Step = (label: string, body: () => Promise<unknown>) => Promise<void>;

/**
 * Times each step and prints it with the shown row count that `size` reads after it.
 * No heap reading between steps: a forced GC drops V8's optimised code, so the next step
 * would time a cold walk that the app never sees.
 */
function stepper(scheduler: ReturnType<typeof timedScheduler>, size: () => number): Step {
  return async (label, body) => {
    scheduler.reset();
    const start = nowMs();
    await body();
    const took = nowMs() - start;
    line(
      label,
      `${ms(took)}ms  longest slice ${ms(scheduler.longest())}ms  ${String(size()).padStart(7)} rows`,
    );
  };
}

/** Heap the store holds with every row shown, over `base` taken before it was made. */
async function heldHeap<R extends object>(store: GridStore<R>, base: number): Promise<void> {
  await store.expandAll();
  line('heap held, all rows shown', `+${heapMb() - base}MB  ${store.snapshot().rows.size} rows`);
}

export async function measureGrid(log: ApexLog): Promise<void> {
  await measureTimeOrder(log);
  console.log('');
  await measureBottomUp(log);
}

async function measureTimeOrder(log: ApexLog): Promise<void> {
  const roots = toTimeOrderTree(log.children, log.governorLimits) ?? [];
  const scheduler = timedScheduler();
  const path = deepPath(log);
  const step = stepper(scheduler, () => store.snapshot().rows.size);

  const detail: RowFilter<TimeOrderRow> = { test: (r) => r._hasDetailsDeep };
  const soqlOnly: RowFilter<TimeOrderRow> = {
    test: (r) => r.type === 'SOQL_EXECUTE_BEGIN',
    keepAncestors: true,
  };
  const bySelf = sortComparator<TimeOrderRow>({ value: (r) => r.duration.self }, 'desc');
  const msText = (ns: number): string => (ns / 1e6).toFixed(3);
  // What the visible Time Order cells show: names as they are, times as formatted.
  const cells: CellText<TimeOrderRow>[] = [
    (r) => r.text,
    (r) => r.namespace,
    (r) => r.type,
    (r) => msText(r.duration.total),
    (r) => msText(r.duration.self),
  ];
  const columns: ExportColumn<TimeOrderRow>[] = [
    { title: 'Name', value: (r) => r.text },
    { title: 'Namespace', value: (r) => r.namespace },
    { title: 'Type', value: (r) => r.type },
    { title: 'Total Time (ms)', value: (r) => msText(r.duration.total) },
    { title: 'Self Time (ms)', value: (r) => msText(r.duration.self) },
  ];
  let matches = 0;

  const base = heapMb();
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
  await step('find "account"', async () => {
    matches = (await store.find({ text: 'account' }, cells))?.total ?? -1;
  });
  line('  matches', String(matches));
  await step('find "e"', async () => {
    matches = (await store.find({ text: 'e' }, cells))?.total ?? -1;
  });
  line('  matches', String(matches));
  await step('export CSV, every row', () => store.exportText(columns, { format: 'csv' }));
  await step('collapse all', () => store.collapseAll());
  await step(`reveal deep row (depth ${path.length})`, () => store.reveal(path));
  await step('toggle first root open', () => store.toggle(store.snapshot().rows.keyAt(0), true));
  await step('toggle first root shut', () => store.toggle(store.snapshot().rows.keyAt(0), false));
  await heldHeap(store, base);
}

/**
 * `sumDurationTotalForRootEvents` in slices. Run in one go it holds the thread for up to
 * 330ms at 580k rows. Step 8 moves this into the Bottom-Up adapter.
 */
function* outermostTotal(rows: readonly BottomUpRow[]): Generator<void, number, void> {
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
      total += event.duration.total;
    }
    yield;
  }
  return total;
}

/** Grouping, with the footer and group totals the Bottom-Up tab shows. */
async function measureBottomUp(log: ApexLog): Promise<void> {
  const roots = toBottomUpTree(log.children, new LogStore(log).keyPathIds(), log.governorLimits);
  const scheduler = timedScheduler();
  const step = stepper(scheduler, () => store.snapshot().rows.size);
  const calcs: Calcs<BottomUpRow> = {
    totalSelfTime: sum((r) => r.totalSelfTime),
    totalTime: { of: outermostTotal },
  };
  const bySelf = sortComparator<BottomUpRow>({ value: (r) => r.totalSelfTime }, 'desc');
  const groupsBySelf = sortComparator<Group<BottomUpRow>>(
    { value: (g) => g.totals.totalSelfTime },
    'desc',
  );
  const firstGroup = (): Group<BottomUpRow> => {
    const entry = store.snapshot().rows.rowAt(0);
    if (!(entry instanceof Group)) {
      throw new Error('not grouped');
    }
    return entry;
  };

  const base = heapMb();
  let store!: GridStore<BottomUpRow>; // assigned by the first step, before any read
  await step(`bottom-up: first build (${roots.length} roots)`, () => {
    store = new GridStore<BottomUpRow>(
      { roots, children: (r) => r._children, key: (r) => r.id },
      { scheduler, calcs },
    );
    return store.setSort(bySelf);
  });
  await step('group by type', () => store.setGroupBy((r) => r.type));
  await step('group by namespace', () => store.setGroupBy((r) => r.namespace));
  await step('sort rows and groups by self', () => store.setSort(bySelf, groupsBySelf));
  await step('open largest group', () => store.toggle(firstGroup(), true));
  await step('expand all', () => store.expandAll());
  await step('export CSV, grouped, every row', () =>
    store.exportText(
      [
        { title: 'Name', value: (r) => r.text },
        { title: 'Calls', value: (r) => r.callCount },
        { title: 'Self Time (ms)', value: (r) => r.totalSelfTime },
      ],
      { format: 'csv' },
    ),
  );
  await step('ungroup', () => store.setGroupBy(null));
  await heldHeap(store, base);
}
