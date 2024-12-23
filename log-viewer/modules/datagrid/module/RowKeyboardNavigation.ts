/*
 * Copyright (c) 2022 Certinia Inc. All rights reserved.
 */
import { KeybindingsModule, Module, Tabulator, type RowComponent } from 'tabulator-tables';

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
  static moduleName = 'rowNavigation';
  static moduleExtensions = this.getModuleExtensions();

  localTable: Tabulator;

  tableHolder: HTMLElement | null = null;
  constructor(table: Tabulator) {
    super(table);
    this.localTable = table;
    this.registerTableOption(rowNavOptionName, false);
  }

  initialize() {
    this.localTable.on('dataTreeRowExpanded', (row, _level) => {
      this.rowExpandedToggled(row, _level);
    });
    this.localTable.on('dataTreeRowCollapsed', (row, _level) => {
      this.rowExpandedToggled(row, _level);
    });
  }
  rowExpandedToggled(row: RowComponent, _level: number) {
    const table = row.getTable();
    this.tableHolder ??= table.element.querySelector('.tabulator-tableholder') as HTMLElement;

    const selectedRow = table.getSelectedRows()[0];
    if (!selectedRow) {
      row.select();
    }
    this.tableHolder?.focus();
  }

  private static getModuleExtensions() {
    return {
      keybindings: {
        actions: {
          previousRow: function (e: KeyboardEvent) {
            // @ts-expect-error see types todo
            if (!this.options(rowNavOptionName)) {
              return;
            }
            const targetElem = e.target as HTMLElement;
            if (!targetElem.classList.contains('tabulator-tableholder')) {
              return;
            }
            e.preventDefault();
            // @ts-expect-error this.table exists
            const table = this.table as Tabulator;
            const row = table.getSelectedRows()[0];
            const previousRow = row?.getPrevRow();
            if (row && previousRow) {
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
            e.preventDefault();
            // @ts-expect-error this.table exists
            const table = this.table as Tabulator;
            const row = table.getSelectedRows()[0];
            const nextRow = row?.getNextRow();
            if (row && nextRow) {
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
            // @ts-expect-error this.table exists
            const table = this.table as Tabulator;
            const row = table.getSelectedRows()[0];
            if (!row || !table.options.dataTree) {
              return;
            }
            e.preventDefault();

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
            // @ts-expect-error this.table exists
            const table = this.table as Tabulator;
            const row = table.getSelectedRows()[0];
            if (!row || !table.options.dataTree) {
              return;
            }
            e.preventDefault();

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
        },
        bindings: {
          previousRow: '38',
          nextRow: '40',
          expandRow: '39',
          collapseRow: '37',
        },
      },
    };
  }
}

Tabulator.registerModule(KeybindingsModule);
