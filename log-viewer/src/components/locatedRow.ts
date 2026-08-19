/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

import type { RowComponent } from 'tabulator-tables';

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

/** A row standing for one call, or for every occurrence of a merged one. */
interface OccurrenceRow {
  originalData?: { eventIndex: number };
  instances?: { eventIndex: number }[];
}

/**
 * The events a row stands for: every occurrence of a merged row, the single call
 * of a plain one, and none for a row that holds no event.
 */
export function rowOccurrences(data: OccurrenceRow | undefined): number[] {
  if (data?.instances?.length) {
    return data.instances.map((event) => event.eventIndex);
  }
  return data?.originalData ? [data.originalData.eventIndex] : [];
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
