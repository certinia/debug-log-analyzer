/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * Times the call tree builds and the inspector's row mark.
 */
import type { ApexLog } from 'apex-log-parser';

import { LocatedRowIds } from '../../log-viewer/src/components/locatedRow.js';
import {
  buildWholeLogCallTree,
  rowIdsByPath,
  type ScopedRow,
} from '../../log-viewer/src/components/scopedCallTree.js';
import { LogStore, setCurrentLog } from '../../log-viewer/src/core/log/LogStore.js';
import {
  toAggregatedCallTree,
  toBottomUpTree,
} from '../../log-viewer/src/features/call-tree/utils/Aggregation.js';
import { line, time } from './harness.js';

// The builds slice themselves against this; resolving at once measures the work
// rather than the frames it would hand back on screen.
const yieldSlice = () => Promise.resolve();

interface Shape {
  nodes: number;
  /** Event indexes the rows store between them: what a row per occurrence costs.
   *  A row that derives its own stores none. */
  indexes: number;
  fattest: ScopedRow | null;
}

function shapeOf(rows: readonly ScopedRow[]): Shape {
  const shape: Shape = { nodes: 0, indexes: 0, fattest: null };
  const stack = [...rows];
  while (stack.length) {
    const row = stack.pop()!;
    shape.nodes += 1;
    const held = row.eventIndexes?.length ?? 0;
    shape.indexes += held;
    if (held > (shape.fattest?.eventIndexes?.length ?? 0)) {
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
  setCurrentLog(log);

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
  const counts = ({ nodes, indexes }: Shape) => `${nodes} nodes, ${indexes} indexes held`;
  line('bottom-up', counts(shape));
  line('aggregated', counts(shapeOf(aggregated)));
  line('time-order', `${counts(shapeOf(timeOrder))}\n`);

  const byPathBottomUp = await time('rowIdsByPath bottom-up', () => rowIdsByPath(bottomUp));
  const byPathAggregated = await time('rowIdsByPath aggregated', () => rowIdsByPath(aggregated));
  console.log(`map entries: bottom-up ${byPathBottomUp.size}, aggregated ${byPathAggregated.size}`);

  // The mark, on the worst row there is: the frames a picked bucket counts,
  // translated into the ids of every row they name.
  const picked = shape.fattest?.eventIndexes ?? [];
  console.log(`\nfattest row: ${picked.length} occurrences of "${shape.fattest?.text ?? ''}"`);
  const ids = new LocatedRowIds();
  await time('mark callers (first)', () => ids.idsFor(log, picked, 'callers'));
  await time('mark callers (same pick)', () => ids.idsFor(log, picked, 'callers'));
  await time('mark callees', () => new LocatedRowIds().idsFor(log, picked, 'callees'));

  // The Call Tree tab's own grouped builds, for comparison with the inspector's.
  console.log('');
  // A store of its own, so the inspector's builds above have not warmed the key
  // table. Only the first build below is cold; the second reads what the first
  // interned, as it does on screen where every view shares one table.
  const gridPaths = new LogStore(log).keyPathIds();
  await time('grid toAggregatedCallTree', () => toAggregatedCallTree(log.children, gridPaths));
  await time('grid toBottomUpTree', () => toBottomUpTree(log.children, gridPaths));
}
