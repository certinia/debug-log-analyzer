/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { Group, type RowKey, type RowTarget } from './types.js';

export const HAS_CHILDREN = 1;
export const EXPANDED = 2;
export const GROUP = 4;

/** The rows on screen, in order. Immutable: a change publishes a new one. */
export interface RowView<R> {
  readonly size: number;
  /** A data row, or a group's header row. */
  rowAt(index: number): R | Group<R>;
  depthAt(index: number): number;
  /** A data row's key, or a group row's group key. */
  keyAt(index: number): RowKey;
  targetAt(index: number): RowTarget<R>;
  /** The row has children that pass the filters. A group row always has. */
  hasChildrenAt(index: number): boolean;
  isExpandedAt(index: number): boolean;
  /** The index of `target`, or -1 when it is not shown. Linear in the row count. */
  indexOf(target: RowTarget<R>): number;
}

/** The parent row or group of the row at `index`, or -1 for a top-level row. */
export function parentIndex<R>(rows: RowView<R>, index: number): number {
  const depth = rows.depthAt(index);
  for (let i = index - 1; i >= 0; i--) {
    if (rows.depthAt(i) < depth) {
      return i;
    }
  }
  return -1;
}

export class FlatRows<R extends object> implements RowView<R> {
  readonly rows: readonly (R | Group<R>)[];
  readonly depths: Uint16Array;
  readonly flags: Uint8Array;
  private readonly key: (row: R) => RowKey;

  constructor(
    rows: readonly (R | Group<R>)[],
    depths: Uint16Array,
    flags: Uint8Array,
    key: (row: R) => RowKey,
  ) {
    this.rows = rows;
    this.depths = depths;
    this.flags = flags;
    this.key = key;
  }

  get size(): number {
    return this.rows.length;
  }

  rowAt(index: number): R | Group<R> {
    return this.rows[index] as R | Group<R>;
  }

  depthAt(index: number): number {
    return this.depths[index] ?? 0;
  }

  keyAt(index: number): RowKey {
    const entry = this.rowAt(index);
    return entry instanceof Group ? entry.key : this.key(entry);
  }

  targetAt(index: number): RowTarget<R> {
    const entry = this.rowAt(index);
    return entry instanceof Group ? entry : this.key(entry);
  }

  hasChildrenAt(index: number): boolean {
    return ((this.flags[index] ?? 0) & HAS_CHILDREN) !== 0;
  }

  isExpandedAt(index: number): boolean {
    return ((this.flags[index] ?? 0) & EXPANDED) !== 0;
  }

  indexOf(target: RowTarget<R>): number {
    const rows = this.rows;
    if (target instanceof Group) {
      return rows.findIndex((entry) => entry instanceof Group && entry.key === target.key);
    }
    for (let i = 0; i < rows.length; i++) {
      const entry = rows[i] as R | Group<R>;
      if (!(entry instanceof Group) && this.key(entry) === target) {
        return i;
      }
    }
    return -1;
  }
}

/** A row list being built: parallel arrays, packed into a {@link FlatRows} once done. */
export interface Flat<R> {
  rows: (R | Group<R>)[];
  depths: number[];
  flags: number[];
}

export const emptyFlat = <R>(): Flat<R> => ({ rows: [], depths: [], flags: [] });

export function pack<R extends object>(flat: Flat<R>, key: (row: R) => RowKey): FlatRows<R> {
  return new FlatRows(flat.rows, Uint16Array.from(flat.depths), Uint8Array.from(flat.flags), key);
}

/** `old` with the subtree under `index` replaced by `inserted`, or removed when it is null. */
export function spliceRows<R extends object>(
  old: FlatRows<R>,
  index: number,
  inserted: Flat<R> | null,
  key: (row: R) => RowKey,
): FlatRows<R> {
  const depth = old.depthAt(index);
  let rest = index + 1;
  while (rest < old.size && old.depthAt(rest) > depth) {
    rest++;
  }
  const added = inserted ?? emptyFlat<R>();
  const head = index + 1;
  const tail = head + added.rows.length;
  const size = tail + (old.size - rest);
  const depths = new Uint16Array(size);
  const flags = new Uint8Array(size);
  depths.set(old.depths.subarray(0, head));
  depths.set(added.depths, head);
  depths.set(old.depths.subarray(rest), tail);
  flags.set(old.flags.subarray(0, head));
  flags.set(added.flags, head);
  flags.set(old.flags.subarray(rest), tail);
  flags[index] = ((old.flags[index] ?? 0) & GROUP) | HAS_CHILDREN | (inserted ? EXPANDED : 0);
  const rows = old.rows.slice(0, head).concat(added.rows, old.rows.slice(rest));
  return new FlatRows(rows, depths, flags, key);
}
