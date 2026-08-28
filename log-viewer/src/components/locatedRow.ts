/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

import type { ApexLog, LogEvent } from 'apex-log-parser';
import type { RowComponent } from 'tabulator-tables';

import type { DetailSelection, SelectionView } from '../core/events/EventBus.js';
import { logStoreFor } from '../core/log/LogStore.js';
import { eventByEventIndex } from '../core/utility/EventSearch.js';

/** Class the marked row carries; each table styles it itself. */
export const LOCATED_ROW_CLASS = 'located-row';

/** Attribute holding a row's index, so the mark can find its element. */
const ROW_INDEX_ATTRIBUTE = 'data-row-index';

/**
 * Builds a Tabulator `rowFormatter` that stamps what identifies the row in its
 * own table: an event index where every row is one frame.
 *
 * The mark then finds a row with one DOM query. Asking Tabulator instead
 * (`getRows('visible')`) wraps every row in the table in a component, which the
 * pointer moves that drive the mark cannot afford on a large log.
 *
 * The index is read from the data rather than `getIndex()`: Tabulator runs the
 * formatter for its calc rows too, and those carry no index.
 *
 * A view whose rows merge occurrences stamps {@link stampRowPath} instead, as a
 * bucket has no event of its own.
 *
 * @param indexField - the table's `index` option
 */
export function rowIndexStamper(indexField: string): (row: RowComponent) => void {
  return (row) => {
    const index = (row.getData() as Record<string, unknown>)[indexField];
    if (typeof index === 'number' || typeof index === 'string') {
      row.getElement()?.setAttribute(ROW_INDEX_ATTRIBUTE, String(index));
    }
  };
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

const rowCallData = (row: RowComponent): CallRow => row.getData() as CallRow;

/** Held per row: a pointer sweep re-enters rows and the click that follows a
 *  hover asks again, but deriving reads every occurrence the root bucket holds. */
const derivedIndexes = new WeakMap<CallRow, number[]>();

const NO_CALLS: LogEvent[] = [];

/**
 * The root bucket a derived row reads its calls from, or null where the walk
 * leaves the merged rows and the row stands for nothing.
 */
function rootBucketOf(row: RowComponent, data: CallRow): CallRow | null {
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
 * A row's own index value, read from the data.
 *
 * Never `RowComponent.getIndex()`: that routes through Tabulator's accessor,
 * which deep-clones the row data. Our rows hold the parsed log, so one call
 * walks the whole event graph and blocks the UI for minutes.
 */
export function rowId(row: RowComponent | undefined): number | undefined {
  const id = (row?.getData() as { id?: unknown } | undefined)?.id;
  return typeof id === 'number' ? id : undefined;
}

/**
 * What tells a merged row apart from a same-named row under a different parent:
 * the bucket path its builder stamped on it. A single key does not, because a
 * bucket map is allocated per parent, so one method holds a row under every
 * caller it has.
 *
 * Undefined on a row that stands for one frame, which its event index identifies.
 */
export function rowPathId(row: RowComponent): number | undefined {
  return rowCallData(row)._pathId;
}

/** A `rowFormatter` for a view whose rows merge occurrences, stamping the path id
 *  so the mark finds the row with the same one DOM query. */
export function stampRowPath(row: RowComponent): void {
  const id = rowPathId(row);
  if (id !== undefined) {
    row.getElement()?.setAttribute(ROW_INDEX_ATTRIBUTE, String(id));
  }
}

/**
 * The calls a row stands for. A bottom-up caller row holds none of its own, so it
 * is derived from its root bucket and the chain that reaches it.
 */
function rowCallOccurrences(row: RowComponent, root: ApexLog | null): LogEvent[] {
  const data = rowCallData(row);
  if (data.instances?.length) {
    return data.instances;
  }
  if (data.key === undefined) {
    return data.originalData ? [data.originalData] : NO_CALLS;
  }
  return deriveCalls(row, data, root);
}

/**
 * The root bucket's calls whose own chain runs through the row.
 *
 * The table is the log's that built the rows: a path id is minted per log, so
 * another log's table would answer about a path of its own.
 */
function deriveCalls(row: RowComponent, data: CallRow, root: ApexLog | null): LogEvent[] {
  const pathId = data._pathId;
  if (pathId === undefined || !root) {
    return NO_CALLS;
  }
  const paths = logStoreFor(root).keyPathIds();
  const instances = rootBucketOf(row, data)?.instances;
  if (!instances?.length) {
    return NO_CALLS;
  }
  return instances.filter((event) => paths.chainReaches(event, pathId));
}

/**
 * The path ids that the frames `eventIndexes` name stand for, so a grid whose
 * rows merge occurrences can mark them.
 *
 * Every occurrence is walked: occurrences of one frame sit under distinct parent
 * frames, so there is no cheaper set to walk, and only the paths they produce
 * repeat.
 */
function pathIdsForEvents(
  root: ApexLog,
  eventIndexes: readonly number[],
  direction: SelectionView,
): number[] {
  const paths = logStoreFor(root).keyPathIds();
  const found = new Set<number>();
  for (const eventIndex of eventIndexes) {
    const event = eventByEventIndex(root, eventIndex);
    if (event) {
      paths.pathIdsOf(event, direction, found);
    }
  }
  return [...found];
}

/** The calls a row stands for, as the event indexes the mark works in.
 *
 * @param root - the log the row was built from, which its path id belongs to */
export function rowOccurrences(row: RowComponent, root: ApexLog | null): number[] {
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
 * What a selected row tells the inspector: a merged row names every call it
 * counts, a Time Order row the one call it is, and no row nothing.
 *
 * @param root - the log the row was built from, which its path id belongs to
 */
export function rowDetailSelection(
  row: RowComponent | undefined,
  root: ApexLog | null,
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

/**
 * Marks the rows for the events under the pointer elsewhere, so the two sides of
 * the inspector point at the same thing. A merged row stands for many events, so
 * a mark can land on several rows at once.
 *
 * The mark is not a selection: it only styles the row elements, so nothing
 * scrolls, expands or re-sorts. Rows the table has not rendered have no element
 * to mark, so they are left alone.
 *
 * The table must stamp its rows: {@link rowIndexStamper} where a row is one
 * frame, {@link stampRowPath} where rows merge occurrences.
 */
export class LocatedRowMarker {
  private elements: HTMLElement[] = [];

  /**
   * Move the mark to the rows `ids` name, or drop it with an empty list. Only the
   * rendered rows are read, so the cost follows the viewport rather than the
   * table; callers still only call this when the target changes.
   *
   * @param host - Element the table is mounted in
   * @param ids - What the table stamps for the rows to mark, empty to clear
   */
  public mark(host: HTMLElement | null, ids: readonly (number | string)[]): void {
    this.clear();
    if (!host || !ids.length) {
      return;
    }
    const wanted = new Set(ids.map(String));
    for (const element of host.querySelectorAll<HTMLElement>(
      `.tabulator-row[${ROW_INDEX_ATTRIBUTE}]`,
    )) {
      if (wanted.has(element.getAttribute(ROW_INDEX_ATTRIBUTE)!)) {
        element.classList.add(LOCATED_ROW_CLASS);
        this.elements.push(element);
      }
    }
  }

  /** Drop the mark, if one is set. */
  public clear(): void {
    for (const element of this.elements) {
      element.classList.remove(LOCATED_ROW_CLASS);
    }
    this.elements = [];
  }
}
