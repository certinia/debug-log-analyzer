import { Module, RowComponent, Tabulator } from 'tabulator-tables';

export class RowNavigation extends Module {
  constructor(table: Tabulator) {
    super(table);
    // @ts-expect-error registerTableFunction() needs adding to tabulator types
    this.registerTableFunction('goToRow', this.goToRow.bind(this));
  }

  goToRow(row: RowComponent) {
    if (row) {
      const rowsToExpand = [];
      let parent = row.getTreeParent();
      while (parent) {
        if (!parent.isTreeExpanded()) {
          rowsToExpand.push(parent);
        }
        parent = parent.getTreeParent();
      }

      // @ts-expect-error table is not in types fpr Module class
      const table = this.table as Tabulator;
      table.blockRedraw();
      const len = rowsToExpand.length;
      for (let i = 0; i < len; i++) {
        const row = rowsToExpand[i];
        row.treeExpand();
      }

      table.getSelectedRows().map((rowToDeselect) => {
        rowToDeselect.deselect();
      });
      table.restoreRedraw();
      row.select();

      // @ts-expect-error it has 2 params
      row.scrollTo('center', true).then(() => {
        //NOTE: This is a workaround for the fact that `row.scrollTo('center'` does not work correctly for ros near the bottom.
        // This needs fixing in main tabulator lib
        row.getElement().scrollIntoView({ behavior: 'auto', block: 'center', inline: 'start' });
      });
    }
  }
}
