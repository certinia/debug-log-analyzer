/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

import type { ApexLog, LogEvent } from 'apex-log-parser';
import type { RowComponent } from 'tabulator-tables';

import type { DetailSelection, SelectionView } from '../core/events/EventBus.js';
import { logStoreFor } from '../core/log/LogStore.js';
import type { KeyPathIds } from '../core/log/keyPathIds.js';
import { eventByEventIndex } from '../core/utility/EventSearch.js';
import { eventKeyChain } from '../features/call-tree/utils/Aggregation.js';
import { occurrencesThrough } from '../features/call-tree/utils/bottomUpOccurrences.js';

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
 * A view whose rows merge occurrences stamps {@link rowPathStamper} instead, as
 * a bucket has no event of its own.
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
  text?: string;
  instances?: LogEvent[];
  originalData?: LogEvent;
}

const rowCallData = (row: RowComponent): CallRow => row.getData() as CallRow;

/** Derived calls, held per row: a pointer sweep re-enters rows, and the click
 *  that follows a hover asks again. Both answers are cached, because deriving
 *  them reads every occurrence the root bucket holds. */
const derivedCalls = new WeakMap<CallRow, LogEvent[]>();
const derivedIndexes = new WeakMap<CallRow, number[]>();
const derivedChains = new WeakMap<CallRow, CallChain | null>();

const NO_CALLS: LogEvent[] = [];

/** Where a derived bottom-up row sits: the root bucket whose calls it stands
 *  for, the keys from that root out to the row, and the row under the root —
 *  the frame that made those calls. */
interface CallChain {
  root: CallRow;
  keys: string[];
  caller: CallRow;
}

/**
 * A derived row's place in the bottom-up tree, or null where the walk leaves the
 * merged rows and the row stands for nothing. Cached: the occurrences and the
 * caller are both read off it.
 */
function rowCallChain(row: RowComponent, data: CallRow): CallChain | null {
  const cached = derivedChains.get(data);
  if (cached !== undefined) {
    return cached;
  }
  const keys = [data.key!];
  let node = data;
  let caller = data;
  for (let parent = row.getTreeParent(); parent; parent = parent.getTreeParent()) {
    const parentData = rowCallData(parent);
    if (parentData.key === undefined) {
      derivedChains.set(data, null);
      return null;
    }
    caller = node;
    node = parentData;
    keys.push(parentData.key);
  }
  // The tree parent is the callee, so the walk runs inwards; the path runs out.
  const chain: CallChain = { root: node, keys: keys.reverse(), caller };
  derivedChains.set(data, chain);
  return chain;
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

const pathIds = new WeakMap<CallRow, number>();

/**
 * What tells a merged row apart from a same-named row under a different parent:
 * the bucket keys from its top-level ancestor out to the row itself, interned to
 * one integer. A single key does not, because a bucket map is allocated per
 * parent, so one method holds a row under every caller it has.
 *
 * Undefined on a row that stands for one frame, which its event index identifies.
 */
export function rowPathId(row: RowComponent, ids: KeyPathIds): number | undefined {
  const data = rowCallData(row);
  if (data.key === undefined) {
    return undefined;
  }
  const cached = pathIds.get(data);
  if (cached !== undefined) {
    return cached;
  }
  const keys = [data.key];
  for (let parent = row.getTreeParent(); parent; parent = parent.getTreeParent()) {
    const parentKey = rowCallData(parent).key;
    if (parentKey === undefined) {
      break;
    }
    keys.push(parentKey);
  }
  const id = ids.pathOf(keys);
  pathIds.set(data, id);
  return id;
}

/** A `rowFormatter` for a view whose rows merge occurrences, stamping the path id
 *  so the mark finds the row with the same one DOM query. */
export function rowPathStamper(ids: KeyPathIds): (row: RowComponent) => void {
  return (row) => {
    const id = rowPathId(row, ids);
    if (id !== undefined) {
      row.getElement()?.setAttribute(ROW_INDEX_ATTRIBUTE, String(id));
    }
  };
}

/**
 * The path ids naming the rows a frame belongs to in a merged view.
 *
 * A top-down row sits at the frame's own depth, so one id names it. A bottom-up
 * row is the frame plus however many of its callers the chain shows, so every
 * prefix names a row the frame heads — which is why one frame marks several rows
 * there, and why each prefix is interned as it is reached.
 *
 * The log root is not a row in either view, so the walk stops below it.
 */
export function eventPathIds(event: LogEvent, direction: SelectionView, ids: KeyPathIds): number[] {
  const keys = eventKeyChain(event);
  if (!keys.length) {
    return [];
  }
  return direction === 'callees' ? [ids.pathOf(keys)] : ids.prefixesOf(keys);
}

/** True where the row holds no calls of its own, so its chain answers for it. */
function isDerived(data: CallRow): boolean {
  return !data.instances?.length && data.key !== undefined;
}

/**
 * The calls a row stands for. A bottom-up caller row holds none of its own, so it
 * is derived from its root bucket and the chain that reaches it.
 */
function rowCallOccurrences(row: RowComponent): LogEvent[] {
  const data = rowCallData(row);
  if (data.instances?.length) {
    return data.instances;
  }
  if (data.key === undefined) {
    return data.originalData ? [data.originalData] : NO_CALLS;
  }
  const cached = derivedCalls.get(data);
  if (cached) {
    return cached;
  }
  const chain = rowCallChain(row, data);
  const derived = chain ? occurrencesThrough(chain.root.instances ?? [], chain.keys) : NO_CALLS;
  derivedCalls.set(data, derived);
  return derived;
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
  const ids = logStoreFor(root).keyPathIds();
  const found = new Set<number>();
  for (const eventIndex of eventIndexes) {
    const event = eventByEventIndex(root, eventIndex);
    if (!event) {
      continue;
    }
    for (const id of eventPathIds(event, direction, ids)) {
      found.add(id);
    }
  }
  return [...found];
}

/** The calls a row stands for, as the event indexes the mark works in. */
export function rowOccurrences(row: RowComponent): number[] {
  const data = rowCallData(row);
  const cached = derivedIndexes.get(data);
  if (cached) {
    return cached;
  }
  const indexes = rowCallOccurrences(row).map((event) => event.eventIndex);
  derivedIndexes.set(data, indexes);
  return indexes;
}

/**
 * What a selected row tells the inspector: a merged row names every call it
 * counts, a Time Order row the one call it is, and no row nothing.
 */
export function rowDetailSelection(row: RowComponent | undefined): DetailSelection | null {
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
  // A bucket stands for its calls even where none derive: `originalData` is the
  // caller frame, which is the mis-scoping this scoping exists to avoid.
  const chain = isDerived(data) ? rowCallChain(row, data) : null;
  return {
    kind: 'aggregate',
    instances: rowOccurrences(row),
    calledBy: chain?.caller.text,
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
 * frame, {@link rowPathStamper} where rows merge occurrences.
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
