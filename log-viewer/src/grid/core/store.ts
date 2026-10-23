/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { needsAll, totalsOf, type Calc, type Calcs, type Totals } from './calcs.js';
import { groupLine, headerLine, rowLine, type ExportColumn, type ExportOptions } from './export.js';
import {
  FindCollector,
  findPattern,
  type CellText,
  type FindQuery,
  type FindResult,
  type PathNode,
} from './find.js';
import {
  emptyFlat,
  EXPANDED,
  GROUP,
  HAS_CHILDREN,
  pack,
  spliceRows,
  stepDepth,
  type Flat,
  type FlatRows,
  type RowView,
} from './rows.js';
import { CHECK_EVERY, immediateScheduler, sliceTimer, type Scheduler } from './schedule.js';
import { sortRows, type Sort } from './sort.js';
import {
  Group,
  type ExpandPolicy,
  type GroupBy,
  type RowFilter,
  type RowKey,
  type RowTarget,
  type TreeSource,
} from './types.js';
/** Export lines joined per slice: one join of the whole text is a long task at 500k rows. */
const EXPORT_CHUNK = 4096;
const SPLICE_LIMIT = 4096;

export interface Snapshot<R> {
  readonly version: number;
  readonly rows: RowView<R>;
  readonly totals: Totals;
  readonly busy: boolean;
  readonly toggled?: RowTarget<R>;
  /** The last build threw; `rows` and `totals` are from before it. Only a good build clears it. */
  readonly failed?: { readonly error: unknown };
}

export interface GridStoreOptions<R> {
  scheduler?: Scheduler;
  expanded?: ExpandPolicy<R>;
  calcs?: Calcs<R>;
  groupBy?: GroupBy<R> | null;
}

type Entry<R> = R | Group<R>;

/** Most rows first, then by key: the order before any sort, and the tie-break under one. */
const byCount = <R>(a: Group<R>, b: Group<R>): number =>
  b.rows.length - a.rows.length || a.key.localeCompare(b.key);

type Held<R> = Map<Calc<R>, number>;

interface Walk<R> {
  lists: (readonly R[])[];
  at: number[];
  depth: number;
  ups: (PathNode | null)[] | null;
  flat: boolean;
}

/** Called for each row a walk passes, with its shown children; true walks into them. */
type Visit<R> = (row: R, depth: number, kids: readonly R[] | null, up: PathNode | null) => boolean;

/** A walk of `shown`, a sibling list already filtered and sorted, at `depth`. */
const walkOf = <R>(
  shown: readonly R[],
  depth: number,
  options: { paths?: boolean; flat?: boolean } = {},
): Walk<R> => ({
  lists: [shown],
  at: [0],
  depth,
  ups: options.paths ? [null] : null,
  flat: options.flat ?? false,
});

interface Built<R extends object> {
  rows: FlatRows<R>;
  totals: Totals;
  toggled?: RowTarget<R>;
}

/**
 * Runs `work` to its end, checking the clock every {@link CHECK_EVERY} yields. Null once
 * `tick` reports the step stale, so the caches the work writes stay true.
 */
async function drive<T>(
  work: Generator<void, T, void>,
  tick: () => Promise<boolean>,
): Promise<{ value: T } | null> {
  let count = 0;
  for (;;) {
    const step = work.next();
    if (step.done) {
      return { value: step.value };
    }
    if (++count % CHECK_EVERY === 0 && !(await tick())) {
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
  private readonly key = (row: R): RowKey => this.source.key(row);
  private readonly scheduler: Scheduler;
  private readonly expandBase: ExpandPolicy<R>;
  /** A row or group above this depth is open; null follows `expandBase`, with groups closed. */
  private level: number | null = null;
  /** Rows opened or closed by hand, which wins over the level. */
  private readonly hand = new Map<RowKey, boolean>();
  private sort: Sort<R> | null = null;
  private filters: readonly RowFilter<R>[] = [];
  private ordered = new WeakMap<readonly R[], readonly R[]>();
  private deepPass = new WeakMap<RowFilter<R>, WeakSet<R>>();
  private calcs: Calcs<R>;
  private groupBy: GroupBy<R> | null;
  private groupSort: Sort<Group<R>> | null = null;
  private readonly handGroups = new Map<string, boolean>();
  /** Footer totals per filter set and calc; only a new source drops them. */
  private footers = new Map<string, Held<R>>();
  private filterIds = new WeakMap<RowFilter<R>, number>();
  private nextFilterId = 0;
  private groupTotals = new Map<string, Held<R>>();
  private totalsOnly = false;

  private current: Snapshot<R>;
  private listeners = new Set<(snapshot: Snapshot<R>) => void>();
  private running = false;
  private dirty = false;
  private waiting: { resolve: () => void; reject: (error: unknown) => void }[] = [];
  private findId = 0;
  private generation = 0;
  private toggledTarget: RowTarget<R> | undefined;

  constructor(source: TreeSource<R>, options: GridStoreOptions<R> = {}) {
    this.source = source;
    this.scheduler = options.scheduler ?? immediateScheduler;
    this.expandBase = options.expanded ?? false;
    this.calcs = options.calcs ?? {};
    this.groupBy = options.groupBy ?? null;
    this.current = {
      version: 0,
      rows: pack(emptyFlat(), this.key),
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
    this.level = null;
    this.hand.clear();
    this.handGroups.clear();
    this.deepPass = new WeakMap();
    this.dropTotals();
    return this.reorder();
  }

  /**
   * Sorts each sibling list by `sort`, and the groups by `groups`. Groups keep their
   * default order, most rows first, where `groups` is absent or ties.
   */
  setSort(sort: Sort<R> | null, groups?: Sort<Group<R>> | null): Promise<void> {
    this.sort = sort;
    this.groupSort = groups ?? null;
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
    this.generation++;
    this.level = null;
    this.handGroups.clear();
    this.groupTotals.clear();
    return this.rebuild();
  }

  /** Opens every row and every group. */
  expandAll(): Promise<void> {
    this.setAll(true);
    return this.rebuild();
  }

  /** Closes every row and every group. */
  collapseAll(): Promise<void> {
    this.setAll(false);
    return this.rebuild();
  }

  /** Opens every closed row at the shallowest depth that has one. A group is depth 0. */
  expandLevel(): Promise<void> {
    return this.step(true);
  }

  /** Closes every open row at the deepest depth that has one. A group is depth 0. */
  collapseLevel(): Promise<void> {
    return this.step(false);
  }

  /**
   * Expands or collapses a shown row; `expanded` omitted flips it. The subtree is spliced
   * in or out at once, without a rebuild. A row that is not shown is left alone: use
   * {@link reveal} to reach it. Takes a data row's key, or a group. True when it opened the row.
   */
  async toggle(target: RowTarget<R>, expanded?: boolean): Promise<boolean> {
    // A loop, inline: waiters resume together, so the first one's change starts a build the
    // rest must wait out, with no await between this check and the reads below.
    while (this.running) {
      await this.settled();
    }
    const rows = this.current.rows;
    const index = rows.indexOf(target);
    if (index === -1 || !rows.hasChildrenAt(index)) {
      return false;
    }
    const was = rows.isExpandedAt(index);
    if (expanded === was) {
      return false;
    }
    this.setHand(target, !was);
    if (!this.splice(index, !was, target)) {
      this.toggledTarget = target;
      await this.rebuild();
    }
    return !was;
  }

  /**
   * Expands each ancestor on `path` (root first, the target last) and returns the
   * target's index. Where a filter hides part of the path, it returns the deepest shown
   * row on it instead, or -1 when none is shown. Opens the group the path starts in.
   */
  async reveal(path: readonly RowKey[]): Promise<number> {
    // Sibling lists are cached as they are read, so read them only once filters are ready.
    while (this.running) {
      await this.settled();
    }
    const indent = this.groupBy ? 1 : 0;
    let list: readonly R[] = this.source.roots;
    let found: R | null = null;
    let opened = false;
    for (const [depth, key] of path.entries()) {
      const row = this.childrenOf(list).find((r) => this.key(r) === key);
      if (!row) {
        break;
      }
      found = row;
      if (depth === 0 && this.groupBy) {
        const group = this.groupBy(row);
        opened = !this.groupOpen(group);
        if (opened) {
          this.handGroups.set(group, true);
        }
      }
      if (depth < path.length - 1) {
        if (!this.isExpanded(row, depth + indent)) {
          this.hand.set(key, true);
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
    return this.current.rows.indexOf(this.key(found));
  }

  /**
   * Counts `query` in each searched cell of every row that passes the filters, open or
   * not, in display order, and in each group row's key. Null when a newer find, or a
   * change to the rows, lands while it runs.
   */
  async find(query: FindQuery, cells: readonly CellText<R>[]): Promise<FindResult<R> | null> {
    const id = ++this.findId;
    await this.settled();
    const generation = this.generation;
    const stale = (): boolean => id !== this.findId || generation !== this.generation;
    if (stale()) {
      return null;
    }
    const found = new FindCollector(cells, findPattern(query));
    if (!found.searches) {
      return found.result(this.key);
    }
    const done = await this.eachRow(true, sliceTimer(this.scheduler, stale), (entry, _depth, up) =>
      found.visit(entry, up),
    );
    return done && !stale() ? found.result(this.key) : null;
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
    const generation = this.generation;
    const stale = (): boolean => generation !== this.generation;
    const { format } = options;
    const tree = options.tree ?? true;
    // Every group or top-level row is on screen, open or not, so its flag tells if any row is deeper.
    const levels =
      tree && (this.current.rows as FlatRows<R>).flags.some((flag) => (flag & HAS_CHILDREN) !== 0);
    const chunks: string[] = [];
    let lines = [headerLine(columns, format, levels)];
    const done = await this.eachRow(tree, sliceTimer(this.scheduler, stale), (entry, depth) => {
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
    });
    if (lines.length) {
      chunks.push(lines.join('\n'));
    }
    return done && !stale() ? chunks.join('\n') : null;
  }

  private reorder(): Promise<void> {
    this.ordered = new WeakMap();
    this.generation++;
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

  private setAll(expanded: boolean): void {
    this.level = expanded ? Infinity : 0;
    this.hand.clear();
    this.handGroups.clear();
  }

  /**
   * Moves the level one step, and drops the hand state of the rows it steps. A row on
   * screen the new level would change keeps its state by hand, so only the stepped rows move.
   */
  private async step(expand: boolean): Promise<void> {
    while (this.running) {
      await this.settled();
    }
    const rows = this.current.rows;
    const depth = stepDepth(rows, expand);
    if (depth === -1) {
      return;
    }
    const now = this.level;
    const level = expand ? Math.max(now ?? 0, depth + 1) : Math.min(now ?? Infinity, depth);
    for (let i = 0; i < rows.size; i++) {
      if (!rows.hasChildrenAt(i)) {
        continue;
      }
      const at = rows.depthAt(i);
      const open = rows.isExpandedAt(i);
      if (at === depth && open !== expand) {
        this.setHand(rows.targetAt(i), undefined);
      } else if (open !== at < level) {
        const [hand, key] = this.handFor(rows.targetAt(i));
        if (!hand.has(key)) {
          hand.set(key, open);
        }
      }
    }
    this.level = level;
    await this.rebuild();
  }

  private handFor(target: RowTarget<R>): [Map<RowKey, boolean>, RowKey] {
    return target instanceof Group ? [this.handGroups, target.key] : [this.hand, target];
  }

  /** Opens or closes a row or group by hand; undefined hands it back to the level. */
  private setHand(target: RowTarget<R>, open: boolean | undefined): void {
    const [hand, key] = this.handFor(target);
    if (open === undefined) {
      hand.delete(key);
    } else {
      hand.set(key, open);
    }
  }

  private groupOpen(key: string): boolean {
    return this.handGroups.get(key) ?? (this.level ?? 0) > 0;
  }

  private isExpanded(row: R, depth: number): boolean {
    const open = this.hand.get(this.key(row));
    if (open !== undefined) {
      return open;
    }
    if (this.level !== null) {
      return depth < this.level;
    }
    return typeof this.expandBase === 'function' ? this.expandBase(row, depth) : this.expandBase;
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
      if (this.sort) {
        out = sortRows(out, this.sort);
      }
      this.ordered.set(list, out);
    }
    return out;
  }

  /**
   * Visits up to `budget` rows of a depth-first walk; true once the walk is done. A plain
   * loop, not a generator: a resume per row cost a third of expand all.
   */
  private walk(walk: Walk<R>, budget: number, visit: Visit<R>): boolean {
    const { lists, at, ups, depth, flat } = walk;
    while (lists.length && budget > 0) {
      const top = lists.length - 1;
      const siblings = lists[top] as readonly R[];
      const i = at[top] as number;
      if (i === siblings.length) {
        lists.pop();
        at.pop();
        ups?.pop();
        continue;
      }
      at[top] = i + 1;
      const row = siblings[i] as R;
      const up = ups?.[top] ?? null;
      const children = flat ? null : this.source.children?.(row);
      const kids = children?.length ? this.childrenOf(children) : null;
      if (visit(row, depth + top, kids?.length ? kids : null, up) && kids?.length) {
        lists.push(kids);
        at.push(0);
        ups?.push({ key: this.key(row), up });
      }
      budget--;
    }
    return lists.length === 0;
  }

  /** {@link walk} to its end, checking the clock between batches. False once stale. */
  private async walkAll(
    walk: Walk<R>,
    tick: () => Promise<boolean>,
    visit: Visit<R>,
  ): Promise<boolean> {
    while (!this.walk(walk, CHECK_EVERY, visit)) {
      if (!(await tick())) {
        return false;
      }
    }
    return true;
  }

  /** A visit that writes each row into `out`, and walks into the open ones. */
  private intoRows(out: Flat<R>): Visit<R> {
    return (row, depth, kids) => {
      const expanded = kids ? this.isExpanded(row, depth) : false;
      out.rows.push(row);
      out.depths.push(depth);
      out.flags.push(kids ? HAS_CHILDREN | (expanded ? EXPANDED : 0) : 0);
      return expanded;
    };
  }

  /**
   * Replaces the rows under `index` with its subtree, or with nothing, in one copy. False,
   * with nothing changed, when the subtree is too large to walk in one task.
   */
  private splice(index: number, expand: boolean, target: RowTarget<R>): boolean {
    const old = this.current.rows as FlatRows<R>;
    const entry = old.rowAt(index);
    let inserted: Flat<R> | null = null;
    if (expand) {
      inserted = emptyFlat();
      const shown =
        entry instanceof Group ? entry.rows : this.childrenOf(this.source.children?.(entry) ?? []);
      if (
        !this.walk(walkOf(shown, old.depthAt(index) + 1), SPLICE_LIMIT, this.intoRows(inserted))
      ) {
        return false;
      }
    }
    this.publish(
      {
        rows: spliceRows(old, index, inserted, this.key),
        totals: this.current.totals,
        toggled: target,
      },
      false,
      this.current.failed,
    );
    return true;
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
          this.publish({ ...built, toggled: this.toggledTarget }, this.dirty);
          this.toggledTarget = undefined;
        }
        failed = null;
      } catch (error) {
        failed = { error };
      }
    }
    this.running = false;
    this.publish(null, false, failed ?? undefined);
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
    const top = this.childrenOf(this.source.roots);
    const key = this.filterKey();
    let held = this.footers.get(key);
    if (!held) {
      held = new Map();
      this.footers.set(key, held);
    }
    const footer = await drive(this.totalsFor(top, held), tick);
    if (!footer || this.dirty) {
      return null;
    }
    const totals = footer.value;
    if (totalsOnly) {
      return { rows: this.current.rows as FlatRows<R>, totals };
    }
    const out = emptyFlat<R>();
    const intoRows = this.intoRows(out);
    if (!this.groupBy) {
      return (await this.walkAll(walkOf(top, 0), tick, intoRows)) && !this.dirty
        ? { rows: pack(out, this.key), totals }
        : null;
    }
    const groups = await drive(this.groupsOf(top, this.groupBy), tick);
    if (!groups || this.dirty) {
      return null;
    }
    for (const group of groups.value) {
      const open = this.groupOpen(group.key);
      out.rows.push(group);
      out.depths.push(0);
      out.flags.push(GROUP | HAS_CHILDREN | (open ? EXPANDED : 0));
      if (open && !(await this.walkAll(walkOf(group.rows, 1), tick, intoRows))) {
        return null;
      }
    }
    return this.dirty ? null : { rows: pack(out, this.key), totals };
  }

  /**
   * Visits every row that passes the filters, open or not, in display order: each group,
   * then its rows. With `tree` false, only the top-level rows. `depth` is 0 for a group or
   * a top-level row; the rows of a group start at 1. False once stale.
   */
  private async eachRow(
    tree: boolean,
    tick: () => Promise<boolean>,
    visit: (entry: Entry<R>, depth: number, up: PathNode | null) => void,
  ): Promise<boolean> {
    const top = this.childrenOf(this.source.roots);
    const each: Visit<R> = (row, depth, _kids, up) => {
      visit(row, depth, up);
      return true;
    };
    const walk = (list: readonly R[], depth: number): Promise<boolean> =>
      this.walkAll(walkOf(list, depth, { paths: true, flat: !tree }), tick, each);
    if (!this.groupBy) {
      return walk(top, 0);
    }
    const groups = await drive(this.groupsOf(top, this.groupBy), tick);
    if (!groups) {
      return false;
    }
    for (const group of groups.value) {
      visit(group, 0, null);
      if (!(await walk(group.rows, 1))) {
        return false;
      }
    }
    return true;
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
    return this.groupSort ? sortRows(groups, this.groupSort) : groups;
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

  private publish(built: Built<R> | null, busy: boolean, failed?: { error: unknown }): void {
    this.current = {
      version: this.current.version + 1,
      rows: built?.rows ?? this.current.rows,
      totals: built?.totals ?? this.current.totals,
      busy,
      toggled: built ? built.toggled : this.current.toggled,
      failed: failed ?? (built ? undefined : this.current.failed),
    };
    for (const listener of this.listeners) {
      listener(this.current);
    }
  }
}
