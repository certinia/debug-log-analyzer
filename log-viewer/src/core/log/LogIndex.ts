/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ApexEvent, ApexLog } from '@apexdevtools/apex-log-parser';

import { FRAME_CATEGORY, LOG_CATEGORY, type LogCategory } from './category.js';

/** What {@link LogIndex.rowOf} answers for an event that is not in the tree. */
export const NO_ROW = -1;

/** The {@link LogIndex.categoryId} of an event with no category: every leaf. */
export const UNCATEGORISED = 0;

/** Every category, by {@link LogIndex.categoryId}. */
const CATEGORY_NAMES: readonly LogCategory[] = ['', ...Object.values(LOG_CATEGORY)];

/** Each type's category id when it opens a frame, by type id. */
const FRAME_CATEGORY_ID = Uint8Array.from(FRAME_CATEGORY, (category) =>
  CATEGORY_NAMES.indexOf(category),
);

/** A column of `log.columns`, indexed by event id. */
export type IdColumn = Float64Array | Int32Array | Uint16Array | Uint8Array;

interface Rows {
  /** The row's event id. */
  eventIndex: Int32Array;
  /** `startTimestamp`, in nanoseconds. */
  start: Float64Array;
  /** `endTimestamp`, in nanoseconds. */
  end: Float64Array;
  /** `duration.total`, in nanoseconds. */
  total: Float64Array;
  /** `duration.self`, in nanoseconds, with the self time of hidden events under it. */
  self: Float64Array;
  /** 0 for a top-level row. */
  depth: Uint16Array;
  /** {@link NO_ROW} for a top-level row. */
  parent: Int32Array;
  /** The first row after this row's subtree. */
  subtreeEnd: Int32Array;
  /** An index into {@link LogIndex.categoryNames}. */
  categoryId: Uint8Array;
}

/**
 * The events on screen as flat columns, one row per event, so a view reads typed
 * arrays rather than event objects.
 *
 * Rows are in pre-order, which is log order, so `eventIndex` ascends. With no
 * level hidden, row `r` is event id `r + 1`. A hidden event has no row: its
 * descendants move up to its nearest shown ancestor, and its self time folds
 * into that ancestor's.
 *
 * A row's children run from `row + 1` to `subtreeEnd[row]`, each one skipping the
 * last one's subtree: `for (let c = row + 1; c < end; c = subtreeEnd[c])`.
 *
 * One index per shown log, held by `LogStore`.
 */
export interface LogIndex extends Readonly<Rows> {
  readonly log: ApexLog;
  readonly rowCount: number;
  readonly categoryNames: readonly LogCategory[];
  /** The event for a row: a new object each call, so read columns in a loop. */
  event(row: number): ApexEvent;
  /** The row for an event id, or {@link NO_ROW} for a hidden or unknown one. */
  rowOf(eventIndex: number): number;
  /**
   * `byId`, a column of `log.columns`, indexed by row. Shares its memory when no
   * level is hidden; else a copy, made once per column.
   */
  column<T extends IdColumn>(byId: T): T;
  /**
   * `byId`, an own part of `log.columns` such as `durationSelf` or a count's
   * `self`, indexed by row, with the own part of each hidden event added to its
   * nearest shown ancestor's. Shares its memory when no level is hidden.
   */
  selfColumn<T extends Int32Array | Float64Array>(byId: T): T;
}

/** `row`'s category: '' for a leaf. */
export function categoryName(index: LogIndex, row: number): LogCategory {
  return index.categoryNames[index.categoryId[row]!]!;
}

/**
 * The rows directly under `row`, or at the top of the log for {@link NO_ROW}, in
 * log order. Fills `into` when given, so a pass over every row reuses one array.
 */
export function childRows(index: LogIndex, row: number, into: number[] = []): number[] {
  into.length = 0;
  const { subtreeEnd } = index;
  const end = row === NO_ROW ? index.rowCount : subtreeEnd[row]!;
  for (let child = row + 1; child < end; child = subtreeEnd[child]!) {
    into.push(child);
  }
  return into;
}

class Index implements LogIndex {
  readonly log: ApexLog;
  readonly rowCount: number;
  readonly categoryNames = CATEGORY_NAMES;
  readonly eventIndex: Int32Array;
  readonly start: Float64Array;
  readonly end: Float64Array;
  readonly total: Float64Array;
  readonly self: Float64Array;
  readonly depth: Uint16Array;
  readonly parent: Int32Array;
  readonly subtreeEnd: Int32Array;
  readonly categoryId: Uint8Array;
  /** Each id's row, or the row of its nearest shown ancestor when hidden. Null with nothing hidden. */
  private readonly keeper: Int32Array | null;
  private readonly hidden: Uint8Array | null;
  private readonly columns = new WeakMap<IdColumn, IdColumn>();
  private readonly selves = new WeakMap<IdColumn, IdColumn>();

  constructor(
    log: ApexLog,
    rows: Rows,
    rowCount: number,
    keeper: Int32Array | null,
    hidden: Uint8Array | null,
  ) {
    this.log = log;
    this.rowCount = rowCount;
    this.keeper = keeper;
    this.hidden = hidden;
    ({
      eventIndex: this.eventIndex,
      start: this.start,
      end: this.end,
      total: this.total,
      self: this.self,
      depth: this.depth,
      parent: this.parent,
      subtreeEnd: this.subtreeEnd,
      categoryId: this.categoryId,
    } = rows);
  }

  event(row: number): ApexEvent {
    // In range by contract: every eventIndex entry is an id the log holds.
    return this.log.event(this.eventIndex[row]!)!;
  }

  rowOf(eventIndex: number): number {
    if (!(eventIndex >= 1 && eventIndex <= this.log.eventCount)) {
      return NO_ROW;
    }
    if (!this.keeper) {
      return eventIndex - 1;
    }
    return this.hidden![eventIndex] ? NO_ROW : this.keeper[eventIndex]!; // set with keeper
  }

  column<T extends IdColumn>(byId: T): T {
    if (!this.keeper) {
      return byId.subarray(1) as T;
    }
    let rows = this.columns.get(byId) as T | undefined;
    if (!rows) {
      rows = new (byId.constructor as new (length: number) => T)(this.rowCount);
      const ids = this.eventIndex;
      for (let row = 0; row < this.rowCount; row++) {
        rows[row] = byId[ids[row]!]!;
      }
      this.columns.set(byId, rows);
    }
    return rows;
  }

  selfColumn<T extends Int32Array | Float64Array>(byId: T): T {
    const keeper = this.keeper;
    if (!keeper) {
      return byId.subarray(1) as T;
    }
    let rows = this.selves.get(byId) as T | undefined;
    if (!rows) {
      rows = new (byId.constructor as new (length: number) => T)(this.rowCount);
      // Each id's own part goes to its keeper's row: its own row when shown.
      for (let id = 1; id < keeper.length; id++) {
        const row = keeper[id]!;
        if (row !== NO_ROW) {
          rows[row]! += byId[id]!;
        }
      }
      this.selves.set(byId, rows);
    }
    return rows;
  }
}

/**
 * Builds a {@link LogIndex} a slice at a time, so a caller can hand the thread
 * back between slices, or run it to the end in one go. One pass over the ids, in
 * log order: no tree walk and no event object.
 *
 * @param hidden - by event id, 1 for an event the levels on screen hide; null for none
 */
export class LogIndexBuilder {
  private readonly log: ApexLog;
  private readonly hidden: Uint8Array | null;
  private readonly rows: Rows;
  private readonly keeper: Int32Array | null;
  private nextId = 1;
  private rowCount = 0;
  // The shown rows whose subtree is still open, outermost first. Its length is the next row's depth.
  private readonly open: number[] = [];

  constructor(log: ApexLog, hidden: Uint8Array | null = null) {
    this.log = log;
    this.hidden = hidden;
    const count = log.eventCount;
    const columns = log.columns;
    if (hidden) {
      this.keeper = new Int32Array(count + 1).fill(NO_ROW);
      this.rows = {
        ...allocateTree(count),
        start: new Float64Array(count),
        end: new Float64Array(count),
        total: new Float64Array(count),
        self: new Float64Array(count),
      };
    } else {
      // Nothing moves, so the time columns are the parse's own.
      this.keeper = null;
      this.rows = {
        ...allocateTree(count),
        start: columns.startTimestamp.subarray(1),
        end: columns.endTimestamp.subarray(1),
        total: columns.durationTotal.subarray(1),
        self: columns.durationSelf.subarray(1),
      };
    }
  }

  /** Adds up to `maxIds` events. Returns true once every event is read. */
  step(maxIds: number): boolean {
    const { hidden, keeper, open, rows: r } = this;
    const c = this.log.columns;
    const { type, isFrame, subtreeEnd } = c;
    const last = Math.min(this.log.eventCount, this.nextId + maxIds - 1);
    for (let id = this.nextId; id <= last; id++) {
      // Close every open row whose subtree ended before this id.
      while (open.length && subtreeEnd[r.eventIndex[open.at(-1)!]!]! <= id) {
        r.subtreeEnd[open.pop()!] = this.rowCount;
      }
      const above = open.length ? open.at(-1)! : NO_ROW;
      if (hidden?.[id]) {
        keeper![id] = above;
        if (above !== NO_ROW) {
          r.self[above]! += c.durationSelf[id]!;
        }
        continue;
      }
      const row = this.rowCount++;
      r.eventIndex[row] = id;
      r.depth[row] = open.length;
      r.parent[row] = above;
      r.categoryId[row] = isFrame[id] ? FRAME_CATEGORY_ID[type[id]!]! : UNCATEGORISED;
      if (keeper) {
        keeper[id] = row;
        r.start[row] = c.startTimestamp[id]!;
        r.end[row] = c.endTimestamp[id]!;
        r.total[row] = c.durationTotal[id]!;
        r.self[row]! += c.durationSelf[id]!;
      }
      if (subtreeEnd[id]! > id + 1) {
        open.push(row);
      } else {
        r.subtreeEnd[row] = row + 1;
      }
    }
    this.nextId = last + 1;
    if (this.nextId > this.log.eventCount) {
      while (open.length) {
        r.subtreeEnd[open.pop()!] = this.rowCount;
      }
      return true;
    }
    return false;
  }

  /** The index, once {@link step} has returned true. */
  finish(): LogIndex {
    const n = this.rowCount;
    const r = this.rows;
    const rows: Rows = this.keeper
      ? {
          eventIndex: r.eventIndex.slice(0, n),
          start: r.start.slice(0, n),
          end: r.end.slice(0, n),
          total: r.total.slice(0, n),
          self: r.self.slice(0, n),
          depth: r.depth.slice(0, n),
          parent: r.parent.slice(0, n),
          subtreeEnd: r.subtreeEnd.slice(0, n),
          categoryId: r.categoryId.slice(0, n),
        }
      : r;
    return new Index(this.log, rows, n, this.keeper, this.hidden);
  }
}

function allocateTree(
  capacity: number,
): Pick<Rows, 'eventIndex' | 'depth' | 'parent' | 'subtreeEnd' | 'categoryId'> {
  return {
    eventIndex: new Int32Array(capacity),
    depth: new Uint16Array(capacity),
    parent: new Int32Array(capacity),
    subtreeEnd: new Int32Array(capacity),
    categoryId: new Uint8Array(capacity),
  };
}

/** The whole index in one go. */
export function buildLogIndex(log: ApexLog, hidden: Uint8Array | null = null): LogIndex {
  const builder = new LogIndexBuilder(log, hidden);
  builder.step(Infinity);
  return builder.finish();
}

/**
 * Self time summed per id over the subtrees of `rows`, or over every row when `rows`
 * is null. `ids[row]` is the row's id, below `idCount`. A row inside an earlier
 * row's subtree is skipped, so a shared subtree is counted once.
 */
export function sumSelfBy(
  index: LogIndex,
  ids: ArrayLike<number>,
  idCount: number,
  rows: readonly number[] | null,
): Float64Array {
  const sums = new Float64Array(idCount);
  const { self, subtreeEnd } = index;
  const add = (from: number, to: number) => {
    for (let row = from; row < to; row++) {
      sums[ids[row]!]! += self[row]!;
    }
  };
  if (!rows) {
    add(0, index.rowCount);
    return sums;
  }
  let end = 0;
  for (const row of rows.toSorted((a, b) => a - b)) {
    if (row >= end) {
      end = subtreeEnd[row]!;
      add(row, end);
    }
  }
  return sums;
}
