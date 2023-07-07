import { KeybindingsModule, Module, Tabulator } from 'tabulator-tables';

// todo: work out how to self register so the imprt alone will handle things.
// todo: work out how to disable + enable on individual tables
//todo: make this generic and support opening grouped rows too then use on DB view.
/**
 * Enable RowNavigation by importing the class and calling
 * Tabulator.registerModule(RowNavigation); before the first instantiation of the table.
 * To disable RowNavigation set rowNavigation to false in table options.
 * To disbale individual key binings set previousRow, nextRow,expandRow, collapseRow to false
 * in keybings e.g  keybindings: { previousRow: false },
 */
export class RowNavigation extends Module {
  constructor(table: Tabulator) {
    super(table);
  }

  initialize() {
    console.debug('e', this.keyRowNavigation, this.table.options.keyRowNavigation);
    const localTable = this.table as Tabulator;
    const keyRowNavigation = localTable.options.keyRowNavigation;
    if (keyRowNavigation !== false) {
      Tabulator.registerModule(KeybindingsModule);
      Tabulator.extendModule(KeybindingsModule.moduleName, 'actions', rowNavActions);
      Tabulator.extendModule(KeybindingsModule.moduleName, 'bindings', bindings);

      localTable.element.addEventListener(
        'keydown',
        function (e) {
          const targetElem = e.target as HTMLElement;
          if (
            targetElem.classList.contains('tabulator-tableholder') &&
            ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Space'].indexOf(e.key) > -1
          ) {
            e.preventDefault();
          }
        },
        false
      );
    }
  }
}

RowNavigation.moduleName = 'rowNavigation';
RowNavigation.moduleInitOrder = -1;

export const rowNavActions: { [key: string]: unknown } = {
  previousRow: function () {
    const table = this.table as Tabulator;
    const row = table.getSelectedRows()[0];
    const previousRow = row?.getPrevRow();
    if (previousRow) {
      table.blockRedraw();
      row.deselect();
      previousRow.select();
      table.restoreRedraw();
      previousRow.getElement().scrollIntoView({ block: 'nearest' });
    }
  },
  nextRow: function () {
    const table = this.table as Tabulator;
    const row = table.getSelectedRows()[0];
    const nextRow = row?.getNextRow();
    console.debug('next row', row, nextRow);
    if (nextRow) {
      table.blockRedraw();
      row.deselect();
      nextRow.select();
      table.restoreRedraw();
      nextRow.getElement().scrollIntoView({ block: 'nearest' });
    }
  },
  expandRow: function () {
    const table = this.table as Tabulator;
    const row = table.getSelectedRows()[0];
    if (!row) {
      return;
    }

    if (row.isTreeExpanded()) {
      const nextRow = row?.getNextRow();
      if (nextRow && nextRow.getTreeParent() === row) {
        table.blockRedraw();
        row.deselect();
        nextRow.select();
        table.restoreRedraw();
        nextRow.getElement().scrollIntoView({ block: 'nearest' });
      }
    } else {
      row.treeExpand();
    }
  },
  collapseRow: function () {
    const table = this.table as Tabulator;
    const row = table.getSelectedRows()[0];
    if (!row) {
      return;
    }

    if (!row.isTreeExpanded()) {
      const prevRow = row?.getTreeParent();
      if (prevRow) {
        table.blockRedraw();
        row.deselect();
        prevRow.select();
        table.restoreRedraw();
        prevRow.getElement().scrollIntoView({ block: 'nearest' });
      }
    } else {
      row.treeCollapse();
    }
  },
};
export const bindings = {
  previousRow: '38',
  nextRow: '40',
  expandRow: '39',
  collapseRow: '37',
};
