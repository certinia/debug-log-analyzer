/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { type LogIndex, NO_ROW } from '../../src/core/log/LogIndex.js';

/** The deepest row in the middle of the log: the worst go-to-row a user can ask for. */
export function deepRow(index: LogIndex): number {
  const from = Math.floor(index.rowCount * 0.45);
  const to = Math.floor(index.rowCount * 0.55);
  let deepest = from;
  for (let row = from; row < to; row++) {
    if (index.depth[row]! > index.depth[deepest]!) {
      deepest = row;
    }
  }
  return deepest;
}

/** The event ids from the root down to `row`, as Time Order rows are keyed. */
export function pathOf(index: LogIndex, row: number): number[] {
  const path: number[] = [];
  for (let at = row; at !== NO_ROW; at = index.parent[at]!) {
    path.push(index.eventIndex[at]!);
  }
  return path.reverse();
}
