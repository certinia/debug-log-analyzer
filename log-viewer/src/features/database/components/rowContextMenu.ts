/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { RowComponent, Tabulator } from 'tabulator-tables';

import type { ContextMenu } from '../../../components/ContextMenu.js';
import { ContextMenuBuilder } from '../../../components/ContextMenuBuilder.js';

/** The statement grids' row menu. Ids here must not collide with the column
 *  menu's, whose ids are all prefixed (`view:`/`col:`/`reset:`) — the grids
 *  share one `<context-menu>` element for both. */
const ROW_MENU_ITEMS = new ContextMenuBuilder()
  .addGroup([{ id: 'show-in-call-tree', label: 'Show in Call Tree' }])
  .build();

/**
 * Opens the row right-click menu for a DML/SOQL/SOSL grid and returns the
 * row's `eventIndex` for the action handler, or `null` when no menu was shown
 * (a text selection is in progress, or the row has no underlying event).
 *
 * Shared by all three grids so the selection behaviour stays identical: the
 * right-clicked row becomes the only selected row, matching what a left click
 * does via `RowKeyboardNavigation`, so the inspector follows it.
 */
export function showStatementRowMenu(
  event: MouseEvent,
  row: RowComponent,
  table: Tabulator | null,
  menu: ContextMenu | null,
): number | null {
  if (!menu || window.getSelection()?.type === 'Range') {
    return null;
  }
  event.preventDefault();

  for (const selected of table?.getSelectedRows() ?? []) {
    selected.deselect();
  }
  row.select();

  const { eventIndex } = row.getData() as { eventIndex?: number };
  if (eventIndex === undefined) {
    return null;
  }

  menu.show(ROW_MENU_ITEMS, event.clientX, event.clientY);
  return eventIndex;
}
