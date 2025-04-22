import { Module, type ColumnComponent, type GroupArg, type Tabulator } from 'tabulator-tables';

export class GroupSort extends Module {
  static moduleName = 'groupSort';

  constructor(table: Tabulator) {
    super(table);
    this.registerTableOption('groupSort', false);
    this.registerTableFunction('setSortedGroupBy', this._setSortedGroupBy.bind(this));
  }

  initialize() {
    // @ts-expect-error groupSort is a custom propoerty see registerTableOption above
    if (this.table.options.groupSort) {
      this.subscribe('sort-changed', this._sortGroups.bind(this));
    }
  }

  _setSortedGroupBy(...args: unknown[]) {
    const grpArg = args[0] as GroupArg;
    const grpArray = Array.isArray(grpArg) ? grpArg : [grpArg];
    const oldGrpArg = this.table.options.groupBy as GroupArg;
    const oldGrpArray = Array.isArray(oldGrpArg) ? oldGrpArg : [oldGrpArg];
    if (!this._areGroupsEqual(oldGrpArray, grpArray)) {
      this.table.options.groupBy = grpArg;
      this.table.blockRedraw();
      this._sortGroups();
      this.table.setGroupBy(grpArg);
      this.table.restoreRedraw();
    }
  }

  _sortGroups() {
    const grpArray = Array.isArray(this.table.options.groupBy)
      ? this.table.options.groupBy
      : [this.table.options.groupBy];
    const { options } = this.table;

    const validGrps = grpArray.filter(Boolean).length > 0;
    if (this.table && options.sortMode !== 'remote' && validGrps) {
      let groupFunc = grpArray[0];
      const grpField = groupFunc as string;
      if (typeof groupFunc === 'string') {
        groupFunc = function (data) {
          return data[grpField];
        };
      }

      const groupsByKey: { [key: string]: unknown[] } = {};
      if (groupFunc) {
        const rows = this.table.rowManager.rows;
        rows.forEach((row: InternalColumnTotal) => {
          const grpVal = groupFunc(row.data);
          let groupRows = groupsByKey[grpVal];
          if (!groupRows) {
            groupRows = [];
            groupsByKey[grpVal] = groupRows;
          }
          groupRows.push(row);
        });
      }

      let groupTotalsRows: InternalColumnTotal[] = [];
      const columnCalcs = this.table.modules.columnCalcs;
      const field = columnCalcs.botCalcs[0].field;
      for (const [key, rows] of Object.entries(groupsByKey)) {
        const row = columnCalcs.generateBottomRow(rows);
        row.data[field] = key;
        row.key = key;
        row.rows = rows;
        row.generateCells();
        groupTotalsRows.push(row);
      }

      groupTotalsRows = this._sortGroupTotals(groupTotalsRows);
      const groupValues: string[] = [];
      groupTotalsRows.forEach((colTotals) => {
        groupValues.push(colTotals.data[field] as string);
      });

      const originalGroupVals = (options.groupValues ?? [[]])[0] ?? [];
      if (!this._areGroupsEqual(groupValues, originalGroupVals)) {
        this.table?.setGroupValues([groupValues]);
      }
    } else {
      this.table?.setGroupValues([]);
    }
  }

  _areGroupsEqual(oldGroups: unknown[], newGroups: unknown[]) {
    return (
      oldGroups &&
      newGroups.length === oldGroups.length &&
      newGroups.every((value, index) => value === oldGroups[index])
    );
  }

  _sortGroupTotals(groupTotalsRows: InternalColumnTotal[]) {
    const sortListActual: unknown[] = [];
    const { modules, options } = this.table;

    const sorter = modules.sort;
    const sortList: InternalSortItem[] = options.sortOrderReverse
      ? sorter.sortList.slice().reverse()
      : sorter.sortList;
    sortList.forEach((item) => {
      if (item.column) {
        const sortObj = item.column.modules.sort;
        if (sortObj) {
          //if no sorter has been defined, take a guess
          if (!sortObj.sorter) {
            sortObj.sorter = sorter.findSorter(item.column);
          }

          item.params =
            typeof sortObj.params === 'function'
              ? sortObj.params(item.column.getComponent(), item.dir)
              : sortObj.params;

          sortListActual.push(item);
        }
      }
    });

    //sort data
    if (sortListActual.length) {
      sorter._sortItems(groupTotalsRows, sortListActual);
    } else {
      groupTotalsRows.sort((a, b) => {
        const index = b.rows.length - a.rows.length;
        if (index === 0) {
          return a.key.localeCompare(b.key);
        }
        return index;
      });
    }
    return groupTotalsRows;
  }
}

// Representations of the internal Tabulator structures, that are entirely private to Tabulator. Subject to change and likely to b a bit flaky. May not cover all cases yet.
type InternalColumnTotal = {
  data: { [key: string]: unknown };
  key: string;
  rows: { [key: string]: unknown }[];
};

type InternalColumn = {
  getField(): string;
  getComponent(): ColumnComponent;
  modules: {
    sort: {
      params: (column: ColumnComponent, dir: string) => object;
      sorter: (...args: unknown[]) => number | boolean;
    };
  };
};

type InternalSortItem = {
  column: InternalColumn;
  dir: string;
  params: object;
};
