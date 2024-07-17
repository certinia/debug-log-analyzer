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

  goToRow(row: RowComponent, opts: GoToRowOptions = { scrollIfVisible: true, focusRow: true }) {
    if (row) {
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

      rowsToExpand.forEach((row) => {
        row.treeExpand();
      });

      table.getSelectedRows().forEach((rowToDeselect) => {
        rowToDeselect.deselect();
      });
      row.select();
      table.restoreRedraw();

      focusRow && this.tableHolder.focus();
      row && setTimeout(() => this._scrollToRow(row, opts));
    }
  }

  _scrollToRow(row: RowComponent, opts: GoToRowOptions) {
    const { scrollIfVisible, focusRow } = opts;

    this.table.scrollToRow(row, 'center', scrollIfVisible).then(() => {
      setTimeout(() => {
        const elem = row.getElement();

        if (scrollIfVisible || !this._isVisible(elem)) {
          // NOTE: work around because this.table.scrollToRow does not work correctly when the row is near the very bottom of the grid.
          elem.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'start' });
        }

        focusRow && elem.focus();
      });
    });
  }

  _isVisible(el: Element) {
    const rect = el.getBoundingClientRect();
    return rect.top >= 0 && rect.bottom <= window.innerHeight;
  }
}
