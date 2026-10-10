/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { Tabulator } from 'tabulator-tables';

import type { GridHeaderContextDetail, LvGrid } from '../grid/index.js';
import {
  gridColumnTarget,
  type ColumnSettingsController,
  type Target,
} from './ColumnSettingsController.js';
import type { ContextMenu } from './ContextMenu.js';

export interface GridColumnMenuOptions {
  /** The grid the menu acts on, read late: the table is built after the host connects. */
  table: () => Target | null;
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

  /** Applies the view on show and wires the header's right-click, once the table is built. */
  initTable(table: Tabulator): void {
    this._options.columns.applyTo(table);
    const header = table.element.querySelector<HTMLElement>('.tabulator-header');
    header?.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      this.showAt(event.clientX, event.clientY);
    });
  }

  /** {@link initTable} for an lv-grid, whose header reports its right-click. */
  initGrid<R extends object>(grid: LvGrid<R>): void {
    // The host's target, not the grid: a host that binds its columns would have them set back.
    this._options.columns.applyTo(this._options.table() ?? gridColumnTarget(grid));
    grid.addEventListener('lv-grid-header-context', (e) => {
      const { event } = (e as CustomEvent<GridHeaderContextDetail>).detail;
      event.preventDefault();
      this.showAt(event.clientX, event.clientY);
    });
  }

  /** `click` on the toolbar's Columns button, which opens under it. */
  open = (event: Event): void => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.showAt(rect.left, rect.bottom);
  };

  showAt(x: number, y: number): void {
    const table = this._options.table();
    const menu = this._options.menu();
    if (!menu || !table) {
      return;
    }
    menu.show(this._options.columns.menuItems(table), x, y);
  }

  /**
   * Acts on a `view:`, `col:` or `reset:` item and says whether it did, leaving
   * anything else to the host — the database grids add their own row items.
   */
  select(itemId: string): boolean {
    const table = this._options.table();
    if (!table) {
      return false;
    }

    if (itemId.startsWith('view:')) {
      this._options.columns.choose(itemId.slice('view:'.length));
    } else if (itemId.startsWith('col:')) {
      this._options.columns.toggle(table, itemId.slice('col:'.length));
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
    const table = this._options.table();
    const menu = this._options.menu();
    if (!menu?.isVisible() || !table) {
      return;
    }
    menu.items = this._options.columns.menuItems(table);
  }
}
