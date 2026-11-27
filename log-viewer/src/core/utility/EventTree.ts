/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ApexLog } from '@apexdevtools/apex-log-parser';

/**
 * The ids with no ancestor among them, ascending, duplicates dropped. Whatever is
 * summed or walked from these, nothing inside a kept subtree is counted twice.
 */
export function outermostIds(log: ApexLog, ids: Iterable<number>): number[] {
  const steps = outermostIdsSteps(log, ids);
  let step = steps.next();
  while (!step.done) {
    step = steps.next();
  }
  return step.value;
}

/** Ids at least this dense in their span are marked and scanned, not sorted. */
const DENSE_SPAN = 8;

/**
 * {@link outermostIds}, yielding after each id so a caller can run it in slices.
 * Ids are in pre-order, so an id inside the last kept one's subtree is enclosed.
 */
export function* outermostIdsSteps(
  log: ApexLog,
  ids: Iterable<number>,
): Generator<void, number[], void> {
  const held: number[] = [];
  let first = Infinity;
  let last = -1;
  let ascending = true;
  for (const id of ids) {
    ascending &&= id >= last;
    held.push(id);
    first = Math.min(first, id);
    last = Math.max(last, id);
    yield;
  }
  const { subtreeEnd } = log.columns;
  const outermost: number[] = [];
  // Each row's ids ascend, but a list of rows in sort order does not.
  if (!ascending && held.length * DENSE_SPAN >= last - first) {
    // Sorting 270k ids in one step took 54 ms; a mark per id in the span needs no sort.
    const marked = new Uint8Array(last - first + 1);
    for (const id of held) {
      marked[id - first] = 1;
    }
    for (let id = first; id <= last; yield) {
      if (marked[id - first]) {
        outermost.push(id);
        id = subtreeEnd[id] ?? id + 1;
      } else {
        id++;
      }
    }
    return outermost;
  }
  let end = 0;
  for (const id of ascending ? held : Int32Array.from(held).sort()) {
    if (id >= end) {
      outermost.push(id);
      end = subtreeEnd[id] ?? id + 1;
    }
    yield;
  }
  return outermost;
}
