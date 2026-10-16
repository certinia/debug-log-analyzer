/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { NavKey } from '../core/index.js';

const NAV: Readonly<Record<string, NavKey>> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  PageUp: 'pageUp',
  PageDown: 'pageDown',
  Home: 'home',
  End: 'end',
};

/**
 * What a key on the grid asks for: a move, a copy, `activate` (Enter) for the row's link or
 * toggle, `toggle` (Space), or nothing the grid answers.
 */
export function gridKey(e: KeyboardEvent): NavKey | 'copy' | 'activate' | 'toggle' | null {
  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'c') {
    // Copying a text selection in a cell is the browser's, not the grid's.
    return window.getSelection()?.type === 'Range' ? null : 'copy';
  }
  if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'Home' || e.key === 'End')) {
    return NAV[e.key] ?? null;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) {
    return null;
  }
  if (e.key === 'Enter') {
    return 'activate';
  }
  if (e.key === ' ') {
    return 'toggle';
  }
  return NAV[e.key] ?? null;
}
