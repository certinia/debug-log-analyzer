/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

import type { ApexLog, LogEvent } from '@apexdevtools/apex-log-parser';

import type { DetailSelection, SelectionView } from '../core/events/EventBus.js';
import { ROOT_PATH_ID } from '../core/log/keyPathIds.js';
import { logStoreFor } from '../core/log/LogStore.js';
import { eventByEventIndex } from '../core/utility/EventSearch.js';

/** A row of a merged or Time Order view, and the way up its tree. */
export interface RowView {
  getData(): object;
  getTreeParent(): RowView | false;
}

/** A row of a merged view: `key` is the bucket it stands for, `instances` the
 *  occurrences it holds, which a bottom-up caller bucket has none of. */
interface CallRow {
  key?: string;
  /** The interned bucket path the row's builder stamped on it. */
  _pathId?: number;
  text?: string;
  instances?: LogEvent[];
  originalData?: LogEvent;
}

const rowCallData = (row: RowView): CallRow => row.getData() as CallRow;

/** Held per row: a pointer sweep re-enters rows and the click that follows a
 *  hover asks again, but deriving reads every occurrence the root bucket holds. */
const derivedIndexes = new WeakMap<CallRow, number[]>();

const NO_CALLS: LogEvent[] = [];

/**
 * The root bucket a derived row reads its calls from, or null where the walk
 * leaves the merged rows and the row stands for nothing.
 */
function rootBucketOf(row: RowView, data: CallRow): CallRow | null {
  let node = data;
  for (let parent = row.getTreeParent(); parent; parent = parent.getTreeParent()) {
    const parentData = rowCallData(parent);
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
function rowCallOccurrences(row: RowView, root: ApexLog | null): LogEvent[] {
  const data = rowCallData(row);
  if (data.instances?.length) {
    return data.instances;
  }
  if (data.key === undefined) {
    return data.originalData ? [data.originalData] : NO_CALLS;
  }
  return derivedRowOf(row, data, root).calls;
}

/** What a derived row's bucket answers: the calls whose chain runs through the
 *  row, and the frames the row is at its own depth. */
interface DerivedRow {
  calls: LogEvent[];
  frames: number[];
}

const NOTHING_DERIVED: DerivedRow = { calls: NO_CALLS, frames: [] };

/** Held per row: a pointer sweep re-enters rows and the click that follows a
 *  hover asks again, but deriving reads every occurrence the root bucket holds. */
const derivedRows = new WeakMap<CallRow, DerivedRow>();

/**
 * The root bucket's calls whose own chain runs through the row, and the frames
 * the row stands for.
 *
 * One walk per occurrence answers both: the walk that decides whether a chain
 * reaches the row stands on the row's own frame when it does.
 *
 * The table is the log's that built the rows: a path id is minted per log, so
 * another log's table would answer about a path of its own.
 */
function derivedRowOf(row: RowView, data: CallRow, root: ApexLog | null): DerivedRow {
  const cached = derivedRows.get(data);
  if (cached) {
    return cached;
  }
  const pathId = data._pathId;
  if (pathId === undefined || !root) {
    return NOTHING_DERIVED;
  }
  const paths = logStoreFor(root).keyPathIds();
  const instances = rootBucketOf(row, data)?.instances;
  if (!instances?.length) {
    return NOTHING_DERIVED;
  }
  const calls: LogEvent[] = [];
  const own = new Set<number>();
  for (const event of instances) {
    const node = paths.chainNodeAt(event, pathId);
    if (node) {
      calls.push(event);
      own.add(node.eventIndex);
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
  root: ApexLog,
  eventIndexes: readonly number[],
  direction: SelectionView,
): number[] {
  const paths = logStoreFor(root).keyPathIds();
  const events: LogEvent[] = [];
  for (const eventIndex of eventIndexes) {
    const event = eventByEventIndex(root, eventIndex);
    if (event) {
      events.push(event);
    }
  }
  if (direction === 'callers') {
    return paths.pathsEndingIn(new Set(events.map((event) => paths.keyIdOf(event))));
  }
  const found = new Set<number>();
  for (const event of events) {
    const pathId = paths.pathIdOf(event);
    if (pathId !== undefined) {
      found.add(pathId);
    }
  }
  return [...found];
}

/** The calls a row stands for, as the event indexes the mark works in.
 *
 * @param root - the log the row was built from, which its path id belongs to */
export function rowOccurrences(row: RowView, root: ApexLog | null): number[] {
  const data = rowCallData(row);
  const cached = derivedIndexes.get(data);
  if (cached) {
    return cached;
  }
  const indexes = rowCallOccurrences(row, root).map((event) => event.eventIndex);
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
export function rowFrames(row: RowView, root: ApexLog | null, direction: SelectionView): number[] {
  const data = rowCallData(row);
  const pathId = data._pathId;
  if (direction !== 'callers' || !root || pathId === undefined) {
    return rowOccurrences(row, root);
  }
  if (logStoreFor(root).keyPathIds().parentOf(pathId) === ROOT_PATH_ID) {
    // A row at the depth of its own calls stands for them.
    return rowOccurrences(row, root);
  }
  return derivedRowOf(row, data, root).frames;
}

/**
 * What a selected row tells the inspector: a merged row names every call it
 * counts, a Time Order row the one call it is, and no row nothing.
 *
 * @param root - the log the row was built from, which its path id belongs to
 * @param direction - the way the row's own table reads the tree
 */
export function rowDetailSelection(
  row: RowView | undefined,
  root: ApexLog | null,
  direction: SelectionView,
): DetailSelection | null {
  if (!row) {
    return null;
  }
  const data = rowCallData(row);
  const event = data.originalData;
  if (!event) {
    return null;
  }
  if (data.key === undefined) {
    return { kind: 'event', eventIndex: event.eventIndex };
  }
  // The row itself is what reached the calls, at whatever depth it sits: a
  // deeper row narrows the same calls to the ones its own chain conducted, so
  // naming a fixed frame would read the same at every depth. A root bucket holds
  // its own calls, so nothing reached them but it.
  return {
    kind: 'aggregate',
    instances: rowOccurrences(row, root),
    frames: rowFrames(row, root, direction),
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
  private lastRoot: ApexLog | null = null;
  private lastEvents: readonly number[] | undefined;
  private lastDirection: SelectionView | undefined;
  private lastIds: readonly number[] = [];

  /**
   * @param direction - The view's own direction, or undefined where its rows are
   * keyed by event and so are named by the indexes themselves.
   */
  public idsFor(
    root: ApexLog,
    eventIndexes: readonly number[],
    direction: SelectionView,
  ): readonly number[];
  public idsFor(
    root: ApexLog | null,
    eventIndexes: readonly number[],
    direction: SelectionView | undefined,
  ): readonly number[];
  public idsFor(
    root: ApexLog | null,
    eventIndexes: readonly number[],
    direction: SelectionView | undefined,
  ): readonly number[] {
    if (!direction) {
      // The view's rows are keyed by event, so the indexes name them as they are.
      return eventIndexes;
    }
    if (!root || !eventIndexes.length) {
      // A path id and an event index are both small integers, so passing the
      // indexes on would mark whichever rows happened to share their numbers.
      return [];
    }
    if (
      this.lastEvents === eventIndexes &&
      this.lastDirection === direction &&
      this.lastRoot === root
    ) {
      return this.lastIds;
    }
    this.lastRoot = root;
    this.lastEvents = eventIndexes;
    this.lastDirection = direction;
    this.lastIds = pathIdsForEvents(root, eventIndexes, direction);
    return this.lastIds;
  }
}
