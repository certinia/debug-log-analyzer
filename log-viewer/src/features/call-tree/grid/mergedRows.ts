/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { LogStore } from '../../../core/log/LogStore.js';
import type { RowKey, TreeSource } from '../../../grid/index.js';
import {
  buildAggregatedTree,
  buildBottomUpTree,
  type AggregatedRow,
  type BottomUpRow,
} from '../utils/Aggregation.js';
import { reportedUsageOf } from '../utils/reportedUsage.js';

/** A row of a merged view: Aggregated or Bottom-Up. */
export interface MergedRowShape<R> {
  id: number;
  _pathId: number;
  _children?: R[] | null;
}

/**
 * A built Aggregated or Bottom-Up tree, with the parent and path-id lookups its rows
 * lack. The inspector names rows by path id, the grid by row key.
 */
export class MergedTree<R extends MergedRowShape<R>> {
  readonly source: TreeSource<R>;
  private readonly _parents = new Map<R, R>();
  private readonly _byPath = new Map<number, R>();

  /** The Bottom-Up tree of the events `store` shows, or null when `signal` aborts the build. */
  static async bottomUp(
    store: LogStore,
    options: { signal?: AbortSignal } = {},
  ): Promise<MergedTree<BottomUpRow> | null> {
    const roots = await buildBottomUpTree(store, options, await reportedUsageOf(store.log));
    return roots ? new MergedTree(roots) : null;
  }

  /** The Aggregated tree of the events `store` shows, or null when `signal` aborts the build. */
  static async aggregated(
    store: LogStore,
    options: { signal?: AbortSignal } = {},
  ): Promise<MergedTree<AggregatedRow> | null> {
    const roots = await buildAggregatedTree(store, options, await reportedUsageOf(store.log));
    return roots ? new MergedTree(roots) : null;
  }

  constructor(roots: readonly R[]) {
    const walk = (row: R): void => {
      this._byPath.set(row._pathId, row);
      for (const child of row._children ?? []) {
        this._parents.set(child, row);
        walk(child);
      }
    };
    roots.forEach(walk);
    this.source = { roots, children: (row) => row._children, key: (row) => row.id };
  }

  parentOf(row: R): R | undefined {
    return this._parents.get(row);
  }

  /** The keys of every row `pathIds` name. */
  marked(pathIds: readonly number[]): Set<RowKey> {
    return new Set(pathIds.flatMap((id) => this._byPath.get(id)?.id ?? []));
  }

  /** The row `pathIds` name nearest the top: a frame heads its own bucket and sits under callers in others. */
  rowFor(pathIds: readonly number[]): R | undefined {
    let nearest: R | undefined;
    for (const id of pathIds) {
      const row = this._byPath.get(id);
      if (row && !this._parents.has(row)) {
        return row;
      }
      nearest ??= row;
    }
    return nearest;
  }

  /** The keys from a top-level row down to the {@link rowFor} of `pathIds`. */
  pathTo(pathIds: readonly number[]): RowKey[] {
    const path: RowKey[] = [];
    for (let row = this.rowFor(pathIds); row; row = this._parents.get(row)) {
      path.unshift(row.id);
    }
    return path;
  }
}
