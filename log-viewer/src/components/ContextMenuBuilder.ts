/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

/**
 * ContextMenuBuilder - Builder pattern for constructing context menus
 *
 * Simplifies context menu construction with:
 * - Grouped actions with automatic separators
 * - Platform-aware keyboard shortcuts
 *
 * Usage:
 * ```typescript
 * const items = new ContextMenuBuilder()
 *   .addGroup([
 *     { id: 'zoom-to-frame', label: 'Zoom to Frame', shortcut: 'Z' }
 *   ])
 *   .addGroup([
 *     { id: 'show-in-call-tree', label: 'Show in Call Tree', shortcut: 'J' },
 *     { id: 'go-to-source', label: 'Go to Source' }
 *   ])
 *   .addGroup([
 *     { id: 'copy-name', label: 'Copy Name', shortcut: ContextMenuBuilder.copyShortcut() }
 *   ])
 *   .build();
 * ```
 */

import type { ContextMenuItem } from './ContextMenu.js';

export interface ContextMenuAction {
  /** Unique identifier for the action */
  id: string;
  /** Display label */
  label: string;
  /** Optional keyboard shortcut hint (display only) */
  shortcut?: string;
  /** If true, the item is grayed out and not clickable */
  disabled?: boolean;
}

export class ContextMenuBuilder {
  private groups: ContextMenuAction[][] = [];

  /**
   * Add a group of actions. Groups are separated by dividers.
   */
  addGroup(actions: ContextMenuAction[]): this {
    if (actions.length > 0) {
      this.groups.push(actions);
    }
    return this;
  }

  /**
   * Add a single action to a new group.
   */
  addAction(action: ContextMenuAction): this {
    this.groups.push([action]);
    return this;
  }

  /**
   * Build the final menu items array with separators between groups.
   */
  build(): ContextMenuItem[] {
    const items: ContextMenuItem[] = [];

    // Add user-defined groups
    for (let i = 0; i < this.groups.length; i++) {
      const group = this.groups[i];
      if (!group) continue;

      // Add separator before group (except first group)
      if (i > 0) {
        items.push({ id: `separator-${i}`, label: '', separator: true });
      }

      // Add actions in group
      for (const action of group) {
        items.push({
          id: action.id,
          label: action.label,
          shortcut: action.shortcut,
          disabled: action.disabled,
        });
      }
    }

    return items;
  }

  // ============================================================================
  // STATIC HELPERS
  // ============================================================================

  /**
   * Check if running on Mac platform.
   */
  static isMac(): boolean {
    return /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent);
  }

  /**
   * Get platform-specific copy shortcut.
   */
  static copyShortcut(): string {
    return ContextMenuBuilder.isMac() ? '\u2318C' : 'Ctrl+C';
  }
}
