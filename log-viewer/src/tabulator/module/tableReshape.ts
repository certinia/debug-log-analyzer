/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { SorterFromTable, Tabulator } from 'tabulator-tables';

/** Whether `sorters` is the order already recorded in `fields` and `dirs`. */
function unchanged(
  sorters: readonly SorterFromTable[],
  fields: readonly string[],
  dirs: readonly string[],
): boolean {
  if (sorters.length !== fields.length) {
    return false;
  }
  for (let i = 0; i < sorters.length; i++) {
    if (sorters[i]!.field !== fields[i] || sorters[i]!.dir !== dirs[i]) {
      return false;
    }
  }
  return true;
}

/**
 * Call `changed` when `table` reshapes under the user: the rows come back in a
 * different order, or a different set of columns is on show.
 *
 * A sort event does not say the order changed: expanding or collapsing a tree row
 * orders that row's children through the same `Sort.sort` call, so the event fires
 * once per opened subtree carrying the order the table already had. The order
 * itself is what is compared, and compared without allocating, because an expand
 * of a large tree fires this per subtree.
 *
 * Read from `dataSorting` rather than `dataSorted`: both fire from that one call
 * with the same sorters, but a `dataSorted` subscriber makes Tabulator build a row
 * component for every row it sorted, and those are cached on the rows.
 *
 * Tabulator's own `sort-changed` is truthful about a sort but reaches modules only,
 * and fires for any `setSort` call, including one re-applying the order in force.
 *
 * Grouping is not here: `dataGrouped` fires only while the table is grouped, so
 * turning grouping off reports nothing. The caller asks for the grouping it wants,
 * so it knows both ways round.
 */
export function onTableReshaped(table: Tabulator, changed: () => void): void {
  const fields: string[] = [];
  const dirs: string[] = [];
  table.on('dataSorting', (sorters) => {
    if (unchanged(sorters, fields, dirs)) {
      return;
    }
    fields.length = 0;
    dirs.length = 0;
    for (const sorter of sorters) {
      fields.push(sorter.field);
      dirs.push(sorter.dir);
    }
    changed();
  });
  table.on('columnVisibilityChanged', () => {
    changed();
  });
}
