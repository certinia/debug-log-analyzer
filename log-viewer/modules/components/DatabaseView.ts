import '../../resources/css/DatabaseView.scss';
import { RowComponent, TabulatorFull as Tabulator } from 'tabulator-tables';
import { html, render } from 'lit';

import { DatabaseAccess } from '../Database';
import { SOQLExecuteBeginLine, SOQLExecuteExplainLine } from '../parsers/TreeParser';
import './CallStack.ts';

let currentDetailRow: HTMLElement | null;
// let currentDetailRow: RowComponent | null;

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
        timeTaken: (dml.duration / 1000000).toFixed(2),
      });
    }
  }

  new Tabulator('#dbDmlTable', {
    data: dmlData, //set initial table data
    layout: 'fitColumns',
    columnCalcs: 'table',
    selectable: 1,
    columns: [
      { title: 'DML', field: 'dml', sorter: 'string', tooltip: true },
      { title: 'Row Count', field: 'rowCount', sorter: 'number', width: 110, bottomCalc: 'sum' },
      {
        title: 'Time Taken (ms)',
        field: 'timeTaken',
        sorter: 'number',
        width: 110,
        bottomCalc: 'sum',
        bottomCalcFormatterParams: { precision: 2 },
      },
    ],
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
  const soqlData: GridSOQLData[] = [];
  if (soqlLines) {
    for (const soql of soqlLines) {
      const explainLine = soql.children[0] as SOQLExecuteExplainLine;
      soqlData.push({
        isSelective: explainLine?.relativeCost ? explainLine.relativeCost <= 1 : null,
        relativeCost: explainLine?.relativeCost,
        soql: soql.text,
        rowCount: soql.rowCount,
        timeTaken: Math.round(soql.duration / 1000000 / 100) * 100,
        aggregations: soql.aggregations,
        timestamp: soql.timestamp,
      });
    }
  }

  const soqlTable = new Tabulator('#dbSoqlTable', {
    data: soqlData, //set initial table data
    layout: 'fitColumns',
    columnCalcs: 'table',
    selectable: 1,
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
          //a, b - the two values being compared
          //aRow, bRow - the row components for the values being compared (useful if you need to access additional fields in the row data for the sort)
          //column - the column component for the column being sorted
          //dir - the direction of the sort ("asc" or "desc")
          //sorterParams - sorterParams object from column definition array

          // Always Sort null values to the bottom (when we do not have selectivity)
          if (a === null) {
            return dir === 'asc' ? 1 : -1;
          } else if (b === null) {
            return dir === 'asc' ? -1 : 1;
          }

          const aRowData = aRow.getData() as GridSOQLData;
          const bRowData = bRow.getData() as GridSOQLData;

          return (aRowData.relativeCost || 0) - (bRowData.relativeCost || 0);
        },
        tooltip: function (e, cell, _onRendered) {
          //e - mouseover event
          //cell - cell component
          //onRendered - onRendered callback registration function

          // var el = document.createElement('div');
          // el.style.backgroundColor = 'red';
          // el.innerText = cell.getColumn().getField() + ' - ' + cell.getValue(); //return cells "field - value";
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
      { title: 'Row Count', field: 'rowCount', sorter: 'number', width: 110, bottomCalc: 'sum' },
      {
        title: 'Time Taken (ms)',
        field: 'timeTaken',
        sorter: 'number',
        width: 110,
        bottomCalc: 'sum',
        bottomCalcFormatterParams: { precision: 2 },
      },
      {
        title: 'Aggregations',
        field: 'aggregations',
        sorter: 'number',
        width: 110,
        bottomCalc: 'sum',
      },
    ],
  });

  soqlTable.on('rowSelected', function (row: RowComponent) {
    //e - the click event object
    //row - row component
    showDetailView(row);
  });

  soqlTable.on('rowDeselected', function (_row: RowComponent) {
    if (currentDetailRow) {
      currentDetailRow.remove();
      currentDetailRow = null;
    }
  });
}

function showDetailView(row: RowComponent) {
  const timestamp = (row?.getData() as SOQLExecuteBeginLine)?.timestamp;
  if (timestamp) {
    if (currentDetailRow) {
      currentDetailRow.remove();
      currentDetailRow = null;
    }

    const detailContainer = document.createElement('div');
    detailContainer.id = 'soqlDBDetailView';
    currentDetailRow = detailContainer;

    const stackContainer = document.createElement('div');
    detailContainer.appendChild(stackContainer);
    render(html`<call-stack timestamp=${timestamp}></call-stack>`, stackContainer);
    const rowElem = row.getElement();
    rowElem.parentNode?.insertBefore(detailContainer, rowElem.nextSibling);
  }
}
