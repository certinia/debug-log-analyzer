/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { GridHeaderContextDetail } from '../grid/index.js';
import type { ColumnSettingsController, ColumnTarget } from './ColumnSettingsController.js';
import type { ContextMenu } from './ContextMenu.js';

export interface GridColumnMenuOptions {
  /** The grid's columns the menu acts on. */
  target: ColumnTarget;
  /** The host's `<context-menu>`, looked up per use so no first-update hook is needed. */
  menu: () => ContextMenu | null;
  /** The column state the menu shows and edits. */
  columns: ColumnSettingsController;
}

/**
 * Drives one grid's column menu: the `Columns` select, the same list again on
 * the header's right-click and on the toolbar button, and the view, column and
 * reset items all three raise.
 *
 * The handlers are arrow fields so a template can bind them straight, where a
 * plain method would arrive with the host as `this`.
 *
 * CalltreeView is deliberately not on this. It drives three tables, so it has
 * to remember which one an open menu belongs to and drop that on close — a
 * concept the four single-table grids never need, and the reason its menu code
 * reads differently rather than badly.
 */
export class GridColumnMenuController {
  private readonly _options: GridColumnMenuOptions;

  constructor(options: GridColumnMenuOptions) {
    this._options = options;
  }

  /** `change` on the column-view select. */
  chooseView = (event: Event): void => {
    this._options.columns.choose((event.target as HTMLInputElement).value || 'General');
  };

  /** `vs-reset-option` on the column-view select. */
  resetView = (event: CustomEvent<{ value: string }>): void => {
    this._options.columns.reset(event.detail.value);
  };

  /** `lv-grid-header-context` on an lv-grid: the header's right-click. */
  headerContext = (e: Event): void => {
    const { event } = (e as CustomEvent<GridHeaderContextDetail>).detail;
    event.preventDefault();
    this.showAt(event.clientX, event.clientY);
  };

  /** `click` on the toolbar's Columns button, which opens under it. */
  open = (event: Event): void => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.showAt(rect.left, rect.bottom);
  };

  showAt(x: number, y: number): void {
    this._options.menu()?.show(this._options.columns.menuItems(this._options.target), x, y);
  }

  /**
   * Acts on a `view:`, `col:` or `reset:` item and says whether it did, leaving
   * anything else to the host — the database grids add their own row items.
   */
  select(itemId: string): boolean {
    if (itemId.startsWith('view:')) {
      this._options.columns.choose(itemId.slice('view:'.length));
    } else if (itemId.startsWith('col:')) {
      this._options.columns.toggle(this._options.target, itemId.slice('col:'.length));
    } else if (itemId.startsWith('reset:')) {
      this._options.columns.reset(itemId.slice('reset:'.length));
    } else {
      return false;
    }

    this._refresh();
    return true;
  }

  /** Rebuilds an open menu so its checkmarks and reset icons follow the state. */
  private _refresh(): void {
    const menu = this._options.menu();
    if (menu?.isVisible()) {
      menu.items = this._options.columns.menuItems(this._options.target);
    }
  }
}
