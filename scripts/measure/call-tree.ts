/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * Times the call tree builds and the inspector's row mark.
 */
import type { ApexLog } from '@apexdevtools/apex-log-parser';

import { LocatedRowIds } from '../../log-viewer/src/components/locatedRow.js';
import {
  buildWholeLogCallTree,
  rowIdsByPath,
  type ScopedRow,
} from '../../log-viewer/src/components/scopedCallTree.js';
import { LogStore, logStoreFor, setCurrentLog } from '../../log-viewer/src/core/log/LogStore.js';
import {
  toAggregatedCallTree,
  toBottomUpTree,
} from '../../log-viewer/src/features/call-tree/utils/Aggregation.js';
import { reportedUsage } from '../../log-viewer/src/features/call-tree/utils/reportedUsage.js';
import { line, print, time, yieldSlice } from './harness.js';

interface Shape {
  nodes: number;
  /** Event ids the rows store between them: what a row per occurrence costs.
   *  A row that derives its own stores none. */
  ids: number;
  fattest: ScopedRow | null;
}

function shapeOf(rows: readonly ScopedRow[]): Shape {
  const shape: Shape = { nodes: 0, ids: 0, fattest: null };
  const stack = [...rows];
  while (stack.length) {
    const row = stack.pop()!;
    shape.nodes += 1;
    const held = row.eventIds?.length ?? 0;
    shape.ids += held;
    if (held > (shape.fattest?.eventIds?.length ?? 0)) {
      shape.fattest = row;
    }
    if (row._children) {
      for (const child of row._children) {
        stack.push(child);
      }
    }
  }
  return shape;
}

export async function measureCallTree(log: ApexLog): Promise<void> {
  const store = logStoreFor(log);
  setCurrentLog(store);

  const scoped = await time('buildWholeLogCallTree', () => buildWholeLogCallTree({ yieldSlice }));
  if (!scoped) {
    throw new Error('nothing in scope');
  }

  const bottomUp = (await time('inspector bottomUp() rows', () =>
    scoped.bottomUp({ yieldSlice }),
  ))!;
  const aggregated = (await time('inspector aggregated() rows', () =>
    scoped.aggregated({ yieldSlice }),
  ))!;
  const timeOrder = (await time('inspector timeOrder() rows', () =>
    scoped.timeOrder({ yieldSlice }),
  ))!;

  const shape = shapeOf(bottomUp);
  const counts = ({ nodes, ids }: Shape) => `${nodes} nodes, ${ids} ids held`;
  line('bottom-up', counts(shape));
  line('aggregated', counts(shapeOf(aggregated)));
  line('time-order', `${counts(shapeOf(timeOrder))}\n`);

  const byPathBottomUp = await time('rowIdsByPath bottom-up', () => rowIdsByPath(bottomUp));
  const byPathAggregated = await time('rowIdsByPath aggregated', () => rowIdsByPath(aggregated));
  print(`map entries: bottom-up ${byPathBottomUp.size}, aggregated ${byPathAggregated.size}`);

  // The mark, on the worst row there is: the frames a picked bucket counts,
  // translated into the ids of every row they name.
  const picked = shape.fattest?.eventIds ?? [];
  print(`\nfattest row: ${picked.length} occurrences of "${shape.fattest?.text ?? ''}"`);
  const ids = new LocatedRowIds();
  await time('mark callers (first)', () => ids.idsFor(store, picked, 'callers'));
  await time('mark callers (same pick)', () => ids.idsFor(store, picked, 'callers'));
  await time('mark callees', () => new LocatedRowIds().idsFor(store, picked, 'callees'));

  // The Call Tree tab's own grouped builds, for comparison with the inspector's.
  print('');
  // A store of its own, so the inspector's builds above have not warmed the key
  // table. Only the first build below is cold; the second reads what the first
  // interned, as it does on screen where every view shares one table.
  const gridStore = new LogStore(log);
  const gridIndex = await gridStore.logIndex({ yieldSlice });
  const usage = await time('grid reportedUsage', () => gridStore.derive(reportedUsage));
  await time('grid toAggregatedCallTree', () => toAggregatedCallTree(gridIndex, gridStore, usage));
  await time('grid toBottomUpTree', () => toBottomUpTree(gridIndex, gridStore, usage));
}
