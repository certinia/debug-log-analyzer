/*
 * Copyright (c) 2022 Certinia Inc. All rights reserved.
 */
import { Module, Tabulator, type RowComponent } from 'tabulator-tables';

export class RowNavigation extends Module {
  static moduleName = 'rowNavigation';
  tableHolder: HTMLElement | null = null;

  constructor(table: Tabulator) {
    super(table);
    // @ts-expect-error registerTableFunction() needs adding to tabulator types
    this.registerTableFunction('goToRow', this.goToRow.bind(this));
  }

  goToRow(row: RowComponent) {
    if (row) {
      const table = this.table;
      this.tableHolder ??= table.element.querySelector('.tabulator-tableholder') as HTMLElement;
      this.tableHolder.focus();

      table.blockRedraw();
      const rowsToExpand = [];
      let parent = row.getTreeParent();
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
      row && setTimeout(() => this._scrollToRow(row));
    }
  }

  _scrollToRow(row: RowComponent) {
    this.table.scrollToRow(row, 'center', true).then(() => {
      const elem = row.getElement();
      elem.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'start' });
      elem.focus();
    });
  }
}
