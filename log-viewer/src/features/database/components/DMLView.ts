/*
 * Copyright (c) 2022 Certinia Inc. All rights reserved.
 */
import {
  provideVSCodeDesignSystem,
  vsCodeButton,
  vsCodeCheckbox,
} from '@vscode/webview-ui-toolkit';
import { LitElement, css, html, render, unsafeCSS, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { Tabulator, type GroupComponent, type RowComponent } from 'tabulator-tables';

import type { ApexLog, DMLBeginLine } from 'apex-log-parser';
import { vscodeMessenger } from '../../../core/messaging/VSCodeExtensionMessenger.js';
import { isVisible } from '../../../core/utility/Util.js';
import { DatabaseAccess } from '../services/Database.js';

// Tabulator custom modules, imports + styles
import NumberAccessor from '../../../tabulator/dataaccessor/Number.js';
import Number from '../../../tabulator/format/Number.js';
import { GroupCalcs } from '../../../tabulator/groups/GroupCalcs.js';
import { GroupSort } from '../../../tabulator/groups/GroupSort.js';
import * as CommonModules from '../../../tabulator/module/CommonModules.js';
import { Find, formatter } from '../../../tabulator/module/Find.js';
import { RowKeyboardNavigation } from '../../../tabulator/module/RowKeyboardNavigation.js';
import { RowNavigation } from '../../../tabulator/module/RowNavigation.js';
import dataGridStyles from '../../../tabulator/style/DataGrid.scss';

// styles
import codiconStyles from '../../../styles/codicon.css';
import { globalStyles } from '../../../styles/global.styles.js';
import databaseViewStyles from './DatabaseView.scss';

// web components
import '../../../components/CallStack.js';
import '../../../components/datagrid-filter-bar.js';
import './DatabaseSection.js';

provideVSCodeDesignSystem().register(vsCodeButton(), vsCodeCheckbox());

@customElement('dml-view')
export class DMLView extends LitElement {
  @property()
  timelineRoot: ApexLog | null = null;

  @property()
  highlightIndex: number = 0;

  @property()
  oldIndex: number = 0;

  @state()
  dmlLines: DMLBeginLine[] = [];

  dmlTable: Tabulator | null = null;
  holder: HTMLElement | null = null;
  table: HTMLElement | null = null;
  findArgs: { text: string; count: number; options: { matchCase: boolean } } = {
    text: '',
    count: 0,
    options: { matchCase: false },
  };
  findMap: { [key: number]: RowComponent } = {};
  totalMatches = 0;
  blockClearHighlights = true;

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
    unsafeCSS(codiconStyles),
    globalStyles,
    css`
      :host {
        --button-icon-hover-background: var(--vscode-toolbar-hoverBackground);

        display: flex;
        flex-direction: column;
        width: 100%;
      }

      #dml-table-container {
        height: 100%;
      }

      #db-dml-table {
        overflow: hidden;
        table-layout: fixed;
        width: 100%;
        margin-bottom: 1rem;
      }
    `,
  ];

  render() {
    const dmlSkeleton = !this.timelineRoot ? html`<grid-skeleton></grid-skeleton>` : ``;

    return html`
      <database-section title="DML Statements" .dbLines="${this.dmlLines}"></database-section>

      <datagrid-filter-bar>
        <div slot="filters">
          <strong>Group by</strong>
          <div>
            <vscode-checkbox @change="${this._dmlGroupBy}" checked>DML</vscode-checkbox>
          </div>
        </div>

        <div slot="actions">
          <vscode-button
            appearance="icon"
            aria-label="Export to CSV"
            title="Export to CSV"
            @click=${this._exportToCSV}
          >
            <span class="codicon codicon-desktop-download"></span>
          </vscode-button>
          <vscode-button
            appearance="icon"
            aria-label="Copy to clipboard"
            title="Copy to clipboard"
            @click=${this._copyToClipboard}
          >
            <span class="codicon codicon-copy"></span>
          </vscode-button>
        </div>
      </datagrid-filter-bar>

      <div id="dml-table-container">
        ${dmlSkeleton}
        <div id="db-dml-table"></div>
      </div>
    `;
  }

  _copyToClipboard() {
    this.dmlTable?.copyToClipboard('all');
  }

  _exportToCSV() {
    this.dmlTable?.download('csv', 'dml.csv', { bom: true, delimiter: ',' });
  }

  _findEvt = ((event: FindEvt) => {
    this._find(event);
  }) as EventListener;

  _dmlGroupBy(event: Event) {
    const target = event.target as HTMLInputElement;
    //@ts-expect-error This is a custom function added in the GroupSort custom module
    this.dmlTable?.setSortedGroupBy(target.checked ? 'dml' : '');
  }

  get _dmlTableWrapper(): HTMLDivElement | null {
    return this.renderRoot?.querySelector('#db-dml-table');
  }

  _appendTableWhenVisible() {
    if (this.dmlTable) {
      return;
    }

    isVisible(this).then(async (isVisible) => {
      const treeRoot = this.timelineRoot;
      const tableWrapper = this._dmlTableWrapper;
      if (tableWrapper && treeRoot && isVisible) {
        const dbAccess = await DatabaseAccess.create(treeRoot);
        this.dmlLines = dbAccess.getDMLLines();

        Tabulator.registerModule(Object.values(CommonModules));
        Tabulator.registerModule([
          RowKeyboardNavigation,
          RowNavigation,
          Find,
          GroupCalcs,
          GroupSort,
        ]);
        this._renderDMLTable(tableWrapper, this.dmlLines);
      }
    });
  }

  // todo: fix search on grouped data
  _highlightMatches(highlightIndex: number) {
    if (!this.dmlTable?.element?.clientHeight) {
      return;
    }

    this.findArgs.count = highlightIndex;
    const currentRow = this.findMap[highlightIndex];
    const rows = [currentRow, this.findMap[this.oldIndex]];
    this.blockClearHighlights = true;
    this.dmlTable.blockRedraw();
    rows.forEach((row) => {
      row?.reformat();
    });
    if (currentRow) {
      //@ts-expect-error This is a custom function added in by RowNavigation custom module
      this.dmlTable.goToRow(currentRow, { scrollIfVisible: false, focusRow: false });
    }
    this.dmlTable.restoreRedraw();
    this.blockClearHighlights = false;
    this.oldIndex = highlightIndex;
  }

  async _find(e: CustomEvent<{ text: string; count: number; options: { matchCase: boolean } }>) {
    const isTableVisible = !!this.dmlTable?.element?.clientHeight;
    if (!isTableVisible && !this.totalMatches) {
      return;
    }

    const newFindArgs = JSON.parse(JSON.stringify(e.detail));
    if (!isTableVisible) {
      newFindArgs.text = '';
    }

    const newSearch =
      newFindArgs.text !== this.findArgs.text ||
      newFindArgs.options.matchCase !== this.findArgs.options?.matchCase;
    this.findArgs = newFindArgs;

    const clearHighlights = e.type === 'lv-find-close';
    if (clearHighlights) {
      newFindArgs.text = '';
    }
    if (newSearch || clearHighlights) {
      this.blockClearHighlights = true;
      //@ts-expect-error This is a custom function added in by Find custom module
      const result = await this.dmlTable.find(this.findArgs);
      this.blockClearHighlights = false;
      this.totalMatches = result.totalMatches;
      this.findMap = result.matchIndexes;

      if (!clearHighlights) {
        document.dispatchEvent(
          new CustomEvent('db-find-results', {
            detail: { totalMatches: result.totalMatches, type: 'dml' },
          }),
        );
      }
    }
  }

  _renderDMLTable(dmlTableContainer: HTMLElement, dmlLines: DMLBeginLine[]) {
    const dmlData: DMLRow[] = [];
    if (dmlLines) {
      for (const dml of dmlLines) {
        dmlData.push({
          dml: dml.text,
          rowCount: dml.dmlRowCount.self,
          timeTaken: dml.duration.total,
          timestamp: dml.timestamp,
          _children: [{ timestamp: dml.timestamp, isDetail: true }],
        });
      }
    }

    this.dmlTable = new Tabulator(dmlTableContainer, {
      height: '100%',
      clipboard: true,
      downloadEncoder: this.downlodEncoder('dml.csv'),
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
      columnCalcs: 'table',
      groupCalcs: true,
      groupSort: true,
      groupClosedShowCalcs: true,
      groupStartOpen: false,
      groupToggleElement: false,
      selectableRowsCheck: function (row: RowComponent) {
        return !row.getData().isDetail;
      },
      selectableRows: 'highlight',
      dataTree: true,
      dataTreeBranchElement: false,
      dataTreeStartExpanded: false,
      columnDefaults: {
        title: 'default',
        resizable: true,
        headerSortStartingDir: 'desc',
        headerTooltip: true,
        headerWordWrap: true,
      },
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
          headerSortTristate: true,
          cssClass: 'datagrid-textarea datagrid-code-text',
          variableHeight: true,
          formatter: (cell, _formatterParams, _onRendered) => {
            const data = cell.getData() as DMLRow;
            return `<call-stack
            timestamp="${data.timestamp}"
            startDepth="0"
            endDepth="1"
          ></call-stack>`;
          },
        },
        {
          title: 'Row Count',
          field: 'rowCount',
          sorter: 'number',
          cssClass: 'number-cell',
          width: 90,
          bottomCalc: 'sum',
          hozAlign: 'right',
          headerHozAlign: 'right',
        },
        {
          title: 'Time Taken (ms)',
          field: 'timeTaken',
          sorter: 'number',
          cssClass: 'number-cell',
          width: 110,
          hozAlign: 'right',
          headerHozAlign: 'right',
          formatter: Number,
          formatterParams: {
            thousand: false,
            precision: 2,
          },
          accessorDownload: NumberAccessor,
          bottomCalcFormatter: Number,
          bottomCalc: 'sum',
          bottomCalcFormatterParams: { precision: 2 },
        },
      ],
      rowFormatter: (row) => {
        const data = row.getData();
        if (data.isDetail && data.timestamp) {
          const detailContainer = this.createDetailPanel(data.timestamp);
          row.getElement().replaceChildren(detailContainer);
        }

        requestAnimationFrame(() => {
          formatter(row, this.findArgs);
        });
      },
    });

    this.dmlTable.on('groupClick', (e: UIEvent, group: GroupComponent) => {
      const { type } = window.getSelection() ?? {};
      if (type === 'Range') {
        return;
      }

      group.toggle();
      if (this.dmlTable && group.isVisible()) {
        this.dmlTable.blockRedraw();
        for (const row of group.getRows()) {
          if (row.getTreeChildren() && !row.isTreeExpanded()) {
            row.treeExpand();
          }
        }
        this.dmlTable.restoreRedraw();
      }
    });

    this.dmlTable.on('rowClick', function (e, row) {
      const { type } = window.getSelection() ?? {};
      if (type === 'Range') {
        return;
      }

      const data = row.getData();
      if (!(data.timestamp && data.dml)) {
        return;
      }

      const origRowHeight = row.getElement().offsetHeight;
      row.treeToggle();
      row.getCell('dml').getElement().style.height = origRowHeight + 'px';
    });

    this.dmlTable.on('tableBuilt', () => {
      const holder = this._getTableHolder();
      holder.style.overflowAnchor = 'none';
      //@ts-expect-error This is a custom function added in the GroupSort custom module
      this.dmlTable?.setSortedGroupBy('dml');
    });

    this.dmlTable.on('renderComplete', () => {
      const holder = this._getTableHolder();
      const table = this._getTable();
      holder.style.minHeight = Math.min(holder.clientHeight, table.clientHeight) + 'px';
    });

    this.dmlTable.on('dataSorted', () => {
      if (!this.blockClearHighlights && this.totalMatches > 0) {
        this._resetFindWidget();
        this._clearSearchHighlights();
      }
    });

    this.dmlTable.on('dataGrouped', () => {
      if (!this.blockClearHighlights && this.totalMatches > 0) {
        this._resetFindWidget();
        this._clearSearchHighlights();
      }
    });

    this.dmlTable.on('dataFiltering', () => {
      if (!this.blockClearHighlights && this.totalMatches > 0) {
        this._resetFindWidget();
        this._clearSearchHighlights();
      }
    });
  }

  _resetFindWidget() {
    document.dispatchEvent(
      new CustomEvent('db-find-results', {
        detail: { totalMatches: 0, type: 'dml' },
      }),
    );
  }

  private _clearSearchHighlights() {
    this.findArgs.text = '';
    this.findArgs.count = 0;
    //@ts-expect-error This is a custom function added in by Find custom module
    this.dmlTable.clearFindHighlights(Object.values(this.findMap));
    this.findMap = {};
    this.totalMatches = 0;

    document.dispatchEvent(
      new CustomEvent('db-find-results', {
        detail: { totalMatches: this.totalMatches, type: 'dml' },
      }),
    );
  }

  _getTable() {
    this.table ??= this.dmlTable?.element.querySelector('.tabulator-table') as HTMLElement;
    return this.table;
  }

  _getTableHolder() {
    this.holder = this.dmlTable?.element.querySelector('.tabulator-tableholder') as HTMLElement;
    return this.holder;
  }

  createDetailPanel(timestamp: number) {
    const detailContainer = document.createElement('div');
    detailContainer.className = 'row__details-container';
    render(html`<call-stack timestamp=${timestamp}></call-stack>`, detailContainer);

    return detailContainer;
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

interface DMLRow {
  dml?: string;
  rowCount?: number;
  timeTaken?: number;
  timestamp: number;
  isDetail?: boolean;
  _children?: DMLRow[];
}

type FindEvt = CustomEvent<{ text: string; count: number; options: { matchCase: boolean } }>;
