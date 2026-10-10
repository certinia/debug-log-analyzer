/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { RowComponent } from 'tabulator-tables';

import type { RowKey } from '../../../grid/index.js';

/** The Tabulator row shape `locatedRow` reads, for a row of an lv-grid. */
export function rowStandIn<R>(
  row: R,
  data: (row: R) => object,
  parentOf: (row: R) => R | undefined,
): RowComponent {
  return {
    getData: () => data(row),
    getTreeParent: () => {
      const parent = parentOf(row);
      return parent ? rowStandIn(parent, data, parentOf) : false;
    },
  } as unknown as RowComponent;
}

/** A row of a merged view: Aggregated or Bottom-Up. */
interface MergedRow<R> {
  id: number;
  _pathId: number;
  _children?: R[] | null;
}

/** The parent of each merged row, and each row by its path id: the rows have neither. */
export interface MergedLinks<R> {
  parents: Map<R, R>;
  byPath: Map<number, R>;
}

/** Indexes the rows under `roots` by parent and by path id. */
export function linkRows<R extends MergedRow<R>>(roots: readonly R[]): MergedLinks<R> {
  const parents = new Map<R, R>();
  const byPath = new Map<number, R>();
  const walk = (row: R): void => {
    byPath.set(row._pathId, row);
    for (const child of row._children ?? []) {
      parents.set(child, row);
      walk(child);
    }
  };
  roots.forEach(walk);
  return { parents, byPath };
}

/**
 * The row `pathIds` name nearest the top. A frame heads the bucket for its own
 * method and also names the caller rows it sits under in other buckets.
 */
export function mergedRow<R extends MergedRow<R>>(
  links: MergedLinks<R> | null,
  pathIds: readonly number[],
): R | undefined {
  let nearest: R | undefined;
  for (const id of pathIds) {
    const row = links?.byPath.get(id);
    if (row && !links?.parents.has(row)) {
      return row;
    }
    nearest ??= row;
  }
  return nearest;
}

/** The keys from a top-level row down to the {@link mergedRow} of `pathIds`. */
export function mergedPath<R extends MergedRow<R>>(
  links: MergedLinks<R> | null,
  pathIds: readonly number[],
): RowKey[] {
  const path: RowKey[] = [];
  for (let row = mergedRow(links, pathIds); row; row = links?.parents.get(row)) {
    path.unshift(row.id);
  }
  return path;
}

/** The keys of every row `pathIds` name. */
export function markedIds<R extends MergedRow<R>>(
  links: MergedLinks<R> | null,
  pathIds: readonly number[],
): Set<number> {
  return new Set(pathIds.flatMap((id) => links?.byPath.get(id)?.id ?? []));
}
