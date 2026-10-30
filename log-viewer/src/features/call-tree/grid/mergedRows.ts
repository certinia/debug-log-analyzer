/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { ROOT_PATH_ID, type KeyPathIds } from '#core/log/keyPathIds.js';
import type { LogStore } from '#core/log/LogStore.js';
import type { RowKey, TreeSource } from '../../../grid/index.js';
import {
  buildAggregatedTree,
  buildBottomUpTree,
  type AggregatedRow,
  type BottomUpRow,
  type KeyRows,
} from '../utils/Aggregation.js';
import { reportedUsageOf } from '../utils/reportedUsage.js';

/** One store's Bottom-Up build, and the callers still waiting for it. */
interface SharedBuild {
  tree: Promise<MergedTree<BottomUpRow> | null>;
  stop: AbortController;
  waiting: number;
  done: boolean;
}

const bottomUpBuilds = new WeakMap<LogStore, SharedBuild>();

function bottomUpBuild(store: LogStore): SharedBuild {
  const running = bottomUpBuilds.get(store);
  if (running) {
    return running;
  }
  const stop = new AbortController();
  const shared: SharedBuild = {
    stop,
    waiting: 0,
    done: false,
    tree: reportedUsageOf(store.log).then(async (usage) => {
      const rowsByKey = new Map<number, KeyRows<BottomUpRow>>();
      const roots = await buildBottomUpTree(store, { signal: stop.signal }, usage, rowsByKey);
      return roots && new MergedTree(roots, store.keyPathIds(), rowsByKey);
    }),
  };
  // A failed or stopped build is forgotten, so the next caller builds again.
  const settle = (tree: MergedTree<BottomUpRow> | null): void => {
    shared.done = true;
    if (!tree && bottomUpBuilds.get(store) === shared) {
      bottomUpBuilds.delete(store);
    }
  };
  shared.tree.then(settle, () => settle(null));
  bottomUpBuilds.set(store, shared);
  return shared;
}

/** `work`, or null as soon as `signal` aborts; an error after the abort is not this caller's. */
function untilAborted<T>(work: Promise<T>, signal?: AbortSignal): Promise<T | null> {
  if (!signal) {
    return work;
  }
  return new Promise((resolve, reject) => {
    const abort = (): void => resolve(null);
    signal.addEventListener('abort', abort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

/** A row of a merged view: Aggregated or Bottom-Up. */
export interface MergedRowShape<R> {
  id: number;
  _pathId: number;
  _parent?: R | null;
  _nextOfKey?: R | null;
  _children?: R[] | null;
}

/**
 * A built Aggregated or Bottom-Up tree, with the path-id lookups its rows lack.
 * The inspector names rows by path id, the grid by row key.
 */
export class MergedTree<R extends MergedRowShape<R>> {
  readonly source: TreeSource<R>;
  private readonly _paths: Pick<KeyPathIds, 'keyIdOfPath' | 'parentOf'>;
  private readonly _rowsByKey: ReadonlyMap<number, KeyRows<R>>;
  // A view marks its pick again on each pointer-leave, with the same array.
  private _lastMark: { pathIds: readonly number[]; keys: Set<RowKey> } | null = null;

  /**
   * The Bottom-Up tree of the events `store` shows, built once per store and shared, so its
   * rows must not be changed. Null as soon as `signal` aborts; the build stops once no caller waits.
   */
  static async bottomUp(
    store: LogStore,
    options: { signal?: AbortSignal } = {},
  ): Promise<MergedTree<BottomUpRow> | null> {
    const { signal } = options;
    if (signal?.aborted) {
      return null;
    }
    const build = bottomUpBuild(store);
    build.waiting++;
    try {
      return await untilAborted(build.tree, signal);
    } finally {
      if (--build.waiting === 0 && !build.done) {
        build.stop.abort();
        // Gone now, so a caller that comes next starts a build of its own, not a stopped one.
        if (bottomUpBuilds.get(store) === build) {
          bottomUpBuilds.delete(store);
        }
      }
    }
  }

  /** The Aggregated tree of the events `store` shows, or null when `signal` aborts the build. */
  static async aggregated(
    store: LogStore,
    options: { signal?: AbortSignal } = {},
  ): Promise<MergedTree<AggregatedRow> | null> {
    const usage = await reportedUsageOf(store.log);
    const rowsByKey = new Map<number, KeyRows<AggregatedRow>>();
    const roots = await buildAggregatedTree(store, options, usage, rowsByKey);
    return roots ? new MergedTree(roots, store.keyPathIds(), rowsByKey) : null;
  }

  /**
   * @param paths - the table that minted the rows' path ids
   * @param rowsByKey - every row of the tree, by the key id its path ends in
   */
  constructor(
    roots: readonly R[],
    paths: Pick<KeyPathIds, 'keyIdOfPath' | 'parentOf'>,
    rowsByKey: ReadonlyMap<number, KeyRows<R>>,
  ) {
    this._paths = paths;
    this._rowsByKey = rowsByKey;
    this.source = { roots, children: (row) => row._children, key: (row) => row.id };
  }

  parentOf(row: R): R | undefined {
    return row._parent ?? undefined;
  }

  /** The keys of every row `pathIds` name. Shared with the next call for the same array. */
  marked(pathIds: readonly number[]): Set<RowKey> {
    if (this._lastMark?.pathIds === pathIds) {
      return this._lastMark.keys;
    }
    const keys = new Set<RowKey>();
    this._eachRowAt(pathIds, (row) => keys.add(row.id));
    this._lastMark = { pathIds, keys };
    return keys;
  }

  /** The row `pathIds` name nearest the top: a frame heads its own bucket and sits under callers in others. */
  rowFor(pathIds: readonly number[]): R | undefined {
    // Only a path with no parent path can name a top-level row, so most ids skip the search.
    for (const id of pathIds) {
      if (this._paths.parentOf(id) === ROOT_PATH_ID) {
        const top = this.source.roots.find((row) => row._pathId === id);
        if (top) {
          return top;
        }
      }
    }
    const rows = new Map<number, R>();
    this._eachRowAt(pathIds, (row) => rows.set(row._pathId, row));
    return pathIds.map((id) => rows.get(id)).find((row) => row !== undefined);
  }

  /** The keys from a top-level row down to the {@link rowFor} of `pathIds`. */
  pathTo(pathIds: readonly number[]): RowKey[] {
    const path: RowKey[] = [];
    for (let row = this.rowFor(pathIds); row; row = this.parentOf(row)) {
      path.unshift(row.id);
    }
    return path;
  }

  private _eachRowAt(pathIds: readonly number[], found: (row: R) => void): void {
    const wanted = new Set(pathIds);
    const keyIds = new Set<number>();
    for (const id of pathIds) {
      keyIds.add(this._paths.keyIdOfPath(id));
    }
    for (const keyId of keyIds) {
      let row = this._rowsByKey.get(keyId)?.first;
      for (; row; row = row._nextOfKey) {
        if (wanted.has(row._pathId)) {
          found(row);
        }
      }
    }
  }
}
