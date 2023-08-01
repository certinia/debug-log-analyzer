import { KeybindingsModule, Module, Tabulator } from 'tabulator-tables';

// todo: make this generic and support opening grouped rows too then use on DB view.
// todo: remove the '@ts-expect-error' + fix the types file

const rowNavOptionName = 'rowKeyboardNavigation' as const;
/**
 * Enable RowNavigation by importing the class and calling
 * Tabulator.registerModule(RowNavigation); before the first instantiation of the table.
 * To disable RowNavigation set rowNavigation to false in table options.
 * To disbale individual key binings set previousRow, nextRow,expandRow, collapseRow to false
 * in keybings e.g  keybindings: { previousRow: false },
 */
export class RowKeyboardNavigation extends Module {
  localTable: Tabulator;
  constructor(table: Tabulator) {
    super(table);
    this.localTable = table;
    // @ts-expect-error registerTableOption() needs adding to tabulator types
    this.registerTableOption(rowNavOptionName, false);
  }

  initialize() {
    // @ts-expect-error options() needs adding to tabulator types
    if (this.options(rowNavOptionName)) {
      this.localTable.element.addEventListener(
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

const rowNavActions: { [key: string]: unknown } = {
  previousRow: function (e: KeyboardEvent) {
    // @ts-expect-error see types todo
    if (!this.options(rowNavOptionName)) {
      return;
    }
    const targetElem = e.target as HTMLElement;
    if (!targetElem.classList.contains('tabulator-tableholder')) {
      return;
    }

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
  nextRow: function (e: KeyboardEvent) {
    // @ts-expect-error see types todo
    if (!this.options(rowNavOptionName)) {
      return;
    }
    const targetElem = e.target as HTMLElement;
    if (!targetElem.classList.contains('tabulator-tableholder')) {
      return;
    }

    const table = this.table as Tabulator;
    const row = table.getSelectedRows()[0];
    const nextRow = row?.getNextRow();
    if (nextRow) {
      table.blockRedraw();
      row.deselect();
      nextRow.select();
      table.restoreRedraw();
      nextRow.getElement().scrollIntoView({ block: 'nearest' });
    }
  },
  expandRow: function (e: KeyboardEvent) {
    // @ts-expect-error see types todo
    if (!this.options(rowNavOptionName)) {
      return;
    }
    const targetElem = e.target as HTMLElement;
    if (!targetElem.classList.contains('tabulator-tableholder')) {
      return;
    }

    const table = this.table as Tabulator;
    const row = table.getSelectedRows()[0];
    if (!row || !table.options.dataTree) {
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
  collapseRow: function (e: KeyboardEvent) {
    // @ts-expect-error see types todo
    if (!this.options(rowNavOptionName)) {
      return;
    }
    const targetElem = e.target as HTMLElement;
    if (!targetElem.classList.contains('tabulator-tableholder')) {
      return;
    }

    const table = this.table as Tabulator;
    const row = table.getSelectedRows()[0];
    if (!row || !table.options.dataTree) {
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
const bindings = {
  previousRow: '38',
  nextRow: '40',
  expandRow: '39',
  collapseRow: '37',
};
RowKeyboardNavigation.moduleName = 'rowNavigation';
Tabulator.registerModule(KeybindingsModule);
// @ts-expect-error moduleName needs adding to tabulator types
Tabulator.extendModule(KeybindingsModule.moduleName, 'actions', rowNavActions);
// @ts-expect-error moduleName needs adding to tabulator types
Tabulator.extendModule(KeybindingsModule.moduleName, 'bindings', bindings);
