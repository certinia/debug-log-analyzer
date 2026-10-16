/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { NavKey } from '../core/index.js';

const NAV: Readonly<Record<string, NavKey>> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Home: 'home',
  End: 'end',
};

/** What a key on the grid asks for: a move, a copy, or nothing the grid answers. */
export function gridKey(e: KeyboardEvent): NavKey | 'copy' | null {
  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'c') {
    // Copying a text selection in a cell is the browser's, not the grid's.
    return window.getSelection()?.type === 'Range' ? null : 'copy';
  }
  if (e.ctrlKey || e.metaKey || e.altKey) {
    return null;
  }
  return NAV[e.key] ?? null;
}
