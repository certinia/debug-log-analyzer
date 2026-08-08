/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { RowComponent } from 'tabulator-tables';

import type { StatementType } from '../../../core/events/EventBus.js';

/** What a grid tells its parent: the picked statement, or null once cleared. */
export type GridSelectionEvent = CustomEvent<{
  type: StatementType;
  eventIndex: number | null;
}>;

/**
 * Reports a database grid's selection to `DatabaseView`, which owns the tab's
 * mutual exclusion and is the only thing that emits `detail:select`. The event
 * bubbles to that view's shadow root and no further.
 *
 * `eventIndexOf` returns undefined for a row that holds no statement, which is
 * reported as no change rather than as a clear.
 */
export function reportGridSelection<T>(
  host: HTMLElement,
  type: StatementType,
  rows: RowComponent[],
  eventIndexOf: (data: T) => number | undefined,
): void {
  const data = rows[0]?.getData() as T | undefined;
  const eventIndex = data ? eventIndexOf(data) : null;
  if (eventIndex === undefined) {
    return;
  }

  host.dispatchEvent(
    new CustomEvent('grid-selection', { detail: { type, eventIndex }, bubbles: true }),
  );
}
