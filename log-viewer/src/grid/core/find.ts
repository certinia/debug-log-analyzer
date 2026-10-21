/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { RowView } from './rows.js';
import { Group, type RowKey } from './types.js';

export interface FindQuery {
  text: string;
  matchCase?: boolean;
}

export type CellText<R> = (row: R) => string;

export interface PathNode {
  readonly key: RowKey;
  readonly up: PathNode | null;
}

/**
 * The pattern find counts with, matching `text` literally, except that a run of whitespace
 * matches any run, so a search goes across a line break. Render highlights with the same
 * pattern, so its marks and the count agree. Null for empty text.
 */
export function findPattern(query: FindQuery): RegExp | null {
  if (!query.text) {
    return null;
  }
  const literal = query.text
    .split(/\s+/)
    .map((part) => part.replaceAll(/[.*+?^${}()|[\]\\-]/g, '\\$&'))
    .join('\\s+');
  return new RegExp(literal, query.matchCase ? 'g' : 'gi');
}

/** A row find can match: a data row, or a group row by its key. */
export type Findable<R> = R | Group<R>;

/** The matches of one search, numbered from 0 in display order: row by row, then column. */
export class FindResult<R> {
  readonly total: number;
  readonly pattern: RegExp | null;
  private readonly rows: readonly Findable<R>[];
  private readonly starts: Uint32Array;
  private readonly paths: readonly (PathNode | null)[];
  // The group each row sits in, as a path leaves it out.
  private readonly groups: readonly (string | null)[];
  private readonly key: (row: R) => RowKey;
  // Groups by key: each build makes its groups again.
  private readonly at: ReadonlyMap<R | string, number>;

  constructor(
    rows: readonly Findable<R>[],
    starts: Uint32Array,
    paths: readonly (PathNode | null)[],
    groups: readonly (string | null)[],
    at: ReadonlyMap<R | string, number>,
    total: number,
    pattern: RegExp | null,
    key: (row: R) => RowKey,
  ) {
    this.rows = rows;
    this.starts = starts;
    this.paths = paths;
    this.groups = groups;
    this.at = at;
    this.total = total;
    this.pattern = pattern;
    this.key = key;
  }

  /** The row that holds match `match`, or undefined past the end. */
  rowOf(match: number): Findable<R> | undefined {
    const i = this.slotOf(match);
    return i === -1 ? undefined : this.rows[i];
  }

  /** The number of the first match in `row`, or -1 when it has none. */
  firstMatchIn(row: Findable<R>): number {
    const i = this.at.get(row instanceof Group ? row.key : row);
    return i === undefined ? -1 : (this.starts[i] as number);
  }

  /** Keys from the root down to the row that holds `match`, for `GridStore.reveal`; empty for a group. */
  pathOf(match: number): RowKey[] {
    const i = this.slotOf(match);
    const row = this.rows[i];
    if (i === -1 || row === undefined || row instanceof Group) {
      return [];
    }
    const path = [this.key(row)];
    for (let node = this.paths[i] ?? null; node; node = node.up) {
      path.push(node.key);
    }
    return path.reverse();
  }

  /**
   * The first match at or after shown row `index` of `rows`, where a match in a collapsed
   * row counts at the shown row above it; `total` when none is.
   */
  firstMatchFrom(rows: RowView<R>, index: number): number {
    const rowKeys = new Set<RowKey>();
    const groupKeys = new Set<string>();
    let bound = this.total;
    for (let i = index; i < rows.size; i++) {
      const row = rows.rowAt(i);
      const own = this.firstMatchIn(row);
      if (own >= 0) {
        bound = own;
        break;
      }
      if (row instanceof Group) {
        groupKeys.add(row.key);
      } else {
        rowKeys.add(rows.keyAt(i));
      }
    }
    // Before `bound`, the matches from `index` on are the last ones: those hidden under a row passed over.
    let lo = 0;
    let hi = bound;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.isUnder(mid, rowKeys, groupKeys)) {
        hi = mid;
      } else {
        lo = mid + 1;
      }
    }
    return lo;
  }

  private isUnder(
    match: number,
    rowKeys: ReadonlySet<RowKey>,
    groupKeys: ReadonlySet<string>,
  ): boolean {
    const i = this.slotOf(match);
    const group = this.groups[i];
    if (typeof group === 'string' && groupKeys.has(group)) {
      return true;
    }
    for (let node = this.paths[i] ?? null; node; node = node.up) {
      if (rowKeys.has(node.key)) {
        return true;
      }
    }
    return false;
  }

  /** Binary search: the last row whose first match is at or before `match`. */
  private slotOf(match: number): number {
    if (match < 0 || match >= this.total) {
      return -1;
    }
    let lo = 0;
    let hi = this.rows.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((this.starts[mid] as number) <= match) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    return lo;
  }
}

/** Collects matches as rows are visited, then packs them into a {@link FindResult}. */
export class FindCollector<R> {
  private readonly cells: readonly CellText<R>[];
  private readonly pattern: RegExp | null;
  private readonly rows: Findable<R>[] = [];
  private readonly starts: number[] = [];
  private readonly paths: (PathNode | null)[] = [];
  private readonly groups: (string | null)[] = [];
  private group: string | null = null;
  // Filled as rows are visited, which is sliced: built at the end it held the thread 45ms.
  private readonly at = new Map<R | string, number>();
  private total = 0;

  constructor(cells: readonly CellText<R>[], pattern: RegExp | null) {
    this.cells = cells;
    this.pattern = pattern;
  }

  get searches(): boolean {
    return this.pattern !== null;
  }

  visit(row: Findable<R>, up: PathNode | null): void {
    if (!this.pattern) {
      return;
    }
    let count = 0;
    // A group row shows its key, not the columns' text.
    if (row instanceof Group) {
      this.group = row.key;
      count = countIn(this.pattern, row.key);
    } else {
      for (const cell of this.cells) {
        count += countIn(this.pattern, cell(row));
      }
    }
    if (count) {
      this.at.set(row instanceof Group ? row.key : row, this.rows.length);
      this.rows.push(row);
      this.starts.push(this.total);
      this.paths.push(up);
      this.groups.push(row instanceof Group ? null : this.group);
      this.total += count;
    }
  }

  result(key: (row: R) => RowKey): FindResult<R> {
    return new FindResult(
      this.rows,
      Uint32Array.from(this.starts),
      this.paths,
      this.groups,
      this.at,
      this.total,
      this.pattern,
      key,
    );
  }
}

function countIn(pattern: RegExp, text: string): number {
  let count = 0;
  pattern.lastIndex = 0;
  while (text && pattern.exec(text)) {
    count++;
  }
  return count;
}
