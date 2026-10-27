/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * Times the grid's core steps on the Call Tree's Time Order and Bottom-Up rows, with the
 * longest slice each step held the thread for: the figure the 50ms budget is about.
 */
import type { ApexLog } from '@apexdevtools/apex-log-parser';

import { LogStore } from '../../log-viewer/src/core/log/LogStore.js';
import { deepRow, pathOf } from '../../log-viewer/bench/grid/targets.js';
import { formatNsAsMs } from '../../log-viewer/src/core/utility/Duration.js';
import {
  toBottomUpTree,
  type BottomUpRow,
} from '../../log-viewer/src/features/call-tree/utils/Aggregation.js';
import { outermostSum } from '../../log-viewer/src/features/call-tree/grid/calcs.js';
import { reportedUsage } from '../../log-viewer/src/features/call-tree/utils/reportedUsage.js';
import {
  TimeOrderSource,
  type TimeOrderNode,
} from '../../log-viewer/src/features/call-tree/utils/TimeOrderTree.js';
import {
  Group,
  GridStore,
  sum,
  type Calcs,
  type CellText,
  type ExportColumn,
  type RowFilter,
  type Scheduler,
  type Sort,
} from '../../log-viewer/src/grid/core/index.js';
import { heapMb, line, ms, nowMs, print } from './harness.js';

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
  print('');
  await measureBottomUp(log);
}

async function measureTimeOrder(log: ApexLog): Promise<void> {
  const index = await new LogStore(log).logIndex();
  const source = new TimeOrderSource(index);
  const { total, self } = index;
  const scheduler = timedScheduler();
  const path = pathOf(index, deepRow(index));
  const step = stepper(scheduler, () => store.snapshot().rows.size);
  const timeOrderDetails = source.details;

  const soqlOnly: RowFilter<TimeOrderNode> = {
    test: (n) => source.type(n) === 'SOQL_EXECUTE_BEGIN',
    keepAncestors: true,
  };
  const bySelf: Sort<TimeOrderNode> = { value: (n) => self[n.row]!, dir: 'desc' };
  const cells: CellText<TimeOrderNode>[] = [
    source.text,
    source.namespace,
    source.type,
    (n) => formatNsAsMs(total[n.row]!, 3),
    (n) => formatNsAsMs(self[n.row]!, 3),
  ];
  const columns: ExportColumn<TimeOrderNode>[] = [
    { title: 'Name', value: source.text },
    { title: 'Namespace', value: source.namespace },
    { title: 'Type', value: source.type },
    { title: 'Total Time (ms)', value: (n) => formatNsAsMs(total[n.row]!, 3) },
    { title: 'Self Time (ms)', value: (n) => formatNsAsMs(self[n.row]!, 3) },
  ];
  let matches = 0;

  const base = heapMb();
  let store!: GridStore<TimeOrderNode>; // assigned by the first step, before any read
  await step('store: first build', () => {
    store = new GridStore<TimeOrderNode>(source, { scheduler });
    return store.settled();
  });
  await step('detail filter on', () => store.setFilters([timeOrderDetails]));
  await step('expand all', () => store.expandAll());
  await step('sort by self time', () => store.setSort(bySelf));
  await step('clear sort', () => store.setSort(null));
  await step('detail filter off', () => store.setFilters([]));
  await step('detail filter on', () => store.setFilters([timeOrderDetails]));
  await step('SOQL filter, keep ancestors', () => store.setFilters([timeOrderDetails, soqlOnly]));
  await step('SOQL filter off', () => store.setFilters([timeOrderDetails]));
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

/** Grouping, with the footer and group totals the Bottom-Up tab shows. */
async function measureBottomUp(log: ApexLog): Promise<void> {
  const logStore = new LogStore(log);
  const roots = toBottomUpTree(
    await logStore.logIndex(),
    logStore,
    await logStore.derive(reportedUsage),
  );
  const scheduler = timedScheduler();
  const step = stepper(scheduler, () => store.snapshot().rows.size);
  const { durationTotal } = log.columns;
  const calcs: Calcs<BottomUpRow> = {
    totalSelfTime: sum((r) => r.totalSelfTime),
    totalTime: outermostSum(log, (id) => durationTotal[id]!),
  };
  const bySelf: Sort<BottomUpRow> = { value: (r) => r.totalSelfTime, dir: 'desc' };
  const groupsBySelf: Sort<Group<BottomUpRow>> = {
    value: (g) => g.totals.totalSelfTime,
    dir: 'desc',
  };
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
