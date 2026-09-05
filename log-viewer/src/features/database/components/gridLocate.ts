/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { Tabulator } from 'tabulator-tables';

import { rowIndexStamper } from '../../../components/locatedRow.js';

/** What a grid tells its parent: the statements under the pointer, or none. */
export type GridLocateEvent = CustomEvent<{ eventIndexes: readonly number[] }>;

/** Lets the inspector's mark find a database row by one DOM query. */
export const stampGridEventIndex = rowIndexStamper('eventIndex');

/**
 * Reports the row under the pointer to `DatabaseView`, which owns the tab's
 * traffic with the inspector and is the only thing that emits `detail:locate`.
 * The event bubbles to that view's shadow root and no further. Nothing is
 * picked: the pointer only marks.
 *
 * `eventIndexOf` returns undefined for a row that holds no statement, which is
 * reported as nothing under the pointer.
 */
export function reportGridLocate<T>(
  host: HTMLElement,
  table: Tabulator,
  eventIndexOf: (data: T) => number | undefined,
): void {
  const dispatch = (eventIndexes: readonly number[]): void => {
    host.dispatchEvent(new CustomEvent('grid-locate', { detail: { eventIndexes }, bubbles: true }));
  };
  table.on('rowMouseEnter', (_e, row) => {
    const eventIndex = eventIndexOf(row.getData() as T);
    dispatch(eventIndex === undefined ? [] : [eventIndex]);
  });
  table.on('rowMouseLeave', () => {
    dispatch([]);
  });
}
