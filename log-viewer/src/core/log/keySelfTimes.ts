/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { CHECK_EVERY, frameBudget } from '../utility/FrameBudget.js';
import { getEventKey } from './eventKeys.js';
import { type LogIndex, NO_ROW } from './LogIndex.js';

/**
 * Self time per signature ({@link getEventKey}), from one pass over the index.
 * A key's id is its place in `keys`, in order of first row. Every other array is
 * indexed by key id, except `ids`, which is indexed by row.
 */
export interface KeySelfTimes {
  /** Each row's key id. */
  ids: Uint32Array;
  keys: readonly string[];
  /** Rows per key, timed or not. */
  count: readonly number[];
  /** Rows per key with self time above zero. */
  timedCount: readonly number[];
  /** Self time above zero, summed per key. */
  selfTime: readonly number[];
  /** The key's first row holding its largest self time. */
  maxRow: readonly number[];
  /** The key's first row with self time above zero, or {@link NO_ROW}. */
  firstTimedRow: readonly number[];
  /** Total time over the key's outermost rows, so recursion counts its wall time once. */
  outerTotal: readonly number[];
}

/** Built in slices: the key lives on the event objects, so this touches each one. */
export async function keySelfTimes(index: LogIndex): Promise<KeySelfTimes> {
  const tick = frameBudget({});
  const { rowCount, self, total, subtreeEnd } = index;
  const ids = new Uint32Array(rowCount);
  // type, then namespace, then text: no key string is built for a row whose key is known.
  const lookup = new Map<string, Map<string, Map<string, number>>>();
  const keys: string[] = [];
  const count: number[] = [];
  const timedCount: number[] = [];
  const selfTime: number[] = [];
  const maxRow: number[] = [];
  const firstTimedRow: number[] = [];
  const outerTotal: number[] = [];
  // The row after the last counted outermost row's subtree, per key.
  const countedUntil: number[] = [];
  for (let row = 0; row < rowCount; row++) {
    if (row % CHECK_EVERY === 0) {
      await tick();
    }
    const event = index.event(row);
    const byNamespace = getOrAdd(
      lookup,
      event.type ?? '',
      () => new Map<string, Map<string, number>>(),
    );
    const byText = getOrAdd(byNamespace, `${event.namespace}`, () => new Map<string, number>());
    let id = byText.get(event.text);
    if (id === undefined) {
      id = keys.length;
      byText.set(event.text, id);
      keys.push(getEventKey(event));
      count.push(0);
      timedCount.push(0);
      selfTime.push(0);
      maxRow.push(row);
      firstTimedRow.push(NO_ROW);
      outerTotal.push(0);
      countedUntil.push(0);
    }
    // In range by construction: every row is below rowCount, every id below keys.length.
    ids[row] = id;
    count[id]!++;
    const rowSelf = self[row]!;
    if (rowSelf > 0) {
      timedCount[id]!++;
      selfTime[id]! += rowSelf;
      if (firstTimedRow[id] === NO_ROW) {
        firstTimedRow[id] = row;
      }
    }
    if (rowSelf > self[maxRow[id]!]!) {
      maxRow[id] = row;
    }
    if (row >= countedUntil[id]!) {
      outerTotal[id]! += Math.max(total[row]!, 0);
      countedUntil[id] = subtreeEnd[row]!;
    }
  }
  return { ids, keys, count, timedCount, selfTime, maxRow, firstTimedRow, outerTotal };
}

function getOrAdd<V>(map: Map<string, V>, key: string, make: () => V): V {
  let value = map.get(key);
  if (value === undefined) {
    value = make();
    map.set(key, value);
  }
  return value;
}

/**
 * The ids of every key with self time, the most first. A tie goes to the key timed
 * first, as a map filled in log order would rank it.
 */
export function idsBySelfTime(times: KeySelfTimes): number[] {
  const { selfTime, firstTimedRow } = times;
  // In range: every id comes from `selfTime.keys()`, and every per-key array is as long.
  return [...selfTime.keys()]
    .filter((id) => selfTime[id]! > 0)
    .sort((a, b) => selfTime[b]! - selfTime[a]! || firstTimedRow[a]! - firstTimedRow[b]!);
}
