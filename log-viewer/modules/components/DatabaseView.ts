import '../../resources/css/DatabaseView.scss';
import { RowComponent, TabulatorFull as Tabulator } from 'tabulator-tables';
import { html, render } from 'lit';

import { DatabaseAccess } from '../Database';
import { SOQLExecuteExplainLine } from '../parsers/TreeParser';
import './CallStack.ts';

export function renderDBGrid() {
  renderDMLTable();
  renderSOQLTable();
}

function renderDMLTable() {
  let currentSelectedRow: RowComponent | null;

  const dmlLines = DatabaseAccess.instance()?.getDMLLines();
  const dmlData: unknown[] = [];
  let dmlText: string[] = [];
  if (dmlLines) {
    for (const dml of dmlLines) {
      dmlText.push(dml.text);
      dmlData.push({
        dml: dml.text,
        rowCount: dml.rowCount,
        timeTaken: Math.round((dml.duration / 1000000) * 100) / 100,
        timestamp: dml.timestamp,
        _children: [{ timestamp: dml.timestamp, isDetail: true }],
      });
    }

    dmlText = sortByFrequency(dmlText);
  }

  const dmlTable = new Tabulator('#dbDmlTable', {
    data: dmlData, //set initial table data
    layout: 'fitColumns',
    placeholder: 'No DML statements found',
    columnCalcs: 'both',
    groupClosedShowCalcs: true,
    groupStartOpen: false,
    groupBy: 'dml',
    groupValues: [dmlText],
    groupHeader(value, count, data: any[], _group) {
      const hasDetail = data.some((d) => {
        return d.isDetail;
      });

      const newCount = hasDetail ? count - 1 : count;
      return '<div class="db-group-title">' + value + '</div>' + `<span>(${newCount} DML)</span>`;
    },
    groupToggleElement: 'header',
    selectable: 1,
    selectableCheck: function (row) {
      return !row.getData().isDetail;
    },
    dataTree: true,
    dataTreeBranchElement: '<span></span>',
    dataTreeCollapseElement: '<span></span>',
    dataTreeExpandElement: '<span></span>',
    columnDefaults: {
      title: 'default',
      resizable: true,
      headerSortStartingDir: 'desc',
      headerTooltip: true,
    },
    initialSort: [{ column: 'rowCount', dir: 'desc' }],
    columns: [
      {
        title: 'DML',
        field: 'dml',
        sorter: 'string',
        tooltip: true,
        bottomCalc: () => {
          return 'Total';
        },
        headerMenu: [
          {
            label: (component): string => {
              const columnName = component.getField();
              const groupFields = dmlTable.getGroups().map((g) => g.getField());
              const checked = groupFields.includes(columnName) ? 'checked' : '';
              return `<input type="checkbox" ${checked}
                        <label>Group by ${component.getDefinition().title}</label>
                      </input>`;
            },
            action: (_e, component) => {
              if (dmlTable.getGroups().length) {
                dmlTable.setGroupBy('');
              } else {
                dmlTable.setGroupBy(component.getField());
              }
            },
          },
        ],
      },
      { title: 'Row Count', field: 'rowCount', sorter: 'number', width: 110, bottomCalc: 'sum' },
      {
        title: 'Time Taken (ms)',
        field: 'timeTaken',
        sorter: 'number',
        width: 110,
        bottomCalc: 'sum',
        bottomCalcParams: { precision: 2 },
      },
    ],
    rowFormatter: function (row) {
      const data = row.getData();
      if (data.isDetail && data.timestamp) {
        const detailContainer = createDetailPanel(data.timestamp);
        row.getElement().replaceChildren(detailContainer);
      }
    },
  });

  dmlTable.on('rowClick', function (e, row) {
    const data = row.getData();
    if (!(data.timestamp && data.dml)) {
      return;
    }
    const oldRow = currentSelectedRow;
    const table = row.getTable();
    table.blockRedraw();
    if (oldRow) {
      oldRow.treeCollapse();
      currentSelectedRow = null;
    }

    if (oldRow !== row) {
      row.treeExpand();
      currentSelectedRow = row;
    }
    table.restoreRedraw();

    const goTo = function () {
      if (currentSelectedRow) {
        const nextRow = currentSelectedRow.getNextRow() || currentSelectedRow.getTreeChildren()[0];
        nextRow &&
          nextRow
            .getElement()
            .scrollIntoView({ behavior: 'auto', block: 'center', inline: 'start' });
      }
    };
    requestAnimationFrame(() => {
      setTimeout(goTo);
    });
  });
}

function renderSOQLTable() {
  let currentSelectedRow: RowComponent | null;
  interface GridSOQLData {
    isSelective: boolean | null;
    relativeCost: number | null;
    soql: string;
    rowCount: number | null;
    timeTaken: number | null;
    aggregations: number;
    timestamp: number;
  }

  const soqlLines = DatabaseAccess.instance()?.getSOQLLines();
  const soqlData: unknown[] = [];
  let soqlText: string[] = [];
  if (soqlLines) {
    for (const soql of soqlLines) {
      soqlText.push(soql.text);

      const explainLine = soql.children[0] as SOQLExecuteExplainLine;
      soqlData.push({
        isSelective: explainLine?.relativeCost ? explainLine.relativeCost <= 1 : null,
        relativeCost: explainLine?.relativeCost,
        soql: soql.text,
        rowCount: soql.rowCount,
        timeTaken: Math.round((soql.duration / 1000000) * 100) / 100,
        aggregations: soql.aggregations,
        timestamp: soql.timestamp,
        _children: [{ timestamp: soql.timestamp, isDetail: true }],
      });
    }

    soqlText = sortByFrequency(soqlText);
  }

  const soqlTable = new Tabulator('#dbSoqlTable', {
    data: soqlData,
    layout: 'fitColumns',
    placeholder: 'No SOQL queries found',
    columnCalcs: 'both',
    groupClosedShowCalcs: true,
    groupStartOpen: false,
    groupBy: 'soql',
    groupValues: [soqlText],
    groupHeader(value, count, data: any[], _group) {
      const hasDetail = data.some((d) => {
        return d.isDetail;
      });

      const newCount = hasDetail ? count - 1 : count;
      return (
        '<div class="db-group-title">' +
        value +
        '</div>' +
        `<span>(${newCount} ${newCount > 1 ? 'Queries' : 'Query'})</span>`
      );
    },
    groupToggleElement: 'header',
    selectable: 1,
    selectableCheck: function (row) {
      return !row.getData().isDetail;
    },
    dataTree: true,
    dataTreeBranchElement: '<span></span>',
    dataTreeCollapseElement: '<span></span>',
    dataTreeExpandElement: '<span></span>',
    columnDefaults: {
      title: 'default',
      resizable: true,
      headerSortStartingDir: 'desc',
      headerTooltip: true,
    },
    initialSort: [{ column: 'rowCount', dir: 'desc' }],
    columns: [
      {
        title: 'Selective',
        field: 'isSelective',
        formatter: 'tickCross',
        formatterParams: {
          allowEmpty: true,
        },
        width: 25,
        hozAlign: 'center',
        vertAlign: 'middle',
        sorter: function (a, b, aRow, bRow, _column, dir, _sorterParams) {
          // Always Sort null values to the bottom (when we do not have selectivity)
          if (a === null) {
            return dir === 'asc' ? 1 : -1;
          } else if (b === null) {
            return dir === 'asc' ? -1 : 1;
          }

          const aRowData = aRow.getData();
          const bRowData = bRow.getData();

          return (aRowData.relativeCost || 0) - (bRowData.relativeCost || 0);
        },
        tooltip: function (e, cell, _onRendered) {
          const { isSelective, relativeCost } = cell.getData() as GridSOQLData;
          let title;
          if (isSelective === null) {
            title = 'Selectivity could not be determined.';
          } else if (isSelective) {
            title = 'Query is selective.';
          } else {
            title = 'Query is not selective.';
          }

          if (relativeCost) {
            title += `<br>Relative cost: ${relativeCost}`;
          }
          return title;
        },
      },
      {
        title: 'SOQL',
        field: 'soql',
        sorter: 'string',
        tooltip: true,
        bottomCalc: () => {
          return 'Total';
        },
        headerMenu: [
          {
            label: (component): string => {
              const columnName = component.getField();
              const groupFields = soqlTable.getGroups().map((g) => g.getField());
              const checked = groupFields.includes(columnName) ? 'checked' : '';
              return `<input type="checkbox" ${checked}
                        <label>Group by ${component.getDefinition().title}</label>
                      </input>`;
            },
            action: (_e, component) => {
              if (soqlTable.getGroups().length) {
                soqlTable.setGroupBy('');
              } else {
                soqlTable.setGroupBy(component.getField());
              }
            },
          },
        ],
      },
      {
        title: 'Row Count',
        field: 'rowCount',
        sorter: 'number',
        width: 110,
        bottomCalc: 'sum',
      },
      {
        title: 'Time Taken (ms)',
        field: 'timeTaken',
        sorter: 'number',
        width: 110,
        bottomCalc: 'sum',
        bottomCalcParams: { precision: 2 },
      },
      {
        title: 'Aggregations',
        field: 'aggregations',
        sorter: 'number',
        width: 110,
        bottomCalc: 'sum',
      },
    ],
    rowFormatter: function (row) {
      const data = row.getData();
      if (data.isDetail && data.timestamp) {
        const detailContainer = createDetailPanel(data.timestamp);
        row.getElement().replaceChildren(detailContainer);
      }
    },
  });

  soqlTable.on('rowClick', function (e, row) {
    const data = row.getData();
    if (!(data.timestamp && data.soql)) {
      return;
    }
    const oldRow = currentSelectedRow;
    const table = row.getTable();
    table.blockRedraw();
    if (oldRow) {
      oldRow.treeCollapse();
      currentSelectedRow = null;
    }

    if (oldRow !== row) {
      row.treeExpand();
      currentSelectedRow = row;
    }
    table.restoreRedraw();

    const goTo = function () {
      if (currentSelectedRow) {
        const nextRow = currentSelectedRow.getNextRow() || currentSelectedRow.getTreeChildren()[0];
        nextRow &&
          nextRow
            .getElement()
            .scrollIntoView({ behavior: 'auto', block: 'center', inline: 'start' });
      }
    };
    requestAnimationFrame(() => {
      setTimeout(goTo);
    });
  });
}

function createDetailPanel(timestamp: number) {
  const stackContainer = document.createElement('div');
  render(html`<call-stack timestamp=${timestamp}></call-stack>`, stackContainer);
  const detailContainer = document.createElement('div');
  detailContainer.className = 'soqlDBDetailView';
  detailContainer.appendChild(stackContainer);

  return detailContainer;
}

function sortByFrequency(dataArray: string[]) {
  const map = new Map<string, number>();
  dataArray.forEach((val) => {
    map.set(val, (map.get(val) || 0) + 1);
  });
  const newMap = new Map([...map.entries()].sort((a, b) => b[1] - a[1]));
  return [...newMap.keys()];
}
