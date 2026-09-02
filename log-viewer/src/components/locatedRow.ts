/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

import type { ApexLog, LogEvent } from 'apex-log-parser';
import type { RowComponent } from 'tabulator-tables';

import type { DetailSelection, SelectionView } from '../core/events/EventBus.js';
import { ROOT_PATH_ID } from '../core/log/keyPathIds.js';
import { logStoreFor } from '../core/log/LogStore.js';
import { eventByEventIndex } from '../core/utility/EventSearch.js';

/** Class the marked row carries; each table styles it itself. */
export const LOCATED_ROW_CLASS = 'located-row';

/** Attribute holding a row's index, so the mark can find its element. */
const ROW_INDEX_ATTRIBUTE = 'data-row-index';

/** Nothing wanted, shared so a cleared table costs no allocation. */
const NOTHING_WANTED: ReadonlySet<string> = new Set();

/**
 * The stamped ids each marked table wants lit.
 *
 * Held per host rather than on the marker so a row can light itself as it enters
 * the DOM. Tabulator builds a row's element on its first render, so a sweep of
 * what is rendered cannot reach a row that has never been on screen: one below
 * the viewport, or a tree child built after the mark was set.
 */
const wantedByHost = new WeakMap<HTMLElement, ReadonlySet<string>>();

/**
 * What each table's mark has lit.
 *
 * A sweep can only reach the rows a table has attached, and the renderer keeps
 * the element of a row scrolled out of view without running the formatter again
 * when it comes back. So an element lit while on screen has to be remembered to
 * be un-lit, or the old mark returns with it.
 */
const litByHost = new WeakMap<HTMLElement, Set<HTMLElement>>();

/** Lights `element`, and remembers it as `host`'s until the mark moves. */
function light(host: HTMLElement, element: HTMLElement): void {
  element.classList.add(LOCATED_ROW_CLASS);
  (litByHost.get(host) ?? litByHost.set(host, new Set()).get(host)!).add(element);
}

/** Drops `host`'s mark from every element it lit, attached or not. */
function unlight(host: HTMLElement): void {
  const lit = litByHost.get(host);
  if (!lit) {
    return;
  }
  for (const element of lit) {
    element.classList.remove(LOCATED_ROW_CLASS);
  }
  lit.clear();
}

/**
 * The row-holding element each marked table is watched through.
 *
 * Held per host so a table rebuilt into the same container is watched again: the
 * element belongs to the Tabulator instance, not to the container, and several
 * views destroy and rebuild a table in place.
 */
const watchedByHost = new WeakMap<HTMLElement, { rows: Element; observer: MutationObserver }>();

/**
 * Sweeps `host` again whenever rows enter its table, so a row coming back into
 * view carries the mark as it stands.
 *
 * The renderer re-attaches a row it has already built without running the
 * formatter again, so a row detached before the mark named it is out of reach of
 * both halves: the sweep could not see it and the stamp will not run for it. That
 * happens on a scroll and equally on a structural render, which fires no scroll
 * event at all.
 *
 * Watched is the arrival itself, which is a child of the row-holding element and
 * so cannot be missed. A signal read from the renderer's own bookkeeping can be:
 * a scroll fires no event on a sort, and the virtual spacers are written with the
 * value they already hold whenever the window does not move, which reports
 * nothing at all.
 */
function watchRenders(host: HTMLElement): void {
  const watching = watchedByHost.get(host);
  const rows = host.querySelector('.tabulator-table');
  if (watching?.rows === rows) {
    return;
  }
  watching?.observer.disconnect();
  if (!rows) {
    watchedByHost.delete(host);
    return;
  }
  const observer = new MutationObserver(() => {
    const wanted = wantedByHost.get(host);
    if (wanted?.size) {
      // Only ever touches a class, so it cannot report itself back here.
      sweep(host, wanted);
    }
  });
  observer.observe(rows, { childList: true });
  watchedByHost.set(host, { rows, observer });
}

/** Lights the rows a table has rendered that `wanted` names. */
function sweep(host: HTMLElement, wanted: ReadonlySet<string>): void {
  for (const element of host.querySelectorAll<HTMLElement>(
    `.tabulator-row[${ROW_INDEX_ATTRIBUTE}]`,
  )) {
    if (wanted.has(element.getAttribute(ROW_INDEX_ATTRIBUTE)!)) {
      light(host, element);
    }
  }
}

/**
 * Stamps what identifies `row` in its table, and lights it where the mark wants
 * that id.
 *
 * The walk up is short, a row sitting a handful of nodes below its table, and it
 * is what lets the mark be a property of the table rather than of the elements
 * that happened to be rendered when it was set. A row in a table nothing has
 * marked is left as it is.
 */
function stamp(row: RowComponent, id: number | string): void {
  const element = row.getElement();
  if (!element) {
    return;
  }
  const stamped = String(id);
  element.setAttribute(ROW_INDEX_ATTRIBUTE, stamped);
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const wanted = wantedByHost.get(node);
    if (wanted) {
      if (wanted.has(stamped)) {
        light(node, element);
      } else {
        element.classList.remove(LOCATED_ROW_CLASS);
      }
      return;
    }
  }
}

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
      stamp(row, index);
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
    stamp(row, id);
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
function derivedRowOf(row: RowComponent, data: CallRow, root: ApexLog | null): DerivedRow {
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
export function rowFrames(
  row: RowComponent,
  root: ApexLog | null,
  direction: SelectionView,
): number[] {
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
 * scrolls, expands or re-sorts. It belongs to the table rather than to the rows
 * rendered when it was set, so a row scrolled back into view lights itself.
 *
 * The table must stamp its rows: {@link rowIndexStamper} where a row is one
 * frame, {@link stampRowPath} where rows merge occurrences.
 */
export class LocatedRowMarker {
  private host: HTMLElement | null = null;

  /**
   * Move the mark to the rows `ids` name, or drop it with an empty list. Only the
   * rendered rows are swept, so the cost follows the viewport rather than the
   * table; callers still only call this when the target changes.
   *
   * @param host - Element the table is mounted in
   * @param ids - What the table stamps for the rows to mark, empty to clear
   */
  public mark(host: HTMLElement | null, ids: readonly (number | string)[]): void {
    if (this.host && this.host !== host) {
      // A view that switches tables would leave the one it left marked.
      wantedByHost.delete(this.host);
      unlight(this.host);
    }
    this.host = host;
    if (!host) {
      return;
    }
    unlight(host);
    const wanted = ids.length ? new Set(ids.map(String)) : NOTHING_WANTED;
    wantedByHost.set(host, wanted);
    sweep(host, wanted);
    if (wanted.size) {
      watchRenders(host);
    }
  }

  /** Drop the mark, if one is set. */
  public clear(): void {
    this.mark(this.host, []);
  }
}
