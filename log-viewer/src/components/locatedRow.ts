/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

import type { LogEvent } from 'apex-log-parser';
import type { RowComponent } from 'tabulator-tables';

import type { DetailSelection } from '../core/events/EventBus.js';
import { occurrencesThrough } from '../features/call-tree/utils/bottomUpOccurrences.js';

/** Class the marked row carries; each table styles it itself. */
export const LOCATED_ROW_CLASS = 'located-row';

/** Attribute holding a row's index, so the mark can find its element. */
const ROW_INDEX_ATTRIBUTE = 'data-row-index';

/**
 * Builds a Tabulator `rowFormatter` that stamps the row's index on its element.
 *
 * The mark then finds a row with one DOM query. Asking Tabulator instead
 * (`getRows('visible')`) wraps every row in the table in a component, which the
 * pointer moves that drive the mark cannot afford on a large log.
 *
 * The index is read from the data rather than `getIndex()`: Tabulator runs the
 * formatter for its calc rows too, and those carry no index.
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

const NO_CALLS: LogEvent[] = [];

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

  const chain = [data.key];
  let root = data;
  for (let parent = row.getTreeParent(); parent; parent = parent.getTreeParent()) {
    root = rowCallData(parent);
    if (root.key === undefined) {
      derivedCalls.set(data, NO_CALLS);
      return NO_CALLS;
    }
    chain.push(root.key);
  }
  // The tree parent is the callee, so the walk runs inwards; the path runs out.
  const derived = occurrencesThrough(root.instances ?? [], chain.reverse());
  derivedCalls.set(data, derived);
  return derived;
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
  return { kind: 'aggregate', instances: rowOccurrences(row), label: data.text ?? event.text };
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
 * The table must use {@link rowIndexStamper} to build its `rowFormatter`.
 */
export class LocatedRowMarker {
  private elements: HTMLElement[] = [];

  /**
   * Move the mark to the rows for `eventIndexes`, or drop it with an empty list.
   * Only the rendered rows are read, so the cost follows the viewport rather than
   * the table; callers still only call this when the target changes.
   *
   * @param host - Element the table is mounted in
   * @param eventIndexes - Events to mark, empty to clear
   */
  public mark(host: HTMLElement | null, eventIndexes: readonly number[]): void {
    this.clear();
    if (!host || !eventIndexes.length) {
      return;
    }
    const wanted = new Set(eventIndexes.map(String));
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
