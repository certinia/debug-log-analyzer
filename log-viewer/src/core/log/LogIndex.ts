/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ApexLog, LogEvent } from '@apexdevtools/apex-log-parser';

/** What {@link LogIndex.rowOf} answers for an event that is not in the tree. */
export const NO_ROW = -1;

interface Columns {
  /** The row's slot in `eventsById`. */
  eventIndex: Int32Array;
  /** `timestamp`, in nanoseconds. */
  start: Float64Array;
  /** `duration.total`, in nanoseconds. */
  total: Float64Array;
  /** `duration.self`, in nanoseconds. */
  self: Float64Array;
  /** 0 for the root's children. */
  depth: Uint16Array;
  /** {@link NO_ROW} for the root's children. */
  parent: Int32Array;
  /** The first row after this row's subtree. */
  subtreeEnd: Int32Array;
  /** An index into {@link LogIndex.categoryNames}. */
  categoryId: Uint8Array;
}

/**
 * The log's tree as flat columns, one row per event, so a view reads typed arrays
 * rather than walking objects.
 *
 * Rows are the events reachable from the root's children, in pre-order, which is
 * log order, so `eventIndex` ascends. Not rows: the root, the exit lines the parser
 * matched to an entry, and the managed-package events its merge cut out of the tree.
 *
 * A row's children run from `row + 1` to `subtreeEnd[row]`, each one skipping the
 * last one's subtree: `for (let c = row + 1; c < end; c = subtreeEnd[c])`.
 *
 * One index per log, held by `LogStore`.
 */
export interface LogIndex extends Readonly<Columns> {
  readonly rowCount: number;
  readonly categoryNames: readonly string[];
  /** The parser event for a row. */
  event(row: number): LogEvent;
  /** The row for an eventIndex, or {@link NO_ROW} for the root, an exit line or a
   *  merged-away event. */
  rowOf(eventIndex: number): number;
  /** The row for an event, or {@link NO_ROW} if it is not in the tree. */
  rowOfEvent(event: LogEvent): number;
}

class Index implements LogIndex {
  readonly rowCount: number;
  readonly categoryNames: readonly string[];
  readonly eventIndex: Int32Array;
  readonly start: Float64Array;
  readonly total: Float64Array;
  readonly self: Float64Array;
  readonly depth: Uint16Array;
  readonly parent: Int32Array;
  readonly subtreeEnd: Int32Array;
  readonly categoryId: Uint8Array;
  private readonly log: ApexLog;

  constructor(log: ApexLog, rowCount: number, columns: Columns, categoryNames: string[]) {
    this.log = log;
    this.rowCount = rowCount;
    this.categoryNames = categoryNames;
    ({
      eventIndex: this.eventIndex,
      start: this.start,
      total: this.total,
      self: this.self,
      depth: this.depth,
      parent: this.parent,
      subtreeEnd: this.subtreeEnd,
      categoryId: this.categoryId,
    } = columns);
  }

  event(row: number): LogEvent {
    // In range by contract: every eventIndex entry came from eventsById.
    return this.log.eventsById[this.eventIndex[row]!]!;
  }

  rowOf(eventIndex: number): number {
    const column = this.eventIndex;
    let low = 0;
    let high = this.rowCount - 1;
    while (low <= high) {
      const mid = (low + high) >>> 1;
      const at = column[mid]!;
      if (at < eventIndex) {
        low = mid + 1;
      } else if (at > eventIndex) {
        high = mid - 1;
      } else {
        return mid;
      }
    }
    return NO_ROW;
  }

  rowOfEvent(event: LogEvent): number {
    const row = this.rowOf(event.eventIndex);
    return row !== NO_ROW && this.event(row) === event ? row : NO_ROW;
  }
}

/**
 * Builds a {@link LogIndex} a slice at a time, so a caller can hand the thread
 * back between slices, or run it to the end in one go.
 */
export class LogIndexBuilder {
  private readonly log: ApexLog;
  private columns: Columns;
  private rowCount = 0;
  private readonly categoryIds = new Map<string, number>([['', 0]]);

  // One entry per open level: the children being read, the next one to read, and
  // the row that owns them. The stack index is the depth.
  private readonly levelChildren: LogEvent[][];
  private readonly levelCursor: number[] = [0];
  private readonly levelRow: number[] = [NO_ROW];

  constructor(log: ApexLog) {
    this.log = log;
    this.levelChildren = [log.children];
    // An upper bound: eventsById also holds the root and the exit lines.
    this.columns = allocate(log.eventsById.length);
  }

  /** Adds up to `maxRows` rows. Returns true once every row is in. */
  step(maxRows: number): boolean {
    const { levelChildren, levelCursor, levelRow } = this;
    const c = this.columns;
    let budget = maxRows;
    while (levelChildren.length && budget > 0) {
      const level = levelChildren.length - 1;
      const children = levelChildren[level]!;
      const cursor = levelCursor[level]!;
      if (cursor === children.length) {
        const owner = levelRow[level]!;
        if (owner !== NO_ROW) {
          c.subtreeEnd[owner] = this.rowCount;
        }
        levelChildren.pop();
        levelCursor.pop();
        levelRow.pop();
        continue;
      }
      levelCursor[level] = cursor + 1;
      budget--;

      const event = children[cursor]!;
      const row = this.rowCount++;
      c.eventIndex[row] = event.eventIndex;
      c.start[row] = event.timestamp;
      c.total[row] = event.duration.total;
      c.self[row] = event.duration.self;
      c.depth[row] = level;
      c.parent[row] = levelRow[level]!;
      c.categoryId[row] = this.categoryIdOf(event.category);

      if (event.children.length) {
        levelChildren.push(event.children);
        levelCursor.push(0);
        levelRow.push(row);
      } else {
        c.subtreeEnd[row] = row + 1;
      }
    }
    return levelChildren.length === 0;
  }

  /** The index, once {@link step} has returned true. */
  finish(): LogIndex {
    const n = this.rowCount;
    const full = this.columns;
    const empty = allocate(0);
    this.columns = empty;
    // Each full-size column is let go once copied, so the peak is one column's slack.
    const cut = <K extends keyof Columns>(key: K): Columns[K] => {
      const kept = full[key].slice(0, n) as Columns[K];
      full[key] = empty[key];
      return kept;
    };
    const columns: Columns = {
      eventIndex: cut('eventIndex'),
      start: cut('start'),
      total: cut('total'),
      self: cut('self'),
      depth: cut('depth'),
      parent: cut('parent'),
      subtreeEnd: cut('subtreeEnd'),
      categoryId: cut('categoryId'),
    };
    return new Index(this.log, n, columns, [...this.categoryIds.keys()]);
  }

  private categoryIdOf(category: string): number {
    let id = this.categoryIds.get(category);
    if (id === undefined) {
      id = this.categoryIds.size;
      this.categoryIds.set(category, id);
    }
    return id;
  }
}

function allocate(capacity: number): Columns {
  return {
    eventIndex: new Int32Array(capacity),
    start: new Float64Array(capacity),
    total: new Float64Array(capacity),
    self: new Float64Array(capacity),
    depth: new Uint16Array(capacity),
    parent: new Int32Array(capacity),
    subtreeEnd: new Int32Array(capacity),
    categoryId: new Uint8Array(capacity),
  };
}

/** The whole index in one go. */
export function buildLogIndex(log: ApexLog): LogIndex {
  const builder = new LogIndexBuilder(log);
  builder.step(Infinity);
  return builder.finish();
}
