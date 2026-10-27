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

/**
 * {@link outermostIds}, yielding after each id so a caller can run it in slices.
 * Ids are in pre-order, so an id inside the last kept one's subtree is enclosed.
 */
export function* outermostIdsSteps(
  log: ApexLog,
  ids: Iterable<number>,
): Generator<void, number[], void> {
  const sorted = Int32Array.from(ids).sort();
  const { subtreeEnd } = log.columns;
  const outermost: number[] = [];
  let end = 0;
  for (const id of sorted) {
    if (id >= end) {
      outermost.push(id);
      end = subtreeEnd[id] ?? id + 1;
    }
    yield;
  }
  return outermost;
}
