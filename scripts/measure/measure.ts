/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * Times the call tree builds and the inspector's row mark on a real log.
 *
 * The whole path is free of the DOM, so it runs under Node: a browser cannot
 * profile a 100MB log without its own parse blocking the tools.
 *
 *   pnpm measure <path to a log>
 *
 * Heap figures need `--expose-gc`, which the `measure` script passes. No log is
 * committed: the path is always an argument.
 */
import { readFileSync } from 'node:fs';

import { parse } from 'apex-log-parser';

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

const gc = globalThis.gc as (() => void) | undefined;

/** Heap after a collection, so a figure is what the step retained, not its litter. */
function heapMb(): number {
  gc?.();
  return Math.round(process.memoryUsage().heapUsed / 1048576);
}

const now = (): number => Number(process.hrtime.bigint() / 1000000n);
// The builds slice themselves against this; resolving at once measures the work
// rather than the frames it would hand back on screen.
const yieldSlice = () => Promise.resolve();

function report(label: string, ms: number, before: number): void {
  console.log(`${label.padEnd(32)} ${String(ms).padStart(7)}ms  heap ${before} -> ${heapMb()}MB`);
}

async function time<T>(label: string, body: () => T | Promise<T>): Promise<T> {
  const before = heapMb();
  const start = now();
  const out = await body();
  report(label, now() - start, before);
  return out;
}

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

const logPath = process.argv[2];
if (!logPath) {
  console.error('usage: pnpm measure <path to a log>');
  process.exit(1);
}

const text = await time('read file', () => readFileSync(logPath, 'utf8'));
console.log(`log ${Math.round(text.length / 1048576)}MB, ${text.split('\n').length} lines\n`);

const log = await time('parse', () => parse(text));
setCurrentLog(log);

const scoped = await time('buildWholeLogCallTree', () => buildWholeLogCallTree({ yieldSlice }));
if (!scoped) {
  throw new Error('nothing in scope');
}

const bottomUp = (await time('inspector bottomUp() rows', () => scoped.bottomUp({ yieldSlice })))!;
const aggregated = (await time('inspector aggregated() rows', () =>
  scoped.aggregated({ yieldSlice }),
))!;
const timeOrder = (await time('inspector timeOrder() rows', () =>
  scoped.timeOrder({ yieldSlice }),
))!;

const shape = shapeOf(bottomUp);
const counts = ({ nodes, indexes }: Shape) => `${nodes} nodes, ${indexes} indexes held`;
console.log(`bottom-up   ${counts(shape)}`);
console.log(`aggregated  ${counts(shapeOf(aggregated))}`);
console.log(`time-order  ${counts(shapeOf(timeOrder))}\n`);

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
