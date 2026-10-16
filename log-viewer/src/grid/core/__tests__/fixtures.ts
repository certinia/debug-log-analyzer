/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { Group, type GridStore, type RowView, type Scheduler, type TreeSource } from '../index.js';

interface Keyed<N> {
  key: string | number;
  children?: N[];
}

export const source = <N extends Keyed<N>>(roots: N[]): TreeSource<N> => ({
  roots,
  children: (row) => row.children,
  key: (row) => row.key,
});

/** `[group]` for a group row, `key@depth` for a data row; `+`/`-` mark open and closed. */
export function shown<N extends Keyed<N>>(rows: RowView<N>): string[] {
  const out: string[] = [];
  for (let i = 0; i < rows.size; i++) {
    const entry = rows.rowAt(i);
    const mark = rows.hasChildrenAt(i) ? (rows.isExpandedAt(i) ? '+' : '-') : '';
    out.push(
      entry instanceof Group ? `[${entry.key}]${mark}` : `${entry.key}${mark}@${rows.depthAt(i)}`,
    );
  }
  return out;
}

export async function rowsOf<N extends object>(store: GridStore<N>): Promise<RowView<N>> {
  await store.settled();
  return store.snapshot().rows;
}

export function groupOf<N extends object>(store: GridStore<N>, key: string): Group<N> {
  const rows = store.snapshot().rows;
  for (let i = 0; i < rows.size; i++) {
    const entry = rows.rowAt(i);
    if (entry instanceof Group && entry.key === key) {
      return entry;
    }
  }
  throw new Error(`no group ${key}`);
}

/** Yields on every check, so each sliced step takes many turns of the event loop. */
export function slowScheduler(): Scheduler {
  let t = 0;
  return { now: () => (t += 100), yield: () => new Promise((r) => setTimeout(r, 0)) };
}
