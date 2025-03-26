/*
 * Copyright (c) 2022 Certinia Inc. All rights reserved.
 */
import {
  provideVSCodeDesignSystem,
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
import { isVisible } from '../../Util.js';
import NumberAccessor from '../../datagrid/dataaccessor/Number.js';
import Number from '../../datagrid/format/Number.js';
import { RowKeyboardNavigation } from '../../datagrid/module/RowKeyboardNavigation.js';
import { RowNavigation } from '../../datagrid/module/RowNavigation.js';
import dataGridStyles from '../../datagrid/style/DataGrid.scss';
import {
  ApexLog,
  SOQLExecuteBeginLine,
  SOQLExecuteExplainLine,
} from '../../parsers/ApexLogParser.js';
import { vscodeMessenger } from '../../services/VSCodeExtensionMessenger.js';
import { globalStyles } from '../../styles/global.styles.js';
import { Find, formatter } from '../calltree-view/module/Find.js';
import databaseViewStyles from './DatabaseView.scss';

// lit components
import '../CallStack.js';
import './DatabaseSOQLDetailPanel.js';
import './DatabaseSection.js';

provideVSCodeDesignSystem().register(vsCodeDropdown(), vsCodeOption());

@customElement('soql-view')
export class SOQLView extends LitElement {
  @property()
  timelineRoot: ApexLog | null = null;

  @property()
  highlightIndex: number = 0;

  @state()
  oldIndex: number = 0;

  @state()
  soqlLines: SOQLExecuteBeginLine[] = [];

  soqlTable: Tabulator | null = null;
  holder: HTMLElement | null = null;
  table: HTMLElement | null = null;
  findArgs: { text: string; count: number; options: { matchCase: boolean } } = {
    text: '',
    count: 0,
    options: { matchCase: false },
  };
  findMap: { [key: number]: RowComponent } = {};
  totalMatches = 0;

  get _soqlTableWrapper(): HTMLDivElement | null {
    return this.renderRoot?.querySelector('#db-soql-table') ?? null;
  }

  constructor() {
    super();

    document.addEventListener('lv-find', this._findEvt);
    document.addEventListener('lv-find-close', this._findEvt);
  }

  updated(changedProperties: PropertyValues): void {
    if (
      this.timelineRoot &&
      changedProperties.has('timelineRoot') &&
      !changedProperties.get('timelineRoot')
    ) {
      this._appendTableWhenVisible();
    }

    if (changedProperties.has('highlightIndex')) {
      this._highlightMatches(this.highlightIndex);
    }
  }

  static styles = [
    unsafeCSS(dataGridStyles),
    unsafeCSS(databaseViewStyles),
    globalStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        width: 100%;
      }

      #soql-table-container {
        height: 100%;
      }

      #db-soql-table {
        overflow: hidden;
        table-layout: fixed;
        margin-bottom: 1rem;
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
    const soqlSkeleton = !this.timelineRoot ? html`<grid-skeleton></grid-skeleton>` : ``;
    return html`
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
    `;
  }

  _findEvt = ((event: FindEvt) => this._find(event)) as EventListener;

  _soqlGroupBy(event: Event) {
    const target = event.target as HTMLInputElement;
    const fieldName = target.value.toLowerCase();
    const groupValue = fieldName !== 'none' ? fieldName : '';
    if (!this.soqlTable) {
      return;
    }

    this.soqlTable.setGroupValues([
      groupValue
        ? this.sortByFrequency(this.soqlTable.getData(), groupValue as keyof GridSOQLData)
        : [''],
    ]);
    this.soqlTable.setGroupBy(groupValue);
  }

  _appendTableWhenVisible() {
    if (this.soqlTable) {
      return;
    }

    isVisible(this).then(async (isVisible) => {
      const treeRoot = this.timelineRoot;
      const tableWrapper = this._soqlTableWrapper;
      if (tableWrapper && treeRoot && isVisible) {
        this.soqlLines = (await DatabaseAccess.create(treeRoot)).getSOQLLines() || [];

        Tabulator.registerModule(Object.values(CommonModules));
        Tabulator.registerModule([RowKeyboardNavigation, RowNavigation, Find]);
        this._renderSOQLTable(tableWrapper, this.soqlLines);
      }
    });
  }

  _highlightMatches(highlightIndex: number) {
    if (!this.soqlTable?.element?.clientHeight) {
      return;
    }

    this.findArgs.count = highlightIndex;
    const currentRow = this.findMap[highlightIndex];
    const rows = [currentRow, this.findMap[this.oldIndex]];
    rows.forEach((row) => {
      row?.reformat();
    });

    if (currentRow) {
      //@ts-expect-error This is a custom function added in by RowNavigation custom module
      this.soqlTable.goToRow(currentRow, { scrollIfVisible: false, focusRow: false });
    }

    this.oldIndex = highlightIndex;
  }

  _find(e: CustomEvent<{ text: string; count: number; options: { matchCase: boolean } }>) {
    const isTableVisible = !!this.soqlTable?.element?.clientHeight;
    if (!isTableVisible && !this.totalMatches) {
      return;
    }

    const newFindArgs = JSON.parse(JSON.stringify(e.detail));
    const newSearch =
      newFindArgs.text !== this.findArgs.text ||
      newFindArgs.options.matchCase !== this.findArgs.options?.matchCase;
    this.findArgs = newFindArgs;

    const clearHighlights =
      e.type === 'lv-find-close' || (!isTableVisible && newFindArgs.count === 0);
    if (clearHighlights) {
      newFindArgs.text = '';
    }
    if (newSearch || clearHighlights) {
      //@ts-expect-error This is a custom function added in by Find custom module
      const result = this.soqlTable.find(this.findArgs);
      this.totalMatches = 0;
      this.findMap = result.matchIndexes;

      if (!clearHighlights) {
        document.dispatchEvent(
          new CustomEvent('db-find-results', {
            detail: { totalMatches: result.totalMatches, type: 'soql' },
          }),
        );
      }
    }
  }

  _renderSOQLTable(soqlTableContainer: HTMLElement, soqlLines: SOQLExecuteBeginLine[]) {
    const timestampToSOQl = new Map<number, SOQLExecuteBeginLine>();

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

    const soqlText = this.sortByFrequency(soqlData || [], 'soql');

    this.soqlTable = new Tabulator(soqlTableContainer, {
      height: '100%',
      rowKeyboardNavigation: true,
      data: soqlData,
      layout: 'fitColumns',
      placeholder: 'No SOQL queries found',
      columnCalcs: 'both',
      clipboard: true,
      downloadEncoder: this.downlodEncoder('soql.csv'),
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
      groupToggleElement: false,
      selectableRows: 'highlight',
      selectableRowsCheck: function (row: RowComponent) {
        return !row.getData().isDetail;
      },
      dataTree: true,
      dataTreeBranchElement: false,
      columnDefaults: {
        title: 'default',
        resizable: true,
        headerSortStartingDir: 'desc',
        headerTooltip: true,
        headerMenu: this.csvheaderMenu('soql.csv'),
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
      rowFormatter: (row) => {
        const data = row.getData();
        if (data.isDetail && data.timestamp) {
          const detailContainer = this.createSOQLDetailPanel(data.timestamp, timestampToSOQl);

          row.getElement().replaceChildren(detailContainer);
          row.normalizeHeight();
        }

        formatter(row, this.findArgs);
      },
    });

    this.soqlTable.on('tableBuilt', () => {
      this.soqlTable?.setGroupBy('soql');
    });

    this.soqlTable.on('groupClick', (e: UIEvent, group: GroupComponent) => {
      const { type } = window.getSelection() ?? {};
      if (type === 'Range') {
        return;
      }

      this.soqlTable?.blockRedraw();
      group.toggle();
      if (!group.isVisible()) {
        this.soqlTable?.getRows().forEach((row) => {
          if (!row.isTreeExpanded()) {
            row.treeExpand();
          }
        });
      }
      this.soqlTable?.restoreRedraw();
    });

    this.soqlTable.on('rowClick', function (e, row) {
      const { type } = window.getSelection() ?? {};
      if (type === 'Range') {
        return;
      }

      const data = row.getData();
      if (!(data.timestamp && data.soql)) {
        return;
      }

      const origRowHeight = row.getElement().offsetHeight;
      row.treeToggle();
      row.getCell('soql').getElement().style.height = origRowHeight + 'px';
    });

    this.soqlTable.on('dataFiltering', () => {
      this._resetFindWidget();
      this._clearSearchHighlights();
    });

    this.soqlTable.on('renderStarted', () => {
      const holder = this._getTableHolder();
      holder.style.minHeight = holder.clientHeight + 'px';
      holder.style.overflowAnchor = 'none';
    });

    this.soqlTable.on('renderComplete', () => {
      const holder = this._getTableHolder();
      const table = this._getTable();
      holder.style.minHeight = Math.min(holder.clientHeight, table.clientHeight) + 'px';
    });
  }

  _resetFindWidget() {
    document.dispatchEvent(
      new CustomEvent('db-find-results', {
        detail: { totalMatches: 0, type: 'soql' },
      }),
    );
  }

  _clearSearchHighlights() {
    this._find(
      new CustomEvent('lv-find', {
        detail: { text: '', count: 0, options: { matchCase: false } },
      }),
    );
  }

  _getTable() {
    this.table ??= this.soqlTable?.element.querySelector('.tabulator-table') as HTMLElement;
    return this.table;
  }

  _getTableHolder() {
    this.holder ??= this.soqlTable?.element.querySelector('.tabulator-tableholder') as HTMLElement;
    return this.holder;
  }

  createSOQLDetailPanel(timestamp: number, timestampToSOQl: Map<number, SOQLExecuteBeginLine>) {
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

  sortByFrequency(dataArray: GridSOQLData[], field: keyof GridSOQLData) {
    const map = new Map<unknown, number>();
    dataArray.forEach((row) => {
      const val = row[field];
      map.set(val, (map.get(val) || 0) + 1);
    });
    const newMap = new Map([...map.entries()].sort((a, b) => b[1] - a[1]));

    return [...newMap.keys()];
  }

  csvheaderMenu(csvFileName: string) {
    return [
      {
        label: 'Export to CSV',
        action: function (_e: PointerEvent, column: ColumnComponent) {
          column.getTable().download('csv', csvFileName, { bom: true, delimiter: ',' });
        },
      },
    ];
  }

  downlodEncoder(defaultFileName: string) {
    return function (fileContents: string, mimeType: string) {
      const vscode = vscodeMessenger.getVsCodeAPI();
      if (vscode) {
        vscodeMessenger.send<VSCodeSaveFile>('saveFile', {
          fileContent: fileContents,
          options: {
            defaultFileName: defaultFileName,
          },
        });
        return false;
      }

      return new Blob([fileContents], { type: mimeType });
    };
  }
}

type VSCodeSaveFile = {
  fileContent: string;
  options: {
    defaultFileName: string;
  };
};

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

type FindEvt = CustomEvent<{ text: string; count: number; options: { matchCase: boolean } }>;
