/*
 * Copyright (c) 2022 Certinia Inc. All rights reserved.
 */
import {
  KeybindingsModule,
  Module,
  SelectRowModule,
  Tabulator,
  type RowComponent,
} from 'tabulator-tables';

import { isCodeDrivenExpand, withCodeDrivenExpand } from './expandOrigin.js';
import { tableHolder } from './tableHolder.js';

// todo: make this generic and support opening grouped rows too then use on DB view.

const rowNavOptionName = 'rowKeyboardNavigation' as const;

/**
 * The table a key is for, or null where the key is not this module's to answer.
 *
 * Only from the body, which is what holds the selection the keys move. Tabulator
 * binds them on the table's root, and the tree control has a `tabIndex` of its
 * own, so a key can arrive from a control belonging to a row other than the
 * selected one.
 */
function keyedTable(module: Module, e: KeyboardEvent): Tabulator | null {
  const table = module.table;
  if (!table.options[rowNavOptionName]) {
    return null;
  }
  return e.target === tableHolder(table.element) ? table : null;
}

/** A binding that moves the selection one row, whichever way `pick` steps. */
function siblingAction(pick: (row: RowComponent) => RowComponent | false) {
  return function (this: Module, e: KeyboardEvent) {
    const table = keyedTable(this, e);
    if (!table) {
      return;
    }
    e.preventDefault();
    const row = table.getSelectedRows()[0];
    const target = row && pick(row);
    if (row && target) {
      moveSelection(row, target);
    }
  };
}

/**
 * Move the selection from one row to another, and keep it in view.
 *
 * No redraw block around it, here or on a click: selecting a row only sets a
 * class, while restoring a blocked redraw re-aligns and re-renders every column
 * header.
 */
function moveSelection(from: RowComponent, to: RowComponent): void {
  from.deselect();
  to.select();
  to.getElement().scrollIntoView({ block: 'nearest' });
}

declare module 'tabulator-tables' {
  interface Options {
    /** Enable this module's key bindings on the table (registered below). */
    rowKeyboardNavigation?: boolean;
  }
}

/**
 * Arrow-key travel over a table's rows: up and down move the selection, right
 * and left open and close a tree row, and step into and out of it.
 *
 * Register the module before the first table is built, and set
 * `rowKeyboardNavigation` on the tables that want it. A single binding is
 * dropped through Tabulator's own `keybindings` option, e.g.
 * `keybindings: { previousRow: false }`.
 */
export class RowKeyboardNavigation extends Module {
  static moduleName = 'rowKeyboardNavigation';
  static moduleExtensions = this.getModuleExtensions();

  private localTable: Tabulator;

  constructor(table: Tabulator) {
    super(table);
    this.localTable = table;
    this.registerTableOption(rowNavOptionName, false);
  }

  initialize() {
    this.setOption('selectableRows', 'highlight');
    this.localTable.on('dataTreeRowExpanded', (row: RowComponent) => {
      this.rowExpanded(row);
    });
    this.localTable.on('dataTreeRowCollapsed', () => {
      this.rowCollapsed();
    });
    this.localTable.on('rowClick', (event, row) => {
      this.rowClick(event, row);
    });
  }

  /** The user's first expansion gives the keyboard a row to move from. */
  rowExpanded(row: RowComponent) {
    if (isCodeDrivenExpand()) {
      return;
    }
    if (!this.localTable.getSelectedRows().length) {
      row.select();
    }
    this.takeFocusBack();
  }

  /** A collapse hands focus back and nothing else: selecting the row the user
   *  just closed would re-scope the inspector to it. */
  rowCollapsed() {
    if (!isCodeDrivenExpand()) {
      this.takeFocusBack();
    }
  }

  /**
   * Working the tree control leaves focus on the control, which the next render
   * can take away with the row. Focus is put back on the body, which the table
   * keeps, so the keys keep arriving.
   */
  private takeFocusBack(): void {
    tableHolder(this.localTable.element)?.focus({ preventScroll: true });
  }

  rowClick(event: UIEvent, row: RowComponent) {
    const { type } = window.getSelection() ?? {};
    if (type === 'Range') {
      return;
    }
    for (const row of this.localTable.getSelectedRows()) {
      row.deselect();
    }
    row.toggleSelect();
  }

  private static getModuleExtensions() {
    return {
      keybindings: {
        actions: {
          previousRow: siblingAction((row) => row.getPrevRow()),
          nextRow: siblingAction((row) => row.getNextRow()),
          expandRow: function (this: Module, e: KeyboardEvent) {
            const table = keyedTable(this, e);
            const row = table?.getSelectedRows()[0];
            if (!table || !row || !table.options.dataTree) {
              return;
            }
            e.preventDefault();

            if (row.isTreeExpanded()) {
              const nextRow = row.getNextRow();
              if (nextRow && nextRow.getTreeParent() === row) {
                moveSelection(row, nextRow);
              }
            } else {
              // Declared as the code's own, so the expand does not read as the
              // user reaching for the tree control.
              withCodeDrivenExpand(() => row.treeExpand());
            }
          },
          collapseRow: function (this: Module, e: KeyboardEvent) {
            const table = keyedTable(this, e);
            const row = table?.getSelectedRows()[0];
            if (!table || !row || !table.options.dataTree) {
              return;
            }
            e.preventDefault();

            if (!row.isTreeExpanded()) {
              const parentRow = row.getTreeParent();
              if (parentRow) {
                moveSelection(row, parentRow);
              }
            } else {
              // The code's own, as `expandRow`'s is.
              withCodeDrivenExpand(() => row.treeCollapse());
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

Tabulator.registerModule([KeybindingsModule, SelectRowModule]);
