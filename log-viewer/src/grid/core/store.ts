/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { CHECK_EVERY, immediateScheduler, sliceTimer, type Scheduler } from './schedule.js';
import type { Compare, ExpandPolicy, RowFilter, RowKey, TreeSource } from './types.js';

const HAS_CHILDREN = 1;
const EXPANDED = 2;

/** The rows on screen, in order. Immutable: a change publishes a new one. */
export interface RowView<R> {
  readonly size: number;
  rowAt(index: number): R;
  depthAt(index: number): number;
  keyAt(index: number): RowKey;
  /** The row has children that pass the filters. */
  hasChildrenAt(index: number): boolean;
  isExpandedAt(index: number): boolean;
  /** Index of the row with `key`, or -1 when it is not shown. Linear in the row count. */
  indexOf(key: RowKey): number;
}

export interface Snapshot<R> {
  /** Goes up by one on every change. */
  readonly version: number;
  readonly rows: RowView<R>;
  /** A sliced step is running; `rows` is the last finished state. */
  readonly busy: boolean;
}

export interface GridStoreOptions<R> {
  scheduler?: Scheduler;
  /** Which rows start expanded. Default: none. */
  expanded?: ExpandPolicy<R>;
}

class FlatRows<R extends object> implements RowView<R> {
  readonly rows: readonly R[];
  readonly depths: Uint16Array;
  readonly flags: Uint8Array;
  private readonly key: (row: R) => RowKey;

  constructor(rows: readonly R[], depths: Uint16Array, flags: Uint8Array, key: (row: R) => RowKey) {
    this.rows = rows;
    this.depths = depths;
    this.flags = flags;
    this.key = key;
  }

  get size(): number {
    return this.rows.length;
  }

  rowAt(index: number): R {
    return this.rows[index] as R;
  }

  depthAt(index: number): number {
    return this.depths[index] ?? 0;
  }

  keyAt(index: number): RowKey {
    return this.key(this.rowAt(index));
  }

  hasChildrenAt(index: number): boolean {
    return ((this.flags[index] ?? 0) & HAS_CHILDREN) !== 0;
  }

  isExpandedAt(index: number): boolean {
    return ((this.flags[index] ?? 0) & EXPANDED) !== 0;
  }

  indexOf(key: RowKey): number {
    const rows = this.rows;
    for (let i = 0; i < rows.length; i++) {
      if (this.key(rows[i] as R) === key) {
        return i;
      }
    }
    return -1;
  }
}

/** A row list being built: parallel arrays, packed into a {@link FlatRows} once done. */
interface Flat<R> {
  rows: R[];
  depths: number[];
  flags: number[];
}

/**
 * The grid's state and the one source of truth for the rows on screen.
 *
 * Sort and filter run on a sibling list only when that list is shown, and are cached
 * per list. Long steps run in slices on the given scheduler; a newer change restarts a
 * running one, and each method resolves once the snapshot shows its change.
 */
export class GridStore<R extends object> {
  private source: TreeSource<R>;
  private readonly scheduler: Scheduler;
  private expandBase: ExpandPolicy<R>;
  /** Rows whose expansion differs from `expandBase`. */
  private toggled = new Set<RowKey>();
  private compare: Compare<R> | null = null;
  private filters: readonly RowFilter<R>[] = [];
  /** Each sibling list after filter and sort, built when the list is first shown. */
  private ordered = new WeakMap<readonly R[], readonly R[]>();
  /** For each `keepAncestors` filter: the rows that pass or have a descendant that passes. */
  private deepPass = new WeakMap<RowFilter<R>, WeakSet<R>>();

  private current: Snapshot<R>;
  private listeners = new Set<(snapshot: Snapshot<R>) => void>();
  private running = false;
  private dirty = false;
  private waiting: (() => void)[] = [];

  constructor(source: TreeSource<R>, options: GridStoreOptions<R> = {}) {
    this.source = source;
    this.scheduler = options.scheduler ?? immediateScheduler;
    this.expandBase = options.expanded ?? false;
    this.current = { version: 0, rows: this.pack({ rows: [], depths: [], flags: [] }), busy: true };
    void this.rebuild();
  }

  snapshot(): Snapshot<R> {
    return this.current;
  }

  subscribe(listener: (snapshot: Snapshot<R>) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Resolves once no step is running. */
  settled(): Promise<void> {
    return this.running ? new Promise((resolve) => this.waiting.push(resolve)) : Promise.resolve();
  }

  setSource(source: TreeSource<R>): Promise<void> {
    this.source = source;
    this.toggled.clear();
    this.deepPass = new WeakMap();
    return this.reorder();
  }

  setSort(compare: Compare<R> | null): Promise<void> {
    this.compare = compare;
    return this.reorder();
  }

  setFilters(filters: readonly RowFilter<R>[]): Promise<void> {
    this.filters = filters;
    return this.reorder();
  }

  expandAll(): Promise<void> {
    this.expandBase = true;
    this.toggled.clear();
    return this.rebuild();
  }

  collapseAll(): Promise<void> {
    this.expandBase = false;
    this.toggled.clear();
    return this.rebuild();
  }

  /**
   * Expands or collapses a shown row; `expanded` omitted flips it. The subtree is spliced
   * in or out at once, without a rebuild. A row that is not shown is left alone: use
   * {@link reveal} to reach it.
   */
  async toggle(key: RowKey, expanded?: boolean): Promise<void> {
    await this.settled();
    const rows = this.current.rows;
    const index = rows.indexOf(key);
    if (index === -1 || !rows.hasChildrenAt(index)) {
      return;
    }
    const was = rows.isExpandedAt(index);
    if (expanded === was) {
      return;
    }
    this.flip(key);
    this.splice(index, !was);
  }

  /**
   * Expands each ancestor on `path` (root first, the target last) and returns the
   * target's index. Where a filter hides part of the path, it returns the deepest shown
   * row on it instead, or -1 when none is shown.
   */
  async reveal(path: readonly RowKey[]): Promise<number> {
    // Sibling lists are cached as they are read, so read them only once filters are ready.
    await this.settled();
    let list: readonly R[] = this.source.roots;
    let found: RowKey | null = null;
    for (const [depth, key] of path.entries()) {
      const row = this.childrenOf(list).find((r) => this.source.key(r) === key);
      if (!row) {
        break;
      }
      found = key;
      if (depth < path.length - 1) {
        if (!this.isExpanded(row, depth)) {
          this.flip(key);
        }
        list = this.source.children?.(row) ?? [];
      }
    }
    await this.rebuild();
    return found === null ? -1 : this.current.rows.indexOf(found);
  }

  private flip(key: RowKey): void {
    if (!this.toggled.delete(key)) {
      this.toggled.add(key);
    }
  }

  private reorder(): Promise<void> {
    this.ordered = new WeakMap();
    return this.rebuild();
  }

  private isExpanded(row: R, depth: number): boolean {
    const base =
      typeof this.expandBase === 'function' ? this.expandBase(row, depth) : this.expandBase;
    return base !== this.toggled.has(this.source.key(row));
  }

  private passes(row: R): boolean {
    for (const filter of this.filters) {
      const pass = filter.keepAncestors
        ? (this.deepPass.get(filter)?.has(row) ?? false)
        : filter.test(row);
      if (!pass) {
        return false;
      }
    }
    return true;
  }

  /** A sibling list after filter and sort, cached until either changes. */
  private childrenOf(list: readonly R[]): readonly R[] {
    let out = this.ordered.get(list);
    if (!out) {
      out = this.filters.length ? list.filter((r) => this.passes(r)) : list;
      if (this.compare) {
        out = out === list ? list.toSorted(this.compare) : (out as R[]).sort(this.compare);
      }
      this.ordered.set(list, out);
    }
    return out;
  }

  /**
   * Depth-first over the shown rows under `list`, which sits at `depth`. Yields after
   * each row, so a caller can slice the walk; the row lands in `out` first.
   */
  private *walk(list: readonly R[], depth: number, out: Flat<R>): Generator<void> {
    const lists: (readonly R[])[] = [this.childrenOf(list)];
    const at: number[] = [0];
    while (lists.length) {
      const top = lists.length - 1;
      const siblings = lists[top] as readonly R[];
      const i = at[top] as number;
      if (i === siblings.length) {
        lists.pop();
        at.pop();
        continue;
      }
      at[top] = i + 1;
      const row = siblings[i] as R;
      const d = depth + top;
      const children = this.source.children?.(row);
      const shown = children?.length ? this.childrenOf(children) : null;
      const expanded = shown?.length ? this.isExpanded(row, d) : false;
      out.rows.push(row);
      out.depths.push(d);
      out.flags.push(shown?.length ? HAS_CHILDREN | (expanded ? EXPANDED : 0) : 0);
      if (expanded) {
        lists.push(shown as readonly R[]);
        at.push(0);
      }
      yield;
    }
  }

  /** Replaces the rows under `index` with its subtree, or with nothing, in one copy. */
  private splice(index: number, expand: boolean): void {
    const old = this.current.rows as FlatRows<R>;
    const depth = old.depthAt(index);
    let rest = index + 1;
    while (rest < old.size && old.depthAt(rest) > depth) {
      rest++;
    }
    const inserted: Flat<R> = { rows: [], depths: [], flags: [] };
    if (expand) {
      for (const _ of this.walk(
        this.source.children?.(old.rowAt(index)) ?? [],
        depth + 1,
        inserted,
      )) {
        // the walk fills `inserted`
      }
    }
    const head = index + 1;
    const tail = head + inserted.rows.length;
    const size = tail + (old.size - rest);
    const depths = new Uint16Array(size);
    const flags = new Uint8Array(size);
    depths.set(old.depths.subarray(0, head));
    depths.set(inserted.depths, head);
    depths.set(old.depths.subarray(rest), tail);
    flags.set(old.flags.subarray(0, head));
    flags.set(inserted.flags, head);
    flags.set(old.flags.subarray(rest), tail);
    flags[index] = HAS_CHILDREN | (expand ? EXPANDED : 0);
    const rows = old.rows.slice(0, head).concat(inserted.rows, old.rows.slice(rest));
    this.publish(new FlatRows(rows, depths, flags, (row) => this.source.key(row)), false);
  }

  /** Runs builds until no change is waiting, then publishes the last one. */
  private rebuild(): Promise<void> {
    this.dirty = true;
    if (!this.running) {
      // run() marks itself running before its first await, so settled() below waits for it.
      void this.run();
    }
    return this.settled();
  }

  private async run(): Promise<void> {
    this.running = true;
    this.publish(null, true);
    while (this.dirty) {
      this.dirty = false;
      const rows = await this.build();
      if (rows) {
        this.publish(rows, this.dirty);
      }
    }
    this.running = false;
    this.publish(null, false);
    for (const resolve of this.waiting.splice(0)) {
      resolve();
    }
  }

  /** The full row list, in slices. Null when a newer change made it stale. */
  private async build(): Promise<FlatRows<R> | null> {
    const tick = sliceTimer(this.scheduler, () => this.dirty);
    for (const filter of this.filters) {
      if (filter.keepAncestors && !this.deepPass.has(filter)) {
        const set = await this.deepPassOf(filter, tick);
        if (!set) {
          return null;
        }
        this.deepPass.set(filter, set);
      }
    }
    const out: Flat<R> = { rows: [], depths: [], flags: [] };
    let count = 0;
    for (const _ of this.walk(this.source.roots, 0, out)) {
      if (++count % CHECK_EVERY === 0 && !(await tick())) {
        return null;
      }
    }
    return this.pack(out);
  }

  /** Rows that pass `filter` or have a descendant that does: one post-order walk of the tree. */
  private async deepPassOf(
    filter: RowFilter<R>,
    tick: () => Promise<boolean>,
  ): Promise<WeakSet<R> | null> {
    const pass = new WeakSet<R>();
    const children = (row: R): readonly R[] => this.source.children?.(row) ?? [];
    const stack: { row: R; next: number }[] = this.source.roots
      .map((row) => ({ row, next: 0 }))
      .reverse();
    let count = 0;
    while (stack.length) {
      if (++count % CHECK_EVERY === 0 && !(await tick())) {
        return null;
      }
      const top = stack[stack.length - 1] as { row: R; next: number };
      const kids = children(top.row);
      if (top.next < kids.length) {
        stack.push({ row: kids[top.next++] as R, next: 0 });
        continue;
      }
      stack.pop();
      if (filter.test(top.row) || kids.some((k) => pass.has(k))) {
        pass.add(top.row);
      }
    }
    return pass;
  }

  private pack(flat: Flat<R>): FlatRows<R> {
    return new FlatRows(
      flat.rows,
      Uint16Array.from(flat.depths),
      Uint8Array.from(flat.flags),
      (row) => this.source.key(row),
    );
  }

  private publish(rows: FlatRows<R> | null, busy: boolean): void {
    this.current = { version: this.current.version + 1, rows: rows ?? this.current.rows, busy };
    for (const listener of this.listeners) {
      listener(this.current);
    }
  }
}
