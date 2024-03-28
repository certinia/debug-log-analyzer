/*
 * Copyright (c) 2022 Certinia Inc. All rights reserved.
 */
import { Module, Tabulator, type RowComponent } from 'tabulator-tables';

export class RowNavigation extends Module {
  static moduleName = 'rowNavigation';

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

      table.scrollToRow(row, 'center', true).then(() => {
        if (row) {
          // row.getElement().scrollIntoView

          // NOTE: This is a workaround for the fact that `row.scrollTo('center'` does not work correctly for ros near the bottom.
          // This needs fixing in main tabulator lib
          window.requestAnimationFrame(() => {
            // table.scrollToRow(row, 'center', true);
            const elem = row.getElement();
            elem.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'start' });
            elem.focus();
          });
        }
      });
    }
  }
}
