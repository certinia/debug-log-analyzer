/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { RowKey } from './types.js';

export interface FindQuery {
  text: string;
  matchCase?: boolean;
}

/** The text a cell shows, which is what find searches. One per searched column. */
export type CellText<R> = (row: R) => string;

/** A row's parent chain as a walk passes it: shared by siblings, kept only for matches. */
export interface PathNode {
  readonly key: RowKey;
  readonly up: PathNode | null;
}

/**
 * The pattern find counts with, matching `text` literally. Render highlights with the
 * same pattern, so its marks and the count agree. Null for empty text.
 */
export function findPattern(query: FindQuery): RegExp | null {
  if (!query.text) {
    return null;
  }
  const literal = query.text.replaceAll(/[.*+?^${}()|[\]\\-]/g, '\\$&');
  return new RegExp(literal, query.matchCase ? 'g' : 'gi');
}

/** The matches of one search, numbered from 0 in display order: row by row, then column. */
export class FindResult<R> {
  readonly total: number;
  /** Rows with a match, in display order. */
  private readonly rows: readonly R[];
  /** The number of each row's first match. */
  private readonly starts: Uint32Array;
  private readonly paths: readonly (PathNode | null)[];
  private readonly key: (row: R) => RowKey;
  /** Each row's slot in `rows`. */
  private readonly at: ReadonlyMap<R, number>;

  constructor(
    rows: readonly R[],
    starts: Uint32Array,
    paths: readonly (PathNode | null)[],
    at: ReadonlyMap<R, number>,
    total: number,
    key: (row: R) => RowKey,
  ) {
    this.rows = rows;
    this.starts = starts;
    this.paths = paths;
    this.at = at;
    this.total = total;
    this.key = key;
  }

  /** The row that holds match `match`, or undefined past the end. */
  rowOf(match: number): R | undefined {
    const i = this.slotOf(match);
    return i === -1 ? undefined : this.rows[i];
  }

  /** The number of the first match in `row`, or -1 when it has none. */
  firstMatchIn(row: R): number {
    const i = this.at.get(row);
    return i === undefined ? -1 : (this.starts[i] as number);
  }

  /** Keys from the root down to the row that holds `match`, for `GridStore.reveal`. */
  pathOf(match: number): RowKey[] {
    const i = this.slotOf(match);
    if (i === -1) {
      return [];
    }
    const path = [this.key(this.rows[i] as R)];
    for (let node = this.paths[i] ?? null; node; node = node.up) {
      path.push(node.key);
    }
    return path.reverse();
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
  private readonly pattern: RegExp;
  private readonly rows: R[] = [];
  private readonly starts: number[] = [];
  private readonly paths: (PathNode | null)[] = [];
  // Filled as rows are visited, which is sliced: built at the end it held the thread 45ms.
  private readonly at = new Map<R, number>();
  private total = 0;

  constructor(cells: readonly CellText<R>[], pattern: RegExp) {
    this.cells = cells;
    this.pattern = pattern;
  }

  visit(row: R, up: PathNode | null): void {
    let count = 0;
    for (const cell of this.cells) {
      const text = cell(row);
      if (!text) {
        continue;
      }
      this.pattern.lastIndex = 0;
      while (this.pattern.exec(text)) {
        count++;
      }
    }
    if (count) {
      this.at.set(row, this.rows.length);
      this.rows.push(row);
      this.starts.push(this.total);
      this.paths.push(up);
      this.total += count;
    }
  }

  result(key: (row: R) => RowKey): FindResult<R> {
    return new FindResult(
      this.rows,
      Uint32Array.from(this.starts),
      this.paths,
      this.at,
      this.total,
      key,
    );
  }
}
