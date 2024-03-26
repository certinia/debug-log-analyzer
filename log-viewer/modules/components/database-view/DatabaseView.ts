/*
 * Copyright (c) 2022 Certinia Inc. All rights reserved.
 */
import {
  provideVSCodeDesignSystem,
  vsCodeCheckbox,
  vsCodeDropdown,
  vsCodeOption,
} from '@vscode/webview-ui-toolkit';
import { LitElement, css, html, render, unsafeCSS, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import {
  Tabulator,
  type ColumnComponent,
  type GroupComponent,
  type RowComponent,
} from 'tabulator-tables';

import * as CommonModules from '../../datagrid/module/CommonModules.js';

import { DatabaseAccess } from '../../Database.js';
import NumberAccessor from '../../datagrid/dataaccessor/Number.js';
import Number from '../../datagrid/format/Number.js';
import { RowKeyboardNavigation } from '../../datagrid/module/RowKeyboardNavigation.js';
import dataGridStyles from '../../datagrid/style/DataGrid.scss';
import {
  ApexLog,
  DMLBeginLine,
  SOQLExecuteBeginLine,
  SOQLExecuteExplainLine,
} from '../../parsers/ApexLogParser.js';
import { hostService } from '../../services/VSCodeService.js';
import { globalStyles } from '../../styles/global.styles.js';
import '../CallStack.js';
import './DatabaseSOQLDetailPanel.js';
import './DatabaseSection.js';
import databaseViewStyles from './DatabaseView.scss';

provideVSCodeDesignSystem().register(vsCodeCheckbox(), vsCodeDropdown(), vsCodeOption());

let soqlTable: Tabulator;
let dmlTable: Tabulator;

@customElement('database-view')
export class DatabaseView extends LitElement {
  @property()
  timelineRoot: ApexLog | null = null;

  @state()
  dmlLines: DMLBeginLine[] = [];

  @state()
  soqlLines: SOQLExecuteBeginLine[] = [];

  get _dmlTableWrapper(): HTMLDivElement | null {
    return this.renderRoot?.querySelector('#db-dml-table') ?? null;
  }

  get _soqlTableWrapper(): HTMLDivElement | null {
    return this.renderRoot?.querySelector('#db-soql-table') ?? null;
  }

  constructor() {
    super();
  }

  updated(changedProperties: PropertyValues): void {
    if (this.timelineRoot && changedProperties.has('timelineRoot')) {
      this._appendTableWhenVisible();
    }
  }

  static styles = [
    unsafeCSS(dataGridStyles),
    unsafeCSS(databaseViewStyles),
    globalStyles,
    css`
      :host {
        height: 100%;
        width: 100%;
        display: flex;
        flex-direction: column;
        flex: 1;
      }

      #db-container {
        overflow-y: scroll;
        overflow-x: hidden;
        height: 100%;
        width: 100%;
      }
      #dml-table-container,
      #soql-table-container {
        height: 100%;
        width: 100%;
      }
      #db-dml-table,
      #db-soql-table {
        overflow: hidden;
        table-layout: fixed;
        height: 100%;
        width: 100%;
        min-height: 0%;
        min-width: 0%;
        margin-bottom: 1rem;
        display: flex;
        flex-direction: column;
      }

      .filter-container {
        margin-bottom: 1rem;
      }

      .dropdown-container {
        box-sizing: border-box;
        display: flex;
        flex-flow: column nowrap;
        align-items: flex-start;
        justify-content: flex-start;
      }

      .dropdown-container label {
        display: block;
        color: var(--vscode-foreground);
        cursor: pointer;
        font-size: var(--vscode-font-size);
        line-height: normal;
        margin-bottom: 2px;
      }
    `,
  ];

  render() {
    const dmlSkeleton = !this.timelineRoot ? html`<grid-skeleton></grid-skeleton>` : ``;
    const soqlSkeleton = dmlSkeleton;

    return html`
      <div id="db-container">
        <div>
          <database-section title="DML Statements" .dbLines="${this.dmlLines}"></database-section>
          <div>
            <strong>Group by</strong>
            <div>
              <vscode-checkbox @change="${this._dmlGroupBy}" checked>DML</vscode-checkbox>
            </div>
          </div>
          <div id="dml-table-container">
            ${dmlSkeleton}
            <div id="db-dml-table"></div>
          </div>
        </div>
        <div>
          <database-section title="SOQL Statements" .dbLines="${this.soqlLines}"></database-section>
          <div class="filter-container">
            <div class="dropdown-container">
              <label for="soql-groupby-dropdown">Group by</label>
              <vscode-dropdown id="soql-groupby-dropdown" @change="${this._soqlGroupBy}">
                <vscode-option>SOQL</vscode-option>
                <vscode-option>Namespace</vscode-option>
                <vscode-option>None</vscode-option>
              </vscode-dropdown>
            </div>
          </div>
          <div id="soql-table-container">
            ${soqlSkeleton}
            <div id="db-soql-table"></div>
          </div>
        </div>
      </div>
    `;
  }

  _dmlGroupBy(event: Event) {
    const target = event.target as HTMLInputElement;
    dmlTable.setGroupBy(target.checked ? 'dml' : '');
  }

  _soqlGroupBy(event: Event) {
    const target = event.target as HTMLInputElement;
    const fieldName = target.value.toLowerCase();
    const groupValue = fieldName !== 'none' ? fieldName : '';

    soqlTable.setGroupValues([
      groupValue ? sortByFrequency(soqlTable.getData(), groupValue) : [''],
    ]);
    soqlTable.setGroupBy(groupValue);
  }

  _appendTableWhenVisible() {
    const dbContainer = this.renderRoot?.querySelector('#db-container');
    const dmlTableWrapper = this._dmlTableWrapper;
    const soqlTableWrapper = this._soqlTableWrapper;
    const treeRoot = this.timelineRoot;
    if (dbContainer && dmlTableWrapper && soqlTableWrapper && treeRoot) {
      const dbObserver = new IntersectionObserver(async (entries, observer) => {
        const visible = entries[0]?.isIntersecting;
        if (visible) {
          observer.disconnect();

          const dbAccess = await DatabaseAccess.create(treeRoot);
          this.dmlLines = dbAccess.getDMLLines() || [];
          this.soqlLines = dbAccess.getSOQLLines() || [];

          Tabulator.registerModule(Object.values(CommonModules));
          Tabulator.registerModule([RowKeyboardNavigation]);
          renderDMLTable(dmlTableWrapper, this.dmlLines);
          renderSOQLTable(soqlTableWrapper, this.soqlLines);
        }
      });
      dbObserver.observe(dbContainer);
    }
  }
}

function renderDMLTable(dmlTableContainer: HTMLElement, dmlLines: DMLBeginLine[]) {
  interface DMLRow {
    dml?: string;
    rowCount?: number;
    timeTaken?: number;
    timestamp: number;
    isDetail?: boolean;
    _children?: DMLRow[];
  }

  const dmlData: DMLRow[] = [];
  if (dmlLines) {
    for (const dml of dmlLines) {
      dmlData.push({
        dml: dml.text,
        rowCount: dml.rowCount.self,
        timeTaken: dml.duration.total,
        timestamp: dml.timestamp,
        _children: [{ timestamp: dml.timestamp, isDetail: true }],
      });
    }
  }
  const dmlText = sortByFrequency(dmlData || [], 'dml');

  dmlTable = new Tabulator(dmlTableContainer, {
    height: '100%',
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
    rowKeyboardNavigation: true,
    data: dmlData, //set initial table data
    layout: 'fitColumns',
    placeholder: 'No DML statements found',
    columnCalcs: 'both',
    groupClosedShowCalcs: true,
    groupStartOpen: false,
    groupValues: [dmlText],
    groupHeader(value, count, data: DMLRow[], _group) {
      const hasDetail = data.some((d) => {
        return d.isDetail;
      });

      const newCount = hasDetail ? count - 1 : count;
      return `
      <div class="db-group-row">
        <div class="db-group-row__title" title="${value}">${value}</div><span>(${newCount} DML)</span>
      </div>
        `;
    },

    groupToggleElement: 'header',
    selectableRowsCheck: function (row) {
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
      headerWordWrap: true,
    },
    initialSort: [{ column: 'rowCount', dir: 'desc' }],
    headerSortElement: function (column, dir) {
      switch (dir) {
        case 'asc':
          return "<div class='sort-by--top'></div>";
          break;
        case 'desc':
          return "<div class='sort-by--bottom'></div>";
          break;
        default:
          return "<div class='sort-by'><div class='sort-by--top'></div><div class='sort-by--bottom'></div></div>";
      }
    },
    columns: [
      {
        title: 'DML',
        field: 'dml',
        sorter: 'string',
        bottomCalc: () => {
          return 'Total';
        },
        cssClass: 'datagrid-textarea datagrid-code-text',
        variableHeight: true,
        formatter: (cell, _formatterParams, _onRendered) => {
          const data = cell.getData() as DMLRow;
          return `<call-stack
          timestamp=${data.timestamp}
          startDepth="0"
          endDepth="1"
        ></call-stack>`;
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

  dmlTable.on('groupClick', (e: UIEvent, group: GroupComponent) => {
    if (!group.isVisible()) {
      dmlTable.blockRedraw();
      dmlTable.getRows().forEach((row) => {
        !row.isTreeExpanded() && row.treeExpand();
      });
      dmlTable.restoreRedraw();
    }
  });

  dmlTable.on('groupVisibilityChanged', (group: GroupComponent, _visible: boolean) => {
    const groupToFocus = group.getElement() ? group : findGroup(soqlTable, group.getKey());

    if (groupToFocus) {
      groupToFocus
        .getElement()
        .scrollIntoView({ behavior: 'instant', block: 'center', inline: 'start' });
    }
  });

  dmlTable.on('rowClick', function (e, row) {
    const data = row.getData();
    if (!(data.timestamp && data.dml)) {
      return;
    }

    const origRowHeight = row.getElement().offsetHeight;
    row.treeToggle();
    row.getCell('dml').getElement().style.height = origRowHeight + 'px';

    row &&
      row.getElement().scrollIntoView({ behavior: 'instant', block: 'center', inline: 'start' });
  });
}

function renderSOQLTable(soqlTableContainer: HTMLElement, soqlLines: SOQLExecuteBeginLine[]) {
  const timestampToSOQl = new Map<number, SOQLExecuteBeginLine>();
  interface GridSOQLData {
    isSelective?: boolean | null;
    relativeCost?: number | null;
    soql?: string;
    namespace?: string;
    rowCount?: number | null;
    timeTaken?: number | null;
    aggregations?: number;
    timestamp: number;
    isDetail?: boolean;
    _children?: GridSOQLData[];
  }

  soqlLines?.forEach((line) => {
    timestampToSOQl.set(line.timestamp, line);
  });

  const soqlData: GridSOQLData[] = [];
  if (soqlLines) {
    for (const soql of soqlLines) {
      const explainLine = soql.children[0] as SOQLExecuteExplainLine;
      soqlData.push({
        isSelective: explainLine?.relativeCost ? explainLine.relativeCost <= 1 : null,
        relativeCost: explainLine?.relativeCost,
        soql: soql.text,
        namespace: soql.namespace,
        rowCount: soql.rowCount.self,
        timeTaken: soql.duration.total,
        aggregations: soql.aggregations,
        timestamp: soql.timestamp,
        _children: [{ timestamp: soql.timestamp, isDetail: true }],
      });
    }
  }

  const soqlText = sortByFrequency(soqlData || [], 'soql');

  soqlTable = new Tabulator(soqlTableContainer, {
    height: '100%',
    rowKeyboardNavigation: true,
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
    groupHeader(value, count, data: GridSOQLData[], _group) {
      const hasDetail = data.some((d) => {
        return d.isDetail;
      });

      const newCount = hasDetail ? count - 1 : count;
      return `
      <div class="db-group-row">
        <div class="db-group-row__title" title="${value}">${value}</div><span>(${newCount} ${
          newCount > 1 ? 'Queries' : 'Query'
        })</span>
      </div>`;
    },
    groupToggleElement: 'header',

    selectableRowsCheck: function (row) {
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
      headerWordWrap: true,
    },
    initialSort: [{ column: 'rowCount', dir: 'desc' }],
    headerSortElement: function (column, dir) {
      switch (dir) {
        case 'asc':
          return "<div class='sort-by--top'></div>";
          break;
        case 'desc':
          return "<div class='sort-by--bottom'></div>";
          break;
        default:
          return "<div class='sort-by'><div class='sort-by--top'></div><div class='sort-by--bottom'></div></div>";
      }
    },
    columns: [
      {
        title: 'SOQL',
        field: 'soql',
        headerSortStartingDir: 'asc',
        sorter: 'string',
        tooltip: true,
        bottomCalc: () => {
          return 'Total';
        },
        cssClass: 'datagrid-textarea datagrid-code-text',
        variableHeight: true,
        formatter: (cell, _formatterParams, _onRendered) => {
          cell.getRow().normalizeHeight();

          const data = cell.getData() as GridSOQLData;
          return `<call-stack
          timestamp=${data.timestamp}
          startDepth="0"
          endDepth="1"
        ></call-stack>`;
        },
      },
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
          _value: unknown,
          data: GridSOQLData,
          _type: 'data' | 'download' | 'clipboard',
          _accessorParams: unknown,
          _column?: ColumnComponent,
          _row?: RowComponent,
        ): number | null | undefined {
          return data.relativeCost;
        },
        accessorClipboard: function (
          _value: unknown,
          data: GridSOQLData,
          _type: 'data' | 'download' | 'clipboard',
          _accessorParams: unknown,
          _column?: ColumnComponent,
          _row?: RowComponent,
        ): number | null | undefined {
          return data.relativeCost;
        },
      },
      {
        title: 'Namespace',
        field: 'namespace',
        sorter: 'string',
        cssClass: 'datagrid-code-text',
        width: 120,
        headerFilter: 'list',
        headerFilterFunc: 'in',
        headerFilterParams: {
          valuesLookup: 'all',
          clearable: true,
          multiselect: true,
        },
        headerFilterLiveFilter: false,
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

  soqlTable.on('groupClick', (e: UIEvent, group: GroupComponent) => {
    if (!group.isVisible()) {
      soqlTable.blockRedraw();
      soqlTable.getRows().forEach((row) => {
        !row.isTreeExpanded() && row.treeExpand();
      });
      soqlTable.restoreRedraw();
    }
  });

  soqlTable.on('groupVisibilityChanged', (group: GroupComponent, _visible: boolean) => {
    const groupToFocus = group.getElement() ? group : findGroup(soqlTable, group.getKey());

    if (groupToFocus) {
      groupToFocus
        .getElement()
        .scrollIntoView({ behavior: 'instant', block: 'center', inline: 'start' });
    }
  });

  soqlTable.on('rowClick', function (e, row) {
    const data = row.getData();
    if (!(data.timestamp && data.soql)) {
      return;
    }

    const origRowHeight = row.getElement().offsetHeight;
    row.treeToggle();
    row.getCell('soql').getElement().style.height = origRowHeight + 'px';

    row &&
      row.getElement().scrollIntoView({ behavior: 'instant', block: 'center', inline: 'start' });
  });
}

function createDetailPanel(timestamp: number) {
  const detailContainer = document.createElement('div');
  detailContainer.className = 'callstack-wrapper';
  render(html`<call-stack timestamp=${timestamp}></call-stack>`, detailContainer);

  return detailContainer;
}

function createSOQLDetailPanel(
  timestamp: number,
  timestampToSOQl: Map<number, SOQLExecuteBeginLine>,
) {
  const detailContainer = document.createElement('div');
  detailContainer.className = 'row__details-container';

  const soqlLine = timestampToSOQl.get(timestamp);
  render(
    html`<db-soql-detail-panel
      timestamp=${timestamp}
      soql=${soqlLine?.text}
    ></db-soql-detail-panel>`,
    detailContainer,
  );

  return detailContainer;
}

function sortByFrequency(dataArray: any[], field: string) {
  const map = new Map<string, number>();
  dataArray.forEach((val) => {
    map.set(val[field], (map.get(val[field]) || 0) + 1);
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

function findGroup(table: Tabulator, groupKey: string): GroupComponent | null | undefined {
  let foundGroup = null;
  const groups = soqlTable.getGroups();
  let len = groups?.length - 1 || 0;
  while (len >= 0 && !foundGroup) {
    const toSearch = groups[len];
    if (toSearch?.getKey() === groupKey) {
      foundGroup = toSearch;
      break;
    }
    len--;
  }
  return foundGroup;
}
