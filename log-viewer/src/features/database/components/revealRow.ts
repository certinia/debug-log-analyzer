/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { Tabulator } from 'tabulator-tables';

/** The part of a database grid row that traces back to the log event it was built from. */
interface EventRow {
  eventIndex?: number;
}

/**
 * Select the row for `eventIndex`. Returns false when the grid has no such row.
 *
 * Shared by the DML, SOQL and SOSL grids: the inspector offers an eventIndex to
 * each in turn, and only the grid that owns it selects. `DatabaseView` runs the
 * call under its echo guard, so the selection is not reported back at the
 * inspector that asked for it.
 */
export function selectRowByEventIndex(table: Tabulator | null, eventIndex: number): boolean {
  // The tabulator index is a synthetic row id, so the eventIndex is scanned for.
  const match = table
    ?.getRows()
    .find((candidate) => (candidate.getData() as EventRow).eventIndex === eventIndex);
  if (!table || !match) {
    return false;
  }

  table.deselectRow();
  match.select();
  return true;
}
