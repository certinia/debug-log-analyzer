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

/**
 * Marks the row for the frame under the pointer in the main view, so the two
 * sides of the inspector point at the same thing.
 *
 * The mark is not a selection: it only styles the row element, so nothing
 * scrolls, expands or re-sorts. A row the table has not rendered has no element
 * to mark, so it is left alone.
 *
 * The table must use {@link rowIndexStamper} to build its `rowFormatter`.
 */
export class LocatedRowMarker {
  private element: HTMLElement | null = null;

  /**
   * Move the mark to the row for `eventIndex`, or drop it when null.
   *
   * @param host - Element the table is mounted in
   * @param eventIndex - Event to mark, or null to clear
   */
  public mark(host: HTMLElement | null, eventIndex: number | null): void {
    const next =
      host && eventIndex !== null && eventIndex >= 0
        ? host.querySelector<HTMLElement>(`.tabulator-row[${ROW_INDEX_ATTRIBUTE}="${eventIndex}"]`)
        : null;
    if (next === this.element) {
      return;
    }
    this.clear();
    this.element = next;
    next?.classList.add(LOCATED_ROW_CLASS);
  }

  /** Drop the mark, if one is set. */
  public clear(): void {
    this.element?.classList.remove(LOCATED_ROW_CLASS);
    this.element = null;
  }
}
