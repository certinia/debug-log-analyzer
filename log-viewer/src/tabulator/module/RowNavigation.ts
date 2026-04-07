/*
 * Copyright (c) 2022 Certinia Inc. All rights reserved.
 */
import { Module, Tabulator, type RowComponent } from 'tabulator-tables';
type GoToRowOptions = { scrollIfVisible: boolean; focusRow: boolean };
export class RowNavigation extends Module {
  static moduleName = 'rowNavigation';
  tableHolder: HTMLElement | null = null;

  constructor(table: Tabulator) {
    super(table);
    // @ts-expect-error registerTableFunction() needs adding to tabulator types
    this.registerTableFunction('goToRow', this.goToRow.bind(this));
  }

  goToRow(
    row: RowComponent,
    opts: GoToRowOptions = { scrollIfVisible: true, focusRow: true },
  ): Promise<void> {
    if (!row) {
      return Promise.resolve();
    }

    const { focusRow } = opts;

    const table = this.table;
    this.tableHolder ??= table.element.querySelector('.tabulator-tableholder') as HTMLElement;

    table.blockRedraw();

    const grp = row.getGroup();
    if (grp && !grp.isVisible()) {
      grp.show();
    }

    const rowsToExpand = [];
    //@ts-expect-error This is private to tabulator, but we have no other choice atm.
    let parent = row._getSelf().modules.dataTree ? row.getTreeParent() : false;
    while (parent) {
      if (!parent.isTreeExpanded()) {
        rowsToExpand.push(parent);
      }
      parent = parent.getTreeParent();
    }

    for (const row of rowsToExpand) {
      row.treeExpand();
    }

    for (const row of table.getSelectedRows()) {
      row.deselect();
    }

    row.select();
    table.restoreRedraw();

    if (focusRow) {
      this.tableHolder.focus();
    }

    return new Promise<void>((resolve) => {
      setTimeout(() => {
        this._scrollToRow(row, opts).then(resolve);
      });
    });
  }

  _scrollToRow(row: RowComponent, opts: GoToRowOptions): Promise<void> {
    const { scrollIfVisible, focusRow } = opts;

    return this.table
      .scrollToRow(row, 'center', scrollIfVisible)
      .catch(() => {})
      .then(() => {
        return new Promise<void>((resolve) => {
          setTimeout(() => {
            const elem = row.getElement();

            if (scrollIfVisible || !this._isVisible(elem)) {
              elem.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'start' });
            }

            if (focusRow) {
              elem.focus();
            }

            resolve();
          });
        });
      });
  }

  _isVisible(el: Element) {
    if (!this.tableHolder || !el.isConnected) {
      return false;
    }
    const holderRect = this.tableHolder.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    return rect.top >= holderRect.top && rect.bottom <= holderRect.bottom;
  }
}
