/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { copyToClipboard } from '../core/utility/Clipboard.js';
import { goToRow } from '../features/call-tree/navigation.js';
import {
  eventName,
  formatCallStack,
  formatEventDetails,
} from '../features/call-tree/utils/eventText.js';
import { currentLogStore } from '../core/log/LogStore.js';
import { ContextMenuBuilder } from './ContextMenuBuilder.js';
import type { ContextMenuItem } from './ContextMenu.js';

/**
 * The inspector's row menu — the same actions the timeline's frame menu
 * offers, so a frame yields identical clipboard text wherever you right-click it.
 */
export const PANEL_ROW_MENU_ITEMS: ContextMenuItem[] = new ContextMenuBuilder()
  .addGroup([{ id: 'show-in-call-tree', label: 'Show in Call Tree' }])
  .addGroup([
    { id: 'copy-name', label: 'Copy Name', shortcut: ContextMenuBuilder.copyShortcut() },
    { id: 'copy-details', label: 'Copy Details' },
    { id: 'copy-call-stack', label: 'Copy Call Stack' },
  ])
  .build();

/** Runs a {@link PANEL_ROW_MENU_ITEMS} action against the right-clicked frame. */
export function runPanelRowAction(itemId: string, eventIndex: number): void {
  if (itemId === 'show-in-call-tree') {
    void goToRow({ eventIndex });
    return;
  }

  const store = currentLogStore();
  const event = store?.eventByIndex(eventIndex);
  if (!event) {
    return;
  }

  switch (itemId) {
    case 'copy-name':
      copyToClipboard(eventName(event));
      break;
    case 'copy-details':
      copyToClipboard(formatEventDetails(event, store?.log.governorLimits));
      break;
    case 'copy-call-stack':
      copyToClipboard(formatCallStack(event));
      break;
  }
}
