/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

import type { DetailSelection, SelectionView } from '../core/events/EventBus.js';
import { ROOT_PATH_ID } from '../core/log/keyPathIds.js';
import type { LogStore } from '../core/log/LogStore.js';

/** How the inspector reads a grid's row: its data, and the row above it. */
export interface RowReader<R> {
  data: (row: R) => RowData;
  parentOf: (row: R) => R | undefined;
}

/** What the inspector reads off a row. A merged row's `key` is the bucket it stands for,
 *  `instances` the occurrences it holds, which a bottom-up caller bucket has none of. */
export interface RowData {
  key?: string;
  /** The interned bucket path the row's builder stamped on it. */
  _pathId?: number;
  text?: string;
  /** The ids of the calls the row merges. */
  instances?: readonly number[];
  /** The id of the row's event, or of a merged row's first call. */
  eventIndex?: number;
}

const rowCallData = <R>(row: R, read: RowReader<R>): RowData => read.data(row);

/** Held per row: a pointer sweep re-enters rows and the click that follows a
 *  hover asks again, but deriving reads every occurrence the root bucket holds. */
const derivedIndexes = new WeakMap<RowData, readonly number[]>();

const NO_CALLS: readonly number[] = [];

/**
 * The root bucket a derived row reads its calls from, or null where the walk
 * leaves the merged rows and the row stands for nothing.
 */
function rootBucketOf<R>(row: R, read: RowReader<R>, data: RowData): RowData | null {
  let node = data;
  for (let parent = read.parentOf(row); parent; parent = read.parentOf(parent)) {
    const parentData = rowCallData(parent, read);
    if (parentData.key === undefined) {
      return null;
    }
    node = parentData;
  }
  // The tree parent is the callee, so the walk runs inwards, to the bucket that
  // holds the calls.
  return node;
}

/**
 * The calls a row stands for. A bottom-up caller row holds none of its own, so it
 * is derived from its root bucket and the chain that reaches it.
 */
function rowCallOccurrences<R>(
  row: R,
  read: RowReader<R>,
  store: LogStore | null,
): readonly number[] {
  const data = rowCallData(row, read);
  if (data.instances?.length) {
    return data.instances;
  }
  if (data.key === undefined) {
    return data.eventIndex === undefined ? NO_CALLS : [data.eventIndex];
  }
  return derivedRowOf(row, read, data, store).calls;
}

/** What a derived row's bucket answers: the calls whose chain runs through the
 *  row, and the frames the row is at its own depth. */
interface DerivedRow {
  calls: readonly number[];
  frames: number[];
}

const NOTHING_DERIVED: DerivedRow = { calls: NO_CALLS, frames: [] };

/** Held per row: a pointer sweep re-enters rows and the click that follows a
 *  hover asks again, but deriving reads every occurrence the root bucket holds. */
const derivedRows = new WeakMap<RowData, DerivedRow>();

/**
 * The root bucket's calls whose own chain runs through the row, and the frames
 * the row stands for.
 *
 * One walk per occurrence answers both: the walk that decides whether a chain
 * reaches the row stands on the row's own frame when it does.
 *
 * The table is the store's that built the rows: a path id is minted per store, so
 * another store's table would answer about a path of its own.
 */
function derivedRowOf<R>(
  row: R,
  read: RowReader<R>,
  data: RowData,
  store: LogStore | null,
): DerivedRow {
  const cached = derivedRows.get(data);
  if (cached) {
    return cached;
  }
  const pathId = data._pathId;
  if (pathId === undefined || !store) {
    return NOTHING_DERIVED;
  }
  const paths = store.keyPathIds();
  const instances = rootBucketOf(row, read, data)?.instances;
  if (!instances?.length) {
    return NOTHING_DERIVED;
  }
  const calls: number[] = [];
  const own = new Set<number>();
  for (const id of instances) {
    const node = paths.chainNodeAt(id, pathId);
    if (node) {
      calls.push(id);
      own.add(node);
    }
  }
  const derived = { calls, frames: [...own] };
  if (calls.length) {
    // Not kept where nothing derived, for the reason `rowOccurrences` gives.
    derivedRows.set(data, derived);
  }
  return derived;
}

/**
 * The path ids that the frames `eventIndexes` name stand for, so a grid whose
 * rows merge occurrences can mark them.
 *
 * A bottom-up row is the frame at its own depth, so a frame stands for the rows
 * its own key heads, wherever they sit; the chain above it holds its callers'
 * rows. A top-down row sits on the frame's own chain, so one id names it.
 */
function pathIdsForEvents(
  store: LogStore,
  eventIndexes: readonly number[],
  direction: SelectionView,
): number[] {
  const paths = store.keyPathIds();
  const ids = eventIndexes.filter((id) => store.isShown(id));
  if (direction === 'callers') {
    return paths.pathsEndingIn(new Set(ids.map((id) => paths.keyIdOf(id))));
  }
  const found = new Set<number>();
  for (const id of ids) {
    const pathId = paths.pathIdOf(id);
    if (pathId !== undefined) {
      found.add(pathId);
    }
  }
  return [...found];
}

/** The calls a row stands for, as the event ids the mark works in.
 *
 * @param store - the store the row was built from, which its path id belongs to */
function rowOccurrences<R>(row: R, read: RowReader<R>, store: LogStore | null): readonly number[] {
  const data = rowCallData(row, read);
  const cached = derivedIndexes.get(data);
  if (cached) {
    return cached;
  }
  const indexes = rowCallOccurrences(row, read, store);
  if (indexes.length) {
    // Not kept where nothing derived: the calls are read through the log on
    // screen, so an answer of none can be that log not being set yet.
    derivedIndexes.set(data, indexes);
  }
  return indexes;
}

/**
 * The frames a row is, which is what the inspector marks it by.
 *
 * A bottom-up caller row is one of the frames above a call, so it stands for the
 * callers at its own depth rather than the calls they conducted. A top-down row
 * sits at its own frames' depth, so there the two are the same, and so is a row
 * that is one call.
 *
 * {@link rowOccurrences} stays the calls the row counts, which is what its
 * totals describe.
 *
 * @param direction - the way the row's own table reads the tree
 */
export function rowFrames<R>(
  row: R,
  read: RowReader<R>,
  store: LogStore | null,
  direction: SelectionView,
): readonly number[] {
  const data = rowCallData(row, read);
  const pathId = data._pathId;
  if (direction !== 'callers' || !store || pathId === undefined) {
    return rowOccurrences(row, read, store);
  }
  if (store.keyPathIds().parentOf(pathId) === ROOT_PATH_ID) {
    // A row at the depth of its own calls stands for them.
    return rowOccurrences(row, read, store);
  }
  return derivedRowOf(row, read, data, store).frames;
}

/**
 * What a selected row tells the inspector: a merged row names every call it
 * counts, a Time Order row the one call it is, and no row nothing.
 *
 * @param store - the store the row was built from, which its path id belongs to
 * @param direction - the way the row's own table reads the tree
 */
export function rowDetailSelection<R>(
  row: R | null,
  read: RowReader<R>,
  store: LogStore | null,
  direction: SelectionView,
): DetailSelection | null {
  if (!row) {
    return null;
  }
  const data = rowCallData(row, read);
  const { eventIndex } = data;
  if (eventIndex === undefined) {
    return null;
  }
  if (data.key === undefined) {
    return { kind: 'event', eventIndex };
  }
  // The row itself is what reached the calls, at whatever depth it sits: a
  // deeper row narrows the same calls to the ones its own chain conducted, so
  // naming a fixed frame would read the same at every depth. A root bucket holds
  // its own calls, so nothing reached them but it.
  return {
    kind: 'aggregate',
    instances: [...rowOccurrences(row, read, store)],
    frames: [...rowFrames(row, read, store, direction)],
    calledBy: data.instances?.length ? undefined : data.text,
  };
}

/**
 * The ids that mark a view's rows for a list of frames, memoised on the list.
 *
 * A view re-reports its picked frames every time the pointer leaves an inspector
 * row, and translating a wide pick into bucket paths costs far more than the mark
 * it feeds.
 */
export class LocatedRowIds {
  private lastStore: LogStore | null = null;
  private lastEvents: readonly number[] | undefined;
  private lastDirection: SelectionView | undefined;
  private lastIds: readonly number[] = [];

  /**
   * @param direction - The view's own direction, or undefined where its rows are
   * keyed by event and so are named by the indexes themselves.
   */
  public idsFor(
    store: LogStore,
    eventIndexes: readonly number[],
    direction: SelectionView,
  ): readonly number[];
  public idsFor(
    store: LogStore | null,
    eventIndexes: readonly number[],
    direction: SelectionView | undefined,
  ): readonly number[];
  public idsFor(
    store: LogStore | null,
    eventIndexes: readonly number[],
    direction: SelectionView | undefined,
  ): readonly number[] {
    if (!direction) {
      // The view's rows are keyed by event, so the indexes name them as they are.
      return eventIndexes;
    }
    if (!store || !eventIndexes.length) {
      // A path id and an event index are both small integers, so passing the
      // indexes on would mark whichever rows happened to share their numbers.
      return [];
    }
    if (
      this.lastEvents === eventIndexes &&
      this.lastDirection === direction &&
      this.lastStore === store
    ) {
      return this.lastIds;
    }
    this.lastStore = store;
    this.lastEvents = eventIndexes;
    this.lastDirection = direction;
    this.lastIds = pathIdsForEvents(store, eventIndexes, direction);
    return this.lastIds;
  }
}
