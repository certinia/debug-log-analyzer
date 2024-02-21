/*
 * Copyright (c) 2022 Certinia Inc. All rights reserved.
 */
import { Module, Tabulator, type RowComponent } from 'tabulator-tables';

export class RowNavigation extends Module {
  constructor(table: Tabulator) {
    super(table);
    // @ts-expect-error registerTableFunction() needs adding to tabulator types
    this.registerTableFunction('goToRow', this.goToRow.bind(this));
  }

  goToRow(row: RowComponent) {
    if (row) {
      // @ts-expect-error table is not in types fpr Module class
      const table = this.table as Tabulator;
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

      table.scrollToRow(row, 'center', true);
    }
  }
}
