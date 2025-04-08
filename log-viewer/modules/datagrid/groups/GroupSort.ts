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
      this.table.on('dataSorting', () => {
        this.table.blockRedraw();
        this._sortGroups();
        this.table.restoreRedraw();
      });
    }
  }

  _setSortedGroupBy(...args: unknown[]) {
    const grpArg = args[0] as GroupArg;
    const grpArray = Array.isArray(grpArg) ? grpArg : [grpArg];
    const oldGrpArg = this.table.options.groupBy as GroupArg;
    const oldGrpArray = Array.isArray(oldGrpArg) ? oldGrpArg : [oldGrpArg];
    if (!this._areGroupsEqual(oldGrpArray, grpArray)) {
      this.table.options.groupBy = grpArray;
      this.table.blockRedraw();
      this._sortGroups();
      this.table.setGroupBy(grpArray);
      this.table.restoreRedraw();
    }
  }

  _areGroupsEqual(oldGroups: unknown[], newGroups: unknown[]) {
    return (
      oldGroups &&
      newGroups.length === oldGroups.length &&
      newGroups.every((value, index) => value === oldGroups[index])
    );
  }

  _sortGroups() {
    const grpArray = Array.isArray(this.table.options.groupBy)
      ? this.table.options.groupBy
      : [this.table.options.groupBy];
    const { options } = this.table;
    options.groupValues = [];

    const validGrps = grpArray.filter(Boolean).length > 0;
    if (this.table && this.table.options.sortMode !== 'remote' && validGrps) {
      const { modules } = this.table;

      const groupRows = modules.groupRows;
      const rows = this.table.rowManager.rows;
      groupRows.configureGroupSetup();
      groupRows.generateGroups(rows);

      const groupTotalsRows: InternalColumnTotal[] = [];
      const columnCalcs = modules.columnCalcs;
      const field = columnCalcs.botCalcs[0].field;
      groupRows.groupList.forEach((group: { key: string; rows: { data: unknown }[] }) => {
        const row = columnCalcs.generateBottomRow(group.rows);
        row.data[field] = group.key;
        row.key = group.key;
        row.rows = group.rows;
        row.generateCells();
        groupTotalsRows.push(row);
      });

      const sortListActual: unknown[] = [];
      //build list of valid sorters and trigger column specific callbacks before sort begins
      const sorter = modules.sort;
      const sortList: InternalSortItem[] = options.sortOrderReverse
        ? sorter.sortList.slice().reverse()
        : sorter.sortList;
      sortList.forEach((item) => {
        let sortObj;

        if (item.column) {
          sortObj = item.column.modules.sort;

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
      const groupValues: string[] = [];
      groupTotalsRows.forEach((colTotals) => {
        groupValues.push(colTotals.data[field] as string);
      });

      this.table?.setGroupValues([groupValues]);
    }
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
