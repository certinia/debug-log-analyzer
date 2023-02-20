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
  let dmlDetailPanel: RowComponent | null;

  const dmlLines = DatabaseAccess.instance()?.getDMLLines();
  const dmlData: unknown[] = [];
  if (dmlLines) {
    for (const dml of dmlLines) {
      dmlData.push({
        dml: dml.text,
        rowCount: dml.rowCount,
        timeTaken: Math.round((dml.duration / 1000000) * 100) / 100,
        timestamp: dml.timestamp,
      });
    }
    dmlData.push({ isDetail: true, hide: true });
  }

  const dmlTable = new Tabulator('#dbDmlTable', {
    data: dmlData, //set initial table data
    layout: 'fitColumns',
    columnCalcs: 'table',
    selectable: 1,
    selectableCheck: function (row) {
      return !row.getData().isDetail;
    },
    columnDefaults: { title: 'default', resizable: true, headerSortStartingDir: 'desc' },
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
      },
      { title: 'Row Count', field: 'rowCount', sorter: 'number', width: 110, bottomCalc: 'sum' },
      {
        title: 'Time Taken (ms)',
        field: 'timeTaken',
        sorter: 'number',
        width: 110,
        bottomCalc: 'sum',
        // @ts-expect-error: waiting for types defintion update https://github.com/DefinitelyTyped/DefinitelyTyped/pull/64309
        bottomCalcParams: { precision: 2 },
      },
    ],
    rowFormatter: function (row) {
      const data = row.getData();
      if (data.isDetail) {
        const rowElem = row.getElement();
        if (data.hide) {
          rowElem.innerHTML = '';
        } else if (data.timestamp) {
          const detailContainer = createDetailPanel(data.timestamp);
          rowElem.replaceChildren(detailContainer);
        }
      }
    },
  });

  dmlTable.on('rowSelected', (row: RowComponent) => {
    dmlDetailPanel?.update({ timestamp: row.getData().timestamp, hide: false }).then(() => {
      if (dmlDetailPanel) {
        dmlDetailPanel?.move(row, false);
        const nextRow = dmlDetailPanel.getNextRow() || dmlDetailPanel;
        nextRow.getElement().scrollIntoView({ behavior: 'auto', block: 'center', inline: 'start' });
      }
    });
  });

  dmlTable.on('rowDeselected', () => {
    dmlTable.blockRedraw();
    dmlDetailPanel?.update({ hide: true });
  });

  dmlTable.on('dataChanged', () => {
    dmlTable.restoreRedraw();
  });

  dmlTable.on('tableBuilt', function () {
    dmlDetailPanel = dmlTable.searchRows('isDetail', '=', true)[0];
  });
}

function renderSOQLTable() {
  let soqlDetailPanel: RowComponent | null;
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
      });
    }
    soqlData.push({ isDetail: true, hide: true });
  }

  const soqlTable = new Tabulator('#dbSoqlTable', {
    data: soqlData,
    layout: 'fitColumns',
    columnCalcs: 'table',
    selectable: 1,
    selectableCheck: function (row) {
      return !row.getData().isDetail;
    },
    columnDefaults: { title: 'default', resizable: true, headerSortStartingDir: 'desc' },
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
        // @ts-expect-error: waiting for types defintion update https://github.com/DefinitelyTyped/DefinitelyTyped/pull/64309
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
      if (data.isDetail) {
        const rowElem = row.getElement();
        if (data.hide) {
          rowElem.innerHTML = '';
        } else if (data.timestamp) {
          const detailContainer = createDetailPanel(data.timestamp);
          rowElem.replaceChildren(detailContainer);
        }
      }
    },
  });

  soqlTable.on('rowSelected', (row: RowComponent) => {
    soqlDetailPanel?.update({ timestamp: row.getData().timestamp, hide: false }).then(() => {
      if (soqlDetailPanel) {
        soqlDetailPanel?.move(row, false);
        const nextRow = soqlDetailPanel.getNextRow() || soqlDetailPanel;
        nextRow.getElement().scrollIntoView({ behavior: 'auto', block: 'center', inline: 'start' });
      }
    });
  });

  soqlTable.on('rowDeselected', () => {
    soqlTable.blockRedraw();
    soqlDetailPanel?.update({ hide: true });
  });

  soqlTable.on('dataChanged', () => {
    soqlTable.restoreRedraw();
  });

  soqlTable.on('tableBuilt', () => {
    soqlDetailPanel = soqlTable.searchRows('isDetail', '=', true)[0];
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
