import { html, render } from 'lit';
import { ColumnComponent, RowComponent, TabulatorFull as Tabulator } from 'tabulator-tables';

import '../../resources/css/DatabaseView.scss';
import { DatabaseAccess } from '../Database';
import '../components/CallStack';
import NumberAccessor from '../datagrid/dataaccessor/Number';
import Number from '../datagrid/format/Number';
import { RootNode, SOQLExecuteBeginLine, SOQLExecuteExplainLine } from '../parsers/TreeParser';
import { hostService } from '../services/VSCodeService';
import './DatabaseSOQLDetailPanel';
import './DatabaseSection';

export async function initDBRender(rootMethod: RootNode) {
  await DatabaseAccess.create(rootMethod);
  const dbView = document.getElementById('dbView');
  if (dbView) {
    const dbObserver = new IntersectionObserver((entries, observer) => {
      const visible = entries[0].isIntersecting;
      if (visible) {
        observer.disconnect();
        renderDMLTable();
        renderSOQLTable();
      }
    });
    dbObserver.observe(dbView);
  }
}

function renderDMLTable() {
  const dmlContainer = document.getElementById('dmlTableContainer');
  if (!dmlContainer) {
    return;
  }
  const dmlLines = DatabaseAccess.instance()?.getDMLLines();
  const dbDmlCounts = document.createElement('div');
  render(
    html`<database-section title="DML Statements" .dbLines=${dmlLines}></database-section>
      <div>
        <strong>Group by</strong>
        <div>
          <input id="dbdml-groupBy" type="checkbox" checked />
          <label for="dbdml-groupBy">DML</label>
        </div>
      </div>`,
    dbDmlCounts
  );
  const dbDmlTable = document.createElement('div');
  dbDmlTable.id = 'dbDmlTable';
  dmlContainer.appendChild(dbDmlCounts);
  dmlContainer.appendChild(dbDmlTable);

  let currentSelectedRow: RowComponent | null;

  const dmlData: unknown[] = [];
  let dmlText: string[] = [];
  if (dmlLines) {
    for (const dml of dmlLines) {
      dmlText.push(dml.text);
      dmlData.push({
        dml: dml.text,
        rowCount: dml.rowCount,
        timeTaken: dml.duration,
        timestamp: dml.timestamp,
        _children: [{ timestamp: dml.timestamp, isDetail: true }],
      });
    }

    dmlText = sortByFrequency(dmlText);
  }

  const dmlTable = new Tabulator(dbDmlTable, {
    clipboard: true,
    downloadEncoder: downlodEncoder('dml.csv'),
    downloadRowRange: 'all',
    downloadConfig: {
      columnHeaders: true,
      columnGroups: true,
      rowGroups: true,
      columnCalcs: false,
      dataTree: true,
    },
    //@ts-expect-error types need update array is valid
    keybindings: { copyToClipboard: ['ctrl + 67', 'meta + 67'] },
    clipboardCopyRowRange: 'all',
    data: dmlData, //set initial table data
    layout: 'fitColumns',
    placeholder: 'No DML statements found',
    columnCalcs: 'both',
    groupClosedShowCalcs: true,
    groupStartOpen: false,
    groupValues: [dmlText],
    groupHeader(value, count, data: any[], _group) {
      const hasDetail = data.some((d) => {
        return d.isDetail;
      });

      const newCount = hasDetail ? count - 1 : count;
      return `
      <div class="db-group-wrapper">
        <div class="db-group-title" title="${value}">${value}</div><span>(${newCount} DML)</span>
      </div>
        `;
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
      headerMenu: csvheaderMenu('dml.csv'),
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
      },
      {
        title: 'Row Count',
        field: 'rowCount',
        sorter: 'number',
        width: 90,
        bottomCalc: 'sum',
        hozAlign: 'right',
        headerHozAlign: 'right',
      },
      {
        title: 'Time Taken (ms)',
        field: 'timeTaken',
        sorter: 'number',
        width: 110,
        hozAlign: 'right',
        headerHozAlign: 'right',
        formatter: Number,
        formatterParams: {
          thousand: false,
          precision: 3,
        },
        accessorDownload: NumberAccessor,
        bottomCalcFormatter: Number,
        bottomCalc: 'sum',
        bottomCalcFormatterParams: { precision: 3 },
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

  dmlTable.on('tableBuilt', () => {
    dmlTable.setGroupBy('dml');
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

    if (currentSelectedRow) {
      const nextRow = currentSelectedRow.getNextRow() || currentSelectedRow.getTreeChildren()[0];
      if (nextRow) {
        // @ts-expect-error it has 2 params
        nextRow.scrollTo('center', true).then(() => {
          //NOTE: This is a workaround for the fact that `row.scrollTo('center'` does not work correctly for ros near the bottom.
          // This needs fixing in main tabulator lib
          nextRow
            .getElement()
            .scrollIntoView({ behavior: 'auto', block: 'center', inline: 'start' });
        });
      }
    }
  });

  // todo: move to a lit element
  document.getElementById('dbdml-groupBy')?.addEventListener('change', (event) => {
    const checkBox = event.target as HTMLInputElement;
    dmlTable.setGroupBy(checkBox.checked ? 'dml' : '');
  });
}

function renderSOQLTable() {
  const soqlContainer = document.getElementById('soqlTableContainer');
  if (!soqlContainer) {
    return;
  }
  const soqlLines = DatabaseAccess.instance()?.getSOQLLines();
  const dbSoqlCounts = document.createElement('div');
  render(
    html`
      <database-section title="SOQL Statements" .dbLines=${soqlLines}></database-section>
      <div>
        <strong>Group by</strong>
        <div>
          <input id="dbsoql-groupBy" type="checkbox" checked />
          <label for="dbsoql-groupBy">SOQL</label>
        </div>
      </div>
    `,
    dbSoqlCounts
  );
  const dbSoqlTable = document.createElement('div');
  dbSoqlTable.id = 'dbSoqlTable';
  soqlContainer.appendChild(dbSoqlCounts);
  soqlContainer.appendChild(dbSoqlTable);

  const timestampToSOQl = new Map<number, SOQLExecuteBeginLine>();
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

  soqlLines?.forEach((line) => {
    timestampToSOQl.set(line.timestamp, line);
  });

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
        timeTaken: soql.duration,
        aggregations: soql.aggregations,
        timestamp: soql.timestamp,
        _children: [{ timestamp: soql.timestamp, isDetail: true }],
      });
    }

    soqlText = sortByFrequency(soqlText);
  }

  const soqlTable = new Tabulator(dbSoqlTable, {
    data: soqlData,
    layout: 'fitColumns',
    placeholder: 'No SOQL queries found',
    columnCalcs: 'both',
    clipboard: true,
    downloadEncoder: downlodEncoder('soql.csv'),
    downloadRowRange: 'all',
    downloadConfig: {
      columnHeaders: true,
      columnGroups: true,
      rowGroups: true,
      columnCalcs: false,
      dataTree: true,
    },
    //@ts-expect-error types need update array is valid
    keybindings: { copyToClipboard: ['ctrl + 67', 'meta + 67'] },
    clipboardCopyRowRange: 'all',
    groupClosedShowCalcs: true,
    groupStartOpen: false,
    groupValues: [soqlText],
    groupHeader(value, count, data: any[], _group) {
      const hasDetail = data.some((d) => {
        return d.isDetail;
      });

      const newCount = hasDetail ? count - 1 : count;
      return `
      <div class="db-group-wrapper">
        <div class="db-group-title" title="${value}">${value}</div><span>(${newCount} ${
        newCount > 1 ? 'Queries' : 'Query'
      })</span>
      </div>`;
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
      headerMenu: csvheaderMenu('soql.csv'),
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
        width: 40,
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
        accessorDownload: function (
          _value: any,
          data: any,
          _type: 'data' | 'download' | 'clipboard',
          _accessorParams: any,
          _column?: ColumnComponent,
          _row?: RowComponent
        ): any {
          return data.relativeCost;
        },
        accessorClipboard: function (
          _value: any,
          data: any,
          _type: 'data' | 'download' | 'clipboard',
          _accessorParams: any,
          _column?: ColumnComponent,
          _row?: RowComponent
        ): any {
          return data.relativeCost;
        },
      },
      {
        title: 'SOQL',
        field: 'soql',
        headerSortStartingDir: 'asc',
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
        width: 100,
        hozAlign: 'right',
        headerHozAlign: 'right',
        bottomCalc: 'sum',
      },
      {
        title: 'Time Taken (ms)',
        field: 'timeTaken',
        sorter: 'number',
        width: 120,
        hozAlign: 'right',
        headerHozAlign: 'right',
        formatter: Number,
        formatterParams: {
          thousand: false,
          precision: 3,
        },
        accessorDownload: NumberAccessor,
        bottomCalcFormatter: Number,
        bottomCalc: 'sum',
        bottomCalcFormatterParams: { precision: 3 },
      },
      {
        title: 'Aggregations',
        field: 'aggregations',
        sorter: 'number',
        width: 100,
        hozAlign: 'right',
        headerHozAlign: 'right',
        bottomCalc: 'sum',
      },
    ],
    rowFormatter: function (row) {
      const data = row.getData();
      if (data.isDetail && data.timestamp) {
        const detailContainer = createSOQLDetailPanel(data.timestamp, timestampToSOQl);
        row.getElement().replaceChildren(detailContainer);
      }
    },
  });

  soqlTable.on('tableBuilt', () => {
    soqlTable.setGroupBy('soql');
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

    if (currentSelectedRow) {
      const nextRow = currentSelectedRow.getNextRow() || currentSelectedRow.getTreeChildren()[0];
      if (nextRow) {
        // @ts-expect-error it has 2 params
        nextRow.scrollTo('center', true).then(() => {
          //NOTE: This is a workaround for the fact that `row.scrollTo('center'` does not work correctly for ros near the bottom.
          // This needs fixing in main tabulator lib
          nextRow
            .getElement()
            .scrollIntoView({ behavior: 'auto', block: 'center', inline: 'start' });
        });
      }
    }
  });

  // todo: move to a lit element
  document.getElementById('dbsoql-groupBy')?.addEventListener('change', (event) => {
    const checkBox = event.target as HTMLInputElement;
    soqlTable.setGroupBy(checkBox.checked ? 'soql' : '');
  });
}

function createDetailPanel(timestamp: number) {
  const detailContainer = document.createElement('div');
  detailContainer.className = 'soqlDBDetailView';
  render(html`<call-stack timestamp=${timestamp}></call-stack>`, detailContainer);

  return detailContainer;
}

function createSOQLDetailPanel(
  timestamp: number,
  timestampToSOQl: Map<number, SOQLExecuteBeginLine>
) {
  const detailContainer = document.createElement('div');
  detailContainer.className = 'soqlDBDetailView';

  const soqlLine = timestampToSOQl.get(timestamp);
  render(
    html`<db-soql-detail-panel
      timestamp=${timestamp}
      soql=${soqlLine?.text}
    ></db-soql-detail-panel>`,
    detailContainer
  );

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

function csvheaderMenu(csvFileName: string) {
  return [
    {
      label: 'Export to CSV',
      action: function (_e: PointerEvent, column: ColumnComponent) {
        column.getTable().download('csv', csvFileName, { bom: true, delimiter: ',' });
      },
    },
  ];
}

function downlodEncoder(defaultFileName: string) {
  return function (fileContents: string, mimeType: string) {
    const vscodeHost = hostService();
    if (vscodeHost) {
      vscodeHost.saveFile({ fileContent: fileContents, defaultFilename: defaultFileName });
      return false;
    }

    return new Blob([fileContents], { type: mimeType });
  };
}
