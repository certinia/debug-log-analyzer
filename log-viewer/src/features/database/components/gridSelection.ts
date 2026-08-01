/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { RowComponent } from 'tabulator-tables';

import { eventBus, type StatementType } from '../../../core/events/EventBus.js';
import type { SelectionEchoGuard } from '../../../core/events/SelectionEchoGuard.js';

/**
 * Reports a database grid's selection to the inspector: the picked row, or
 * null once the grid is cleared, so the inspector stops showing the row the
 * user just deselected.
 *
 * Emits nothing while `guard` suppresses - that clear came from the inspector,
 * or from `DatabaseView` clearing the two grids the pick did not land in, and
 * its null would arrive after the pick and undo it.
 *
 * `eventIndexOf` returns undefined for a row that holds no statement, which is
 * reported as no change rather than as a clear.
 */
export function emitGridSelection<T>(
  guard: SelectionEchoGuard,
  type: StatementType,
  rows: RowComponent[],
  eventIndexOf: (data: T) => number | undefined,
): void {
  if (guard.suppressed) {
    return;
  }

  const data = rows[0]?.getData() as T | undefined;
  if (!data) {
    eventBus.emit('detail:select', { source: 'database', selection: null });
    return;
  }

  const eventIndex = eventIndexOf(data);
  if (eventIndex === undefined) {
    return;
  }

  eventBus.emit('detail:select', {
    source: 'database',
    selection: { kind: 'event', eventIndex, type },
  });
}
