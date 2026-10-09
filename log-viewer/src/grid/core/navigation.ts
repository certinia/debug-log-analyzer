/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { RowView } from './store.js';

export type NavKey = 'up' | 'down' | 'left' | 'right' | 'home' | 'end';

/** What a key asks for. The caller selects, expands or collapses the row at `index`. */
export type NavIntent =
  | { kind: 'select'; index: number }
  | { kind: 'expand'; index: number }
  | { kind: 'collapse'; index: number };

/**
 * The model change a key asks for, from the selected row at `index`. Right opens a
 * closed row and steps into an open one; left closes an open row and steps out of a
 * closed one, to its parent row or group. Null when the key does nothing there, or when
 * no row is selected.
 */
export function navigate<R>(rows: RowView<R>, index: number, key: NavKey): NavIntent | null {
  if (index < 0 || index >= rows.size) {
    return null;
  }
  switch (key) {
    case 'up':
      return index > 0 ? { kind: 'select', index: index - 1 } : null;
    case 'down':
      return index < rows.size - 1 ? { kind: 'select', index: index + 1 } : null;
    case 'home':
      return index > 0 ? { kind: 'select', index: 0 } : null;
    case 'end':
      return index < rows.size - 1 ? { kind: 'select', index: rows.size - 1 } : null;
    case 'right':
      if (!rows.hasChildrenAt(index)) {
        return null;
      }
      return rows.isExpandedAt(index)
        ? { kind: 'select', index: index + 1 }
        : { kind: 'expand', index };
    case 'left': {
      if (rows.isExpandedAt(index)) {
        return { kind: 'collapse', index };
      }
      const depth = rows.depthAt(index);
      for (let i = index - 1; i >= 0; i--) {
        if (rows.depthAt(i) < depth) {
          return { kind: 'select', index: i };
        }
      }
      return null;
    }
  }
}
