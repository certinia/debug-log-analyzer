import '../../resources/css/DatabaseView.scss';
import { RowComponent, TabulatorFull as Tabulator } from 'tabulator-tables';
import { html, render } from 'lit';

import { DatabaseAccess } from '../Database';
import { SOQLExecuteExplainLine } from '../parsers/TreeParser';
import './CallStack.ts';

let soqlDetailPanel: RowComponent | null;
let dmlDetailPanel: RowComponent | null;

export function renderDBGrid(): void {
  renderDMLTable();
  renderSOQLTable();
}
function renderDMLTable(): void {
  const dmlLines = DatabaseAccess.instance()?.getDMLLines();
  const dmlData = [];
  if (dmlLines) {
    for (const dml of dmlLines) {
      dmlData.push({
        dml: dml.text,
        rowCount: dml.rowCount,
        timeTaken: Math.round((dml.duration / 1000000) * 100) / 100,
        timestamp: dml.timestamp,
        _children: [{}],
      });
    }
  }

  const dmlTable = new Tabulator('#dbDmlTable', {
    data: dmlData, //set initial table data
    layout: 'fitColumns',
    columnCalcs: 'table',
    selectable: true,
    dataTree: true,
    dataTreeExpandElement: '<span></span>',
    dataTreeCollapseElement: '<span></span>',
    dataTreeBranchElement: false,
    selectableCheck: function (row) {
      return row.getData().dml;
    },
    columns: [
      { title: 'DML', field: 'dml', sorter: 'string', tooltip: true },
      { title: 'Row Count', field: 'rowCount', sorter: 'number', width: 110, bottomCalc: 'sum' },
      {
        title: 'Time Taken (ms)',
        field: 'timeTaken',
        sorter: 'number',
        width: 110,
        bottomCalc: 'sum',
        // @ts-ignore
        bottomCalcParams: { precision: 2 },
      },
    ],
    rowFormatter: function (row) {
      const parent = row.getTreeParent();
      if (parent) {
        const rowData = parent.getData();
        const detailContainer = createDetailPanel(rowData.timestamp);
        row.getElement().replaceChildren(detailContainer);
      }
    },
  });

  dmlTable.on('rowSelected', function (row: RowComponent) {
    dmlTable.blockRedraw();
    if (dmlDetailPanel) {
      dmlDetailPanel.deselect();
    }
    row.treeExpand();
    dmlDetailPanel = row;
    dmlTable.restoreRedraw();
  });

  dmlTable.on('rowDeselected', function (row: RowComponent) {
    if (row === dmlDetailPanel) {
      row.treeCollapse();
      dmlDetailPanel = null;
    }
  });
}

function renderSOQLTable(): void {
  interface GridSOQLData {
    isSelective: boolean | null;
    relativeCost: number | null;
    soql: string;
    rowCount: number | null;
    timeTaken: number | null;
    aggregations: number;
    timestamp: number;
  }

  // todo: move to a class to aggreagte multiple sources for selevtivity
  const soqlLines = DatabaseAccess.instance()?.getSOQLLines();
  const soqlData = [];
  if (soqlLines) {
    for (const soql of soqlLines) {
      const explainLine = soql.children[0] as SOQLExecuteExplainLine;
      soqlData.push({
        isSelective: explainLine?.relativeCost ? explainLine.relativeCost <= 1 : null,
        relativeCost: explainLine?.relativeCost,
        soql: soql.text,
        rowCount: soql.rowCount,
        timeTaken: Math.round((soql.duration / 1000000) * 100) / 100,
        aggregations: soql.aggregations,
        timestamp: soql.timestamp,
        _children: [{}],
      });
    }
  }

  const soqlTable = new Tabulator('#dbSoqlTable', {
    data: soqlData,
    layout: 'fitColumns',
    columnCalcs: 'table',
    selectable: true,
    dataTree: true,
    dataTreeExpandElement: '<span></span>',
    dataTreeCollapseElement: '<span></span>',
    dataTreeBranchElement: false,
    selectableCheck: function (row) {
      return row.getData().soql;
    },
    columnDefaults: { title: 'default', resizable: true },
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
            title += `\nRelative cost: ${relativeCost}`;
          }
          return title;
        },
      },
      { title: 'SOQL', field: 'soql', sorter: 'string', tooltip: true },
      {
        title: 'Row Count',
        field: 'rowCount',
        sorter: 'number',
        width: 110,
        bottomCalc: 'sum',
        // @ts-ignore
        bottomCalcParams: { precision: 2 },
      },
      {
        title: 'Time Taken (ms)',
        field: 'timeTaken',
        sorter: 'number',
        width: 110,
        bottomCalc: 'sum',
        // @ts-ignore
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
      const parent = row.getTreeParent();
      if (parent) {
        const rowData = parent.getData();
        const detailContainer = createDetailPanel(rowData.timestamp);
        row.getElement().replaceChildren(detailContainer);
      }
    },
  });

  soqlTable.on('rowSelected', function (row: RowComponent) {
    soqlTable.blockRedraw();
    if (soqlDetailPanel) {
      soqlDetailPanel.deselect();
    }
    row.treeExpand();
    soqlDetailPanel = row;
    soqlTable.restoreRedraw();
  });

  soqlTable.on('rowDeselected', function (row: RowComponent) {
    if (row === soqlDetailPanel) {
      row.treeCollapse();
      soqlDetailPanel = null;
    }
  });
}

function createDetailPanel(timestamp: number) {
  const stackContainer = document.createElement('div');
  render(html`<call-stack timestamp=${timestamp}></call-stack>`, stackContainer);
  const detailContainer = document.createElement('div');
  detailContainer.id = 'soqlDBDetailView';
  detailContainer.appendChild(stackContainer);
  return detailContainer;
}
