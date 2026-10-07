/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { type LogIndex, sumSelfBy } from '../core/log/LogIndex.js';
import { DEFAULT_NAMESPACE } from '../core/utility/CallerNamespace.js';
import { CHECK_EVERY, frameBudget } from '../core/utility/FrameBudget.js';

export interface NamespaceTime {
  namespace: string;
  selfTime: number;
}

/** Each index row's namespace, as an index into `names`. */
export interface NamespaceColumn {
  ids: Uint16Array;
  names: readonly string[];
}

/** The namespace of every row. Built in slices: the namespace lives on the event
 *  objects, so this touches each one. */
export async function namespaceColumn(index: LogIndex): Promise<NamespaceColumn> {
  const tick = frameBudget({});
  const ids = new Uint16Array(index.rowCount);
  const lookup = new Map<string, number>();
  for (let row = 0; row < index.rowCount; row++) {
    if (row % CHECK_EVERY === 0) {
      await tick();
    }
    const namespace = index.event(row).namespace || DEFAULT_NAMESPACE;
    let id = lookup.get(namespace);
    if (id === undefined) {
      id = lookup.size;
      lookup.set(namespace, id);
    }
    ids[row] = id;
  }
  return { ids, names: [...lookup.keys()] };
}

/** Self time per namespace over the subtrees of `rows`, largest first, or over the
 *  whole log when `rows` is null. */
export function namespaceSelfTimes(
  index: LogIndex,
  column: NamespaceColumn,
  rows: readonly number[] | null,
): NamespaceTime[] {
  const sums = sumSelfBy(index, column.ids, column.names.length, rows);
  return column.names
    .map((namespace, id) => ({ namespace, selfTime: sums[id]! }))
    .filter(({ selfTime }) => selfTime > 0)
    .sort((a, b) => b.selfTime - a.selfTime);
}

/** Self time per namespace, ranked for display: empty buckets go, largest first. */
export function toNamespaceTimes(totals: ReadonlyMap<string, number>): NamespaceTime[] {
  return [...totals]
    .filter(([, selfTime]) => selfTime > 0)
    .map(([namespace, selfTime]) => ({ namespace, selfTime }))
    .sort((a, b) => b.selfTime - a.selfTime);
}
