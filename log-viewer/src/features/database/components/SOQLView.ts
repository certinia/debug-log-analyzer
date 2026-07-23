/*
 * Copyright (c) 2022 Certinia Inc. All rights reserved.
 */
import '#vscode-elements/vscode-option.js';
import '../../../components/VsSelect.js';
import '#vscode-elements/vscode-toolbar-button.js';
import { LitElement, css, html, unsafeCSS, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import {
  Tabulator,
  type ColumnComponent,
  type GroupComponent,
  type RowComponent,
} from 'tabulator-tables';

import type { ApexLog, SOQLExecuteBeginLine } from 'apex-log-parser';
import { vscodeMessenger } from '../../../core/messaging/VSCodeExtensionMessenger.js';
import { isVisible } from '../../../core/utility/Util.js';
import { soqlGroupHeader } from '../../soql/format/groupHeader.js';
import { soqlSyntaxStyles } from '../../soql/styles/soql-syntax.css.js';
import { DatabaseAccess } from '../services/Database.js';

// Tabulator custom modules, imports + styles
import NumberAccessor from '../../../tabulator/dataaccessor/Number.js';
import Number from '../../../tabulator/format/Number.js';
import { GroupCalcs } from '../../../tabulator/groups/GroupCalcs.js';
import { GroupChildIndent } from '../../../tabulator/groups/GroupChildIndent.js';
import { GroupSort } from '../../../tabulator/groups/GroupSort.js';
import * as CommonModules from '../../../tabulator/module/CommonModules.js';
import { Find } from '../../../tabulator/module/Find.js';
import { RowKeyboardNavigation } from '../../../tabulator/module/RowKeyboardNavigation.js';
import { RowNavigation } from '../../../tabulator/module/RowNavigation.js';
import dataGridStyles from '../../../tabulator/style/DataGrid.scss';

// styles
import { globalStyles } from '../../../styles/global.styles.js';
import databaseViewStyles from './DatabaseView.scss';

// web components
import '../../../components/datagrid-filter-bar.js';
import './DatabaseSection.js';

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
  blockClearHighlights = true;

  get _soqlTableWrapper(): HTMLDivElement | null {
    return this.renderRoot?.querySelector('#db-soql-table');
  }

  constructor() {
    super();

    document.addEventListener('lv-find', this._findEvt);
    document.addEventListener('lv-find-close', this._findEvt);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener('lv-find', this._findEvt);
    document.removeEventListener('lv-find-close', this._findEvt);
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
    unsafeCSS(soqlSyntaxStyles),
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
    `,
  ];

  render() {
    const soqlSkeleton = !this.timelineRoot ? html`<grid-skeleton></grid-skeleton>` : ``;
    return html`
      <database-section title="SOQL Statements" .dbLines="${this.soqlLines}"></database-section>

      <datagrid-filter-bar>
        <vs-select
          slot="filters"
          id="soql-groupby-dropdown"
          prefix="Group"
          label="Group by"
          @change="${this._soqlGroupBy}"
        >
          <vscode-option>SOQL</vscode-option>
          <vscode-option>Namespace</vscode-option>
          <vscode-option>None</vscode-option>
        </vs-select>

        <div slot="actions">
          <vscode-toolbar-button
            icon="layout"
            label="Toggle details panel"
            title="Toggle details panel"
            @click=${this._toggleDetailPanel}
          ></vscode-toolbar-button>
          <vscode-toolbar-button
            icon="desktop-download"
            label="Export to CSV"
            title="Export to CSV"
            @click=${this._exportToCSV}
          ></vscode-toolbar-button>
          <vscode-toolbar-button
            icon="copy"
            label="Copy to clipboard"
            title="Copy to clipboard"
            @click=${this._copyToClipboard}
          ></vscode-toolbar-button>
        </div>
      </datagrid-filter-bar>

      <div id="soql-table-container">
        ${soqlSkeleton}
        <div id="db-soql-table"></div>
      </div>
    `;
  }

  _copyToClipboard() {
    this.soqlTable?.copyToClipboard('all');
  }

  _toggleDetailPanel() {
    document.dispatchEvent(new CustomEvent('db-toggle-panel'));
  }

  deselectRows() {
    this.soqlTable?.deselectRow();
  }

  _exportToCSV() {
    this.soqlTable?.download('csv', 'soql.csv', { bom: true, delimiter: ',' });
  }

  _findEvt = ((event: FindEvt) => {
    this._find(event);
  }) as EventListener;

  _soqlGroupBy(event: Event) {
    if (!this.soqlTable) {
      return;
    }
    const target = event.target as HTMLInputElement;
    const fieldName = target.value.toLowerCase();
    const groupValue = fieldName !== 'none' ? fieldName : '';
    //@ts-expect-error This is a custom function added in the GroupSort custom module
    this.soqlTable.setSortedGroupBy(groupValue);
  }

  _appendTableWhenVisible() {
    if (this.soqlTable) {
      return;
    }

    isVisible(this).then(async (isVisible) => {
      const treeRoot = this.timelineRoot;
      const tableWrapper = this._soqlTableWrapper;
      if (tableWrapper && treeRoot && isVisible) {
        this.soqlLines = (await DatabaseAccess.create(treeRoot)).getSOQLLines();

        Tabulator.registerModule(Object.values(CommonModules));
        Tabulator.registerModule([
          RowKeyboardNavigation,
          RowNavigation,
          Find,
          GroupCalcs,
          GroupChildIndent,
          GroupSort,
        ]);
        this._renderSOQLTable(tableWrapper, this.soqlLines);
      }
    });
  }

  async _highlightMatches(highlightIndex: number) {
    if (!this.soqlTable?.element?.clientHeight) {
      return;
    }

    this.findArgs.count = highlightIndex;
    const currentRow = this.findMap[highlightIndex];
    this.blockClearHighlights = true;
    //@ts-expect-error This is a custom function added in by Find custom module
    await this.soqlTable.setCurrentMatch(highlightIndex, currentRow, {
      scrollIfVisible: false,
      focusRow: false,
    });
    this.blockClearHighlights = false;

    this.oldIndex = highlightIndex;
  }

  async _find(e: CustomEvent<{ text: string; count: number; options: { matchCase: boolean } }>) {
    const isTableVisible = !!this.soqlTable?.element?.clientHeight;
    if (!isTableVisible && !this.totalMatches) {
      return;
    }

    const newFindArgs = JSON.parse(JSON.stringify(e.detail));
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
      const result = await this.soqlTable.find(this.findArgs);
      this.blockClearHighlights = false;
      this.totalMatches = result.totalMatches;
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
    let nextRowId = 0;

    const soqlData: GridSOQLData[] = [];
    if (soqlLines) {
      for (const soql of soqlLines) {
        const explainLine = soql.children[0];
        soqlData.push({
          id: ++nextRowId,
          isSelective: explainLine?.relativeCost ? explainLine.relativeCost <= 1 : null,
          relativeCost: explainLine?.relativeCost,
          soql: soql.text,
          namespace: soql.namespace,
          rowCount: soql.soqlRowCount.self,
          timeTaken: soql.duration.total,
          aggregations: soql.aggregations,
          eventIndex: soql.eventIndex,
        });
      }
    }

    this.soqlTable = new Tabulator(soqlTableContainer, {
      index: 'id',
      height: '100%',
      rowKeyboardNavigation: true,
      data: soqlData,
      layout: 'fitColumns',
      placeholder: 'No SOQL queries found',
      columnCalcs: 'table',
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
      groupCalcs: true,
      groupHeader: soqlGroupHeader,
      groupSort: true,
      groupClosedShowCalcs: true,
      groupStartOpen: false,
      groupToggleElement: false,
      selectableRows: 'highlight',
      columnDefaults: {
        title: 'default',
        resizable: true,
        headerSortStartingDir: 'desc',
        headerTooltip: true,
        headerWordWrap: true,
      },
      headerSortElement: function (_column, dir) {
        switch (dir) {
          case 'asc':
            return "<div class='sort-by--top'></div>";
          case 'desc':
            return "<div class='sort-by--bottom'></div>";
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
          headerSortTristate: true,
          cssClass: 'datagrid-code-text',
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
          tooltip: function (_e, cell, _onRendered) {
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
          cssClass: 'number-cell',
          width: 100,
          hozAlign: 'right',
          headerHozAlign: 'right',
          bottomCalc: 'sum',
        },
        {
          title: 'Time Taken (ms)',
          field: 'timeTaken',
          sorter: 'number',
          cssClass: 'number-cell',
          width: 120,
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
        {
          title: 'Aggregations',
          field: 'aggregations',
          sorter: 'number',
          cssClass: 'number-cell',
          width: 100,
          hozAlign: 'right',
          headerHozAlign: 'right',
          bottomCalc: 'sum',
        },
      ],
    });

    this.soqlTable.on('groupClick', (_e: UIEvent, group: GroupComponent) => {
      const { type } = window.getSelection() ?? {};
      if (type === 'Range') {
        return;
      }
      group.toggle();
    });

    // Drive the detail panel off selection (not click) so keyboard row
    // navigation updates it too. RowKeyboardNavigation keeps a single row
    // selected across mouse and arrow-key navigation.
    this.soqlTable.on('rowSelectionChanged', (_data, rows) => {
      const data = rows[0]?.getData() as GridSOQLData | undefined;
      if (!data || data.eventIndex === undefined || !data.soql) {
        return;
      }

      document.dispatchEvent(
        new CustomEvent('db-row-select', {
          detail: { eventIndex: data.eventIndex, type: 'soql' },
        }),
      );
    });

    this.soqlTable.on('tableBuilt', () => {
      const holder = this._getTableHolder();
      holder.style.overflowAnchor = 'none';
      //@ts-expect-error This is a custom function added in the GroupSort custom module
      this.soqlTable?.setSortedGroupBy('soql');
    });

    this.soqlTable.on('dataSorted', () => {
      if (!this.blockClearHighlights && this.totalMatches > 0) {
        this._resetFindWidget();
        this._clearSearchHighlights();
      }
    });

    this.soqlTable.on('dataGrouped', () => {
      if (!this.blockClearHighlights && this.totalMatches > 0) {
        this._resetFindWidget();
        this._clearSearchHighlights();
      }
    });

    this.soqlTable.on('dataFiltering', () => {
      if (!this.blockClearHighlights && this.totalMatches > 0) {
        this._resetFindWidget();
        this._clearSearchHighlights();
      }
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
    this.findArgs.text = '';
    this.findArgs.count = 0;
    //@ts-expect-error This is a custom function added in by Find custom module
    this.soqlTable.clearFindHighlights();
    this.findMap = {};
    this.totalMatches = 0;

    document.dispatchEvent(
      new CustomEvent('db-find-results', {
        detail: { totalMatches: this.totalMatches, type: 'soql' },
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
  id: number;
  isSelective?: boolean | null;
  relativeCost?: number | null;
  soql?: string;
  namespace?: string;
  rowCount?: number | null;
  timeTaken?: number | null;
  aggregations?: number;
  eventIndex?: number;
}

type FindEvt = CustomEvent<{ text: string; count: number; options: { matchCase: boolean } }>;
