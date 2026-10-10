/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { needsAll, totalsOf, type Calc, type Calcs, type Totals } from './calcs.js';
import { groupLine, headerLine, rowLine, type ExportColumn, type ExportOptions } from './export.js';
import {
  FindCollector,
  findPattern,
  FindResult,
  type CellText,
  type FindQuery,
  type PathNode,
} from './find.js';
import { byCount, Group, type GroupBy } from './groups.js';
import { CHECK_EVERY, immediateScheduler, sliceTimer, type Scheduler } from './schedule.js';
import type { Compare, ExpandPolicy, RowFilter, RowKey, TreeSource } from './types.js';

const HAS_CHILDREN = 1;
const EXPANDED = 2;
const GROUP = 4;
/** Export lines joined per slice: one join of the whole text is a long task at 500k rows. */
const EXPORT_CHUNK = 4096;

/** The rows on screen, in order. Immutable: a change publishes a new one. */
export interface RowView<R> {
  readonly size: number;
  /** A data row, or a group's header row. */
  rowAt(index: number): R | Group<R>;
  depthAt(index: number): number;
  /** A data row's key, or a group row's group key. */
  keyAt(index: number): RowKey;
  /** The row has children that pass the filters. A group row always has. */
  hasChildrenAt(index: number): boolean;
  isExpandedAt(index: number): boolean;
  /**
   * Index of the data row with this key, or of the group row with this group's key; -1
   * when it is not shown. Linear in the row count.
   */
  indexOf(target: RowKey | Group<R>): number;
}

export interface Snapshot<R> {
  /** Goes up by one on every change. */
  readonly version: number;
  readonly rows: RowView<R>;
  /** The footer: each calc over the rows that pass the filters. */
  readonly totals: Totals;
  /** A sliced step is running; `rows` is the last finished state. */
  readonly busy: boolean;
}

export interface GridStoreOptions<R> {
  scheduler?: Scheduler;
  /** Which rows start expanded. Default: none. */
  expanded?: ExpandPolicy<R>;
  calcs?: Calcs<R>;
  groupBy?: GroupBy<R> | null;
}

type Entry<R> = R | Group<R>;

/** Totals kept by the calc that made them. */
type Held<R> = Map<Calc<R>, number>;

class FlatRows<R extends object> implements RowView<R> {
  readonly rows: readonly Entry<R>[];
  readonly depths: Uint16Array;
  readonly flags: Uint8Array;
  private readonly key: (row: R) => RowKey;

  constructor(
    rows: readonly Entry<R>[],
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

  rowAt(index: number): Entry<R> {
    return this.rows[index] as Entry<R>;
  }

  depthAt(index: number): number {
    return this.depths[index] ?? 0;
  }

  keyAt(index: number): RowKey {
    const entry = this.rowAt(index);
    return entry instanceof Group ? entry.key : this.key(entry);
  }

  hasChildrenAt(index: number): boolean {
    return ((this.flags[index] ?? 0) & HAS_CHILDREN) !== 0;
  }

  isExpandedAt(index: number): boolean {
    return ((this.flags[index] ?? 0) & EXPANDED) !== 0;
  }

  indexOf(target: RowKey | Group<R>): number {
    const rows = this.rows;
    if (target instanceof Group) {
      return rows.findIndex((entry) => entry instanceof Group && entry.key === target.key);
    }
    for (let i = 0; i < rows.length; i++) {
      const entry = rows[i] as Entry<R>;
      if (!(entry instanceof Group) && this.key(entry) === target) {
        return i;
      }
    }
    return -1;
  }
}

/** A row list being built: parallel arrays, packed into a {@link FlatRows} once done. */
interface Flat<R> {
  rows: Entry<R>[];
  depths: number[];
  flags: number[];
}

/** A depth-first walk in progress: a stack of sibling lists and the next index in each. */
interface Walk<R> {
  lists: (readonly R[])[];
  at: number[];
  /** Depth of the first list. */
  depth: number;
}

/** A walk of `shown`, a sibling list already filtered and sorted, at `depth`. */
const walkOf = <R>(shown: readonly R[], depth: number): Walk<R> => ({
  lists: [shown],
  at: [0],
  depth,
});

interface Built<R extends object> {
  rows: FlatRows<R>;
  totals: Totals;
}

function flip<K>(set: Set<K>, key: K): void {
  if (!set.delete(key)) {
    set.add(key);
  }
}

/**
 * Runs `work` to its end, checking the clock every {@link CHECK_EVERY} yields. Null once
 * `stale` holds. Work resumes only while it is current, so the caches it writes stay true.
 */
async function drive<T>(
  work: Generator<void, T, void>,
  tick: () => Promise<boolean>,
  stale: () => boolean,
): Promise<{ value: T } | null> {
  let count = 0;
  for (;;) {
    const step = work.next();
    if (step.done) {
      return { value: step.value };
    }
    if (++count % CHECK_EVERY === 0 && (!(await tick()) || stale())) {
      return null;
    }
  }
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
  private calcs: Calcs<R>;
  private groupBy: GroupBy<R> | null;
  private groupCompare: Compare<Group<R>> | null = null;
  /** Groups start closed; these are open. */
  private openGroups = new Set<string>();
  /**
   * The footer for each set of filters, each calc's total kept by the calc, so a filter
   * turned off and on again costs nothing and new calcs sum only themselves. Totals hold
   * until the source changes; sort and expansion keep them.
   */
  private footers = new Map<string, Held<R>>();
  private filterIds = new WeakMap<RowFilter<R>, number>();
  private nextFilterId = 0;
  /** Group totals, kept by calc, hold until the filters, source or grouping change. */
  private groupTotals = new Map<string, Held<R>>();
  /** The waiting build changes the totals only, so it keeps the rows on screen. */
  private totalsOnly = false;

  private current: Snapshot<R>;
  private listeners = new Set<(snapshot: Snapshot<R>) => void>();
  private running = false;
  private dirty = false;
  private waiting: { resolve: () => void; reject: (error: unknown) => void }[] = [];
  /** Goes up with each find, so an older one sees it is stale. */
  private findId = 0;

  constructor(source: TreeSource<R>, options: GridStoreOptions<R> = {}) {
    this.source = source;
    this.scheduler = options.scheduler ?? immediateScheduler;
    this.expandBase = options.expanded ?? false;
    this.calcs = options.calcs ?? {};
    this.groupBy = options.groupBy ?? null;
    this.current = {
      version: 0,
      rows: this.pack({ rows: [], depths: [], flags: [] }),
      totals: {},
      busy: true,
    };
    void this.rebuild();
  }

  snapshot(): Snapshot<R> {
    return this.current;
  }

  subscribe(listener: (snapshot: Snapshot<R>) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Resolves once no step is running; rejects with the error a running step threw. */
  settled(): Promise<void> {
    return this.running
      ? new Promise((resolve, reject) => this.waiting.push({ resolve, reject }))
      : Promise.resolve();
  }

  setSource(source: TreeSource<R>): Promise<void> {
    this.source = source;
    this.toggled.clear();
    this.openGroups.clear();
    this.deepPass = new WeakMap();
    this.dropTotals();
    return this.reorder();
  }

  /**
   * Sorts each sibling list by `compare`, and the groups by `groups`. Groups keep their
   * default order, most rows first, where `groups` is absent or ties.
   */
  setSort(compare: Compare<R> | null, groups?: Compare<Group<R>> | null): Promise<void> {
    this.compare = compare;
    this.groupCompare = groups ?? null;
    return this.reorder();
  }

  setFilters(filters: readonly RowFilter<R>[]): Promise<void> {
    this.filters = filters;
    this.groupTotals.clear();
    return this.reorder();
  }

  /**
   * Runs the filters and the calcs again, for a host whose filter or calc reads state
   * that changed, such as a time window. Open rows stay open.
   */
  refresh(): Promise<void> {
    this.deepPass = new WeakMap();
    this.dropTotals();
    // With no filter the rows cannot change, and a re-sort of a large tree is not free.
    return this.filters.length ? this.reorder() : this.rebuild(!this.groupBy);
  }

  /** Sums only the calcs it has not summed before for the filters on. */
  setCalcs(calcs: Calcs<R>): Promise<void> {
    this.calcs = calcs;
    // Groups carry their totals, so a grouped grid builds its rows again.
    return this.rebuild(!this.groupBy);
  }

  /** Groups the top-level rows. Every group starts closed. */
  setGroupBy(groupBy: GroupBy<R> | null): Promise<void> {
    this.groupBy = groupBy;
    this.openGroups.clear();
    this.groupTotals.clear();
    return this.rebuild();
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
   * {@link reveal} to reach it. Takes a data row's key, or a group.
   */
  async toggle(target: RowKey | Group<R>, expanded?: boolean): Promise<void> {
    await this.settled();
    const rows = this.current.rows;
    const index = rows.indexOf(target);
    if (index === -1 || !rows.hasChildrenAt(index)) {
      return;
    }
    const was = rows.isExpandedAt(index);
    if (expanded === was) {
      return;
    }
    if (target instanceof Group) {
      flip(this.openGroups, target.key);
    } else {
      flip(this.toggled, target);
    }
    this.splice(index, !was);
  }

  /**
   * Expands each ancestor on `path` (root first, the target last) and returns the
   * target's index. Where a filter hides part of the path, it returns the deepest shown
   * row on it instead, or -1 when none is shown. Opens the group the path starts in.
   */
  async reveal(path: readonly RowKey[]): Promise<number> {
    // Sibling lists are cached as they are read, so read them only once filters are ready.
    await this.settled();
    const indent = this.groupBy ? 1 : 0;
    let list: readonly R[] = this.source.roots;
    let found: R | null = null;
    let opened = false;
    for (const [depth, key] of path.entries()) {
      const row = this.childrenOf(list).find((r) => this.source.key(r) === key);
      if (!row) {
        break;
      }
      found = row;
      if (depth === 0 && this.groupBy) {
        const group = this.groupBy(row);
        opened = !this.openGroups.has(group);
        this.openGroups.add(group);
      }
      if (depth < path.length - 1) {
        if (!this.isExpanded(row, depth + indent)) {
          flip(this.toggled, key);
          opened = true;
        }
        list = this.source.children?.(row) ?? [];
      }
    }
    if (found === null) {
      return -1;
    }
    if (!opened) {
      // The rows on screen hold the source's own objects: a native search beats a key per row.
      return (this.current.rows as FlatRows<R>).rows.indexOf(found);
    }
    await this.rebuild();
    return this.current.rows.indexOf(this.source.key(found));
  }

  /**
   * Counts `query` in each searched cell of every row that passes the filters, open or
   * not, in display order. Group rows are not searched. Null when a newer find, or a
   * change to the rows, lands while it runs.
   */
  async find(query: FindQuery, cells: readonly CellText<R>[]): Promise<FindResult<R> | null> {
    const id = ++this.findId;
    await this.settled();
    const stale = (): boolean => id !== this.findId || this.running;
    const key = (row: R): RowKey => this.source.key(row);
    const pattern = findPattern(query);
    if (stale()) {
      return null;
    }
    if (!pattern) {
      return new FindResult<R>([], new Uint32Array(0), [], new Map(), 0, key);
    }
    const found = new FindCollector(cells, pattern);
    const done = await drive(
      this.eachRow(true, (entry, up) => {
        if (!(entry instanceof Group)) {
          found.visit(entry, up);
        }
      }),
      sliceTimer(this.scheduler, stale),
      stale,
    );
    return done && !stale() ? found.result(key) : null;
  }

  /**
   * Every row that passes the filters, open or not, in display order, under a header
   * line. Null when a change to the rows lands while it runs.
   */
  async exportText(
    columns: readonly ExportColumn<R>[],
    options: ExportOptions,
  ): Promise<string | null> {
    await this.settled();
    const stale = (): boolean => this.running;
    const { format } = options;
    const tree = options.tree ?? true;
    // Every group or top-level row is on screen, open or not, so its flag tells if any row is deeper.
    const levels =
      tree && (this.current.rows as FlatRows<R>).flags.some((flag) => (flag & HAS_CHILDREN) !== 0);
    const chunks: string[] = [];
    let lines = [headerLine(columns, format, levels)];
    const done = await drive(
      this.eachRow(tree, (entry, _up, depth) => {
        const level = levels ? depth + 1 : undefined;
        lines.push(
          entry instanceof Group
            ? groupLine(entry.key, format, level)
            : rowLine(entry, columns, format, level),
        );
        if (lines.length === EXPORT_CHUNK) {
          chunks.push(lines.join('\n'));
          lines = [];
        }
      }),
      sliceTimer(this.scheduler, stale),
      stale,
    );
    if (lines.length) {
      chunks.push(lines.join('\n'));
    }
    return done && !stale() ? chunks.join('\n') : null;
  }

  private reorder(): Promise<void> {
    this.ordered = new WeakMap();
    return this.rebuild();
  }

  private dropTotals(): void {
    this.footers.clear();
    this.groupTotals.clear();
  }

  /** Names the set of filters on, for {@link footers}. */
  private filterKey(): string {
    return this.filters
      .map((filter) => {
        let id = this.filterIds.get(filter);
        if (id === undefined) {
          id = this.nextFilterId++;
          this.filterIds.set(filter, id);
        }
        return id;
      })
      .join(',');
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
   * Moves up to `budget` shown rows of a depth-first walk into `out`; true once the walk
   * is done. A plain loop, not a generator: a resume per row cost a third of expand all.
   */
  private walkSome(walk: Walk<R>, out: Flat<R>, budget: number): boolean {
    const { lists, at, depth } = walk;
    while (lists.length && budget > 0) {
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
      const kids = children?.length ? this.childrenOf(children) : null;
      const expanded = kids?.length ? this.isExpanded(row, d) : false;
      out.rows.push(row);
      out.depths.push(d);
      out.flags.push(kids?.length ? HAS_CHILDREN | (expanded ? EXPANDED : 0) : 0);
      if (expanded) {
        lists.push(kids as readonly R[]);
        at.push(0);
      }
      budget--;
    }
    return lists.length === 0;
  }

  /** Walks the whole of `walk` into `out`, checking the clock between batches. False when stale. */
  private async walkAll(
    walk: Walk<R>,
    out: Flat<R>,
    tick: () => Promise<boolean>,
  ): Promise<boolean> {
    while (!this.walkSome(walk, out, CHECK_EVERY)) {
      if (!(await tick()) || this.dirty) {
        return false;
      }
    }
    return true;
  }

  /** Replaces the rows under `index` with its subtree, or with nothing, in one copy. */
  private splice(index: number, expand: boolean): void {
    const old = this.current.rows as FlatRows<R>;
    const entry = old.rowAt(index);
    const depth = old.depthAt(index);
    let rest = index + 1;
    while (rest < old.size && old.depthAt(rest) > depth) {
      rest++;
    }
    const inserted: Flat<R> = { rows: [], depths: [], flags: [] };
    if (expand) {
      const shown =
        entry instanceof Group ? entry.rows : this.childrenOf(this.source.children?.(entry) ?? []);
      this.walkSome(walkOf(shown, depth + 1), inserted, Infinity);
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
    flags[index] = ((old.flags[index] ?? 0) & GROUP) | HAS_CHILDREN | (expand ? EXPANDED : 0);
    const rows = old.rows.slice(0, head).concat(inserted.rows, old.rows.slice(rest));
    this.publish(
      {
        rows: new FlatRows(rows, depths, flags, (row) => this.source.key(row)),
        totals: this.current.totals,
      },
      false,
    );
  }

  /**
   * Runs builds until no change is waiting, then publishes the last one. `totalsOnly` keeps
   * the rows on screen; it holds only when no build is running, as one would go stale.
   */
  private rebuild(totalsOnly = false): Promise<void> {
    this.totalsOnly = totalsOnly && !this.running;
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
    let failed: { error: unknown } | null = null;
    while (this.dirty) {
      this.dirty = false;
      const totalsOnly = this.totalsOnly;
      this.totalsOnly = false;
      try {
        const built = await this.build(totalsOnly);
        if (built) {
          this.publish(built, this.dirty);
        }
        failed = null;
      } catch (error) {
        failed = { error };
      }
    }
    this.running = false;
    this.publish(null, false);
    for (const waiter of this.waiting.splice(0)) {
      if (failed) {
        waiter.reject(failed.error);
      } else {
        waiter.resolve();
      }
    }
  }

  /**
   * The full row list and footer, in slices. Null when a newer change made it stale.
   * With `totalsOnly`, the footer alone, beside the rows on screen.
   */
  private async build(totalsOnly: boolean): Promise<Built<R> | null> {
    const tick = sliceTimer(this.scheduler, () => this.dirty);
    for (const filter of this.filters) {
      if (filter.keepAncestors && !this.deepPass.has(filter)) {
        const set = await this.deepPassOf(filter, tick);
        if (!set || this.dirty) {
          return null;
        }
        this.deepPass.set(filter, set);
      }
    }
    const stale = (): boolean => this.dirty;
    const top = this.childrenOf(this.source.roots);
    const key = this.filterKey();
    let held = this.footers.get(key);
    if (!held) {
      held = new Map();
      this.footers.set(key, held);
    }
    const footer = await drive(this.totalsFor(top, held), tick, stale);
    if (!footer || this.dirty) {
      return null;
    }
    const totals = footer.value;
    if (totalsOnly) {
      return { rows: this.current.rows as FlatRows<R>, totals };
    }
    const out: Flat<R> = { rows: [], depths: [], flags: [] };
    if (!this.groupBy) {
      return (await this.walkAll(walkOf(top, 0), out, tick)) && !this.dirty
        ? { rows: this.pack(out), totals }
        : null;
    }
    const groups = await drive(this.groupsOf(top, this.groupBy), tick, stale);
    if (!groups || this.dirty) {
      return null;
    }
    for (const group of groups.value) {
      const open = this.openGroups.has(group.key);
      out.rows.push(group);
      out.depths.push(0);
      out.flags.push(GROUP | HAS_CHILDREN | (open ? EXPANDED : 0));
      if (open && !(await this.walkAll(walkOf(group.rows, 1), out, tick))) {
        return null;
      }
    }
    return this.dirty ? null : { rows: this.pack(out), totals };
  }

  /**
   * Every row that passes the filters, open or not, in display order: each group, then its
   * rows. With `tree` false, only the top-level rows. `up` is the row's parent chain.
   * `depth` is 0 for a group or a top-level row; the rows of a group start at 1.
   */
  private *eachRow(
    tree: boolean,
    visit: (entry: Entry<R>, up: PathNode | null, depth: number) => void,
  ): Generator<void, void, void> {
    const top = this.childrenOf(this.source.roots);
    if (!this.groupBy) {
      yield* this.eachUnder(top, tree, 0, visit);
      return;
    }
    for (const group of yield* this.groupsOf(top, this.groupBy)) {
      visit(group, null, 0);
      yield* this.eachUnder(group.rows, tree, 1, visit);
    }
  }

  private *eachUnder(
    list: readonly R[],
    tree: boolean,
    depth: number,
    visit: (row: R, up: PathNode | null, depth: number) => void,
  ): Generator<void, void, void> {
    const lists: (readonly R[])[] = [list];
    const at: number[] = [0];
    const ups: (PathNode | null)[] = [null];
    while (lists.length) {
      const top = lists.length - 1;
      const siblings = lists[top] as readonly R[];
      const i = at[top] as number;
      if (i === siblings.length) {
        lists.pop();
        at.pop();
        ups.pop();
        continue;
      }
      at[top] = i + 1;
      const row = siblings[i] as R;
      const up = ups[top] ?? null;
      visit(row, up, depth + top);
      const children = tree ? this.source.children?.(row) : null;
      const kids = children?.length ? this.childrenOf(children) : null;
      if (kids?.length) {
        lists.push(kids);
        at.push(0);
        ups.push({ key: this.source.key(row), up });
      }
      yield;
    }
  }

  /** `top` split into groups, in group order, each with its totals. */
  private *groupsOf(top: readonly R[], groupBy: GroupBy<R>): Generator<void, Group<R>[], void> {
    const buckets = new Map<string, R[]>();
    for (const row of top) {
      const key = groupBy(row);
      const bucket = buckets.get(key);
      if (bucket) {
        bucket.push(row);
      } else {
        buckets.set(key, [row]);
      }
      yield;
    }
    const groups: Group<R>[] = [];
    for (const [key, rows] of buckets) {
      let held = this.groupTotals.get(key);
      if (!held) {
        held = new Map();
        this.groupTotals.set(key, held);
      }
      groups.push(new Group(key, rows, yield* this.totalsFor(rows, held)));
    }
    groups.sort(byCount);
    // Array sort is stable, so groups that tie keep the default order.
    return this.groupCompare ? groups.sort(this.groupCompare) : groups;
  }

  /**
   * Each calc over `top`, or over every row under it that passes the filters. Only calcs
   * missing from `held` run; their totals go into it.
   */
  private *totalsFor(top: readonly R[], held: Held<R>): Generator<void, Totals, void> {
    const named = Object.entries(this.calcs);
    const missing = Object.fromEntries(named.filter(([, calc]) => !held.has(calc)));
    if (Object.keys(missing).length) {
      const all = needsAll(missing) ? yield* this.allUnder(top) : [];
      const made = yield* totalsOf(missing, top, all);
      for (const [name, calc] of Object.entries(missing)) {
        held.set(calc, made[name] as number);
      }
    }
    return Object.fromEntries(named.map(([name, calc]) => [name, held.get(calc) as number]));
  }

  /** Every row under `top` that passes the filters, at any depth, in no set order. */
  private *allUnder(top: readonly R[]): Generator<void, R[], void> {
    const all: R[] = [];
    const lists: (readonly R[])[] = [top];
    while (lists.length) {
      for (const row of lists.pop() as readonly R[]) {
        all.push(row);
        const children = this.source.children?.(row);
        if (children?.length) {
          // Filter only: order does not change a total, and sorting every list costs.
          lists.push(this.filters.length ? children.filter((r) => this.passes(r)) : children);
        }
        // A yield per row costs more than the walk; drive reads the clock every CHECK_EVERY yields.
        if (all.length % 64 === 0) {
          yield;
        }
      }
    }
    return all;
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

  private publish(built: Built<R> | null, busy: boolean): void {
    this.current = {
      version: this.current.version + 1,
      rows: built?.rows ?? this.current.rows,
      totals: built?.totals ?? this.current.totals,
      busy,
    };
    for (const listener of this.listeners) {
      listener(this.current);
    }
  }
}
