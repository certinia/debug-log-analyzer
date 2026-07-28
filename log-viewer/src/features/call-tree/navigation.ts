/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/** Document event asking the Call Tree tab to reveal a log event. */
export const CALLTREE_GO_TO_ROW = 'calltree-go-to-row';

/**
 * Reveal a log event in the main Call Tree tab: switches to the tab, forces
 * time-order and scrolls/focuses the row. Lives apart from `CalltreeView` so
 * callers (database grids, detail panel) don't pull in the whole tab module.
 */
export async function goToRow(target: { eventIndex: number }) {
  document.dispatchEvent(
    new CustomEvent(CALLTREE_GO_TO_ROW, {
      detail: target,
    }),
  );
}
