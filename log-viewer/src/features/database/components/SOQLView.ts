/*
 * Copyright (c) 2022 Certinia Inc. All rights reserved.
 */
import '#vscode-elements/vscode-option.js';
import '../../../components/VsSelect.js';
import '#vscode-elements/vscode-toolbar-button.js';
import { LitElement, css, html, render, unsafeCSS, type PropertyValues } from 'lit';
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
import { getCallerNamespace } from '../../../core/utility/CallerNamespace.js';
import { soqlGroupHeader } from '../../soql/format/groupHeader.js';
import { soqlSyntaxStyles } from '../../soql/styles/soql-syntax.css.js';
import { getSettings, updateSetting } from '../../settings/Settings.js';
import { DatabaseAccess } from '../services/Database.js';
import {
  applyColumnView,
  buildColumnMenuItems,
  getColumnView,
  getTableFields,
  SOQL_VIEWS,
  toggleField,
} from '../../../tabulator/ColumnViews.js';

// Tabulator custom modules, imports + styles
import NumberAccessor from '../../../tabulator/dataaccessor/Number.js';
import Number from '../../../tabulator/format/Number.js';
import { progressFormatter } from '../../../tabulator/format/Progress.js';
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
import '../../../components/CallStack.js';
import '../../../components/ContextMenu.js';
import type { ContextMenu } from '../../../components/ContextMenu.js';
import '../../../components/datagrid-filter-bar.js';
import './DatabaseSOQLDetailPanel.js';
import './DatabaseSection.js';

/** The SOQL column is always shown in the SOQL table. */
const ALWAYS_VISIBLE = ['soql'];

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

  @state()
  columnView = 'General';

  /** Per-view column overrides (view id → visible fields); empty until edited. */
  @state()
  private columnOverrides: Record<string, string[]> = {};
  private contextMenu: ContextMenu | null = null;
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

  firstUpdated(): void {
    this.contextMenu = this.renderRoot.querySelector('context-menu');
    void this._loadColumnSettings();
  }

  private async _loadColumnSettings(): Promise<void> {
    const settings = await getSettings();
    this.columnOverrides = settings.database?.soql?.columnOverrides ?? {};
    this._setColumnView(settings.database?.soql?.columnView ?? 'General');
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
          slot="table-actions"
          id="soql-column-view"
          prefix="Columns"
          label="Column view"
          @change="${this._handleColumnViewChange}"
          @vs-reset-option="${this._onResetOption}"
          .value="${this.columnView}"
          .resettableValues="${Object.keys(this.columnOverrides)}"
        >
          ${SOQL_VIEWS.map(
            (view) =>
              html`<vscode-option value="${view.id}" ?selected="${this.columnView === view.id}"
                >${view.id}</vscode-option
              >`,
          )}
        </vs-select>

        <vs-select
          slot="group"
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
            icon="list-selection"
            label="Columns"
            title="Columns"
            @click=${this._openColumnMenu}
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
      <context-menu @menu-select="${this._handleColumnMenuSelect}"></context-menu>
    `;
  }

  private _handleColumnViewChange(event: Event) {
    const id = (event.target as HTMLInputElement).value || 'General';
    this._setColumnView(id);
    updateSetting('database.soql.columnView', id);
  }

  /** Effective fields for a view id: the user override, else the built-in preset. */
  private _columnViewFields(id: string): string[] | null {
    return this.columnOverrides[id] ?? getColumnView(SOQL_VIEWS, id)?.fields ?? null;
  }

  private _setColumnView(id: string) {
    this.columnView = id;
    if (this.soqlTable) {
      applyColumnView(this.soqlTable, this._columnViewFields(id), ALWAYS_VISIBLE);
    }
  }

  /** Applies the active view and wires the header menu once the table is built. */
  private _initTableColumns(table: Tabulator) {
    applyColumnView(table, this._columnViewFields(this.columnView), ALWAYS_VISIBLE);
    const header = table.element.querySelector<HTMLElement>('.tabulator-header');
    header?.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      this._showColumnMenu(event.clientX, event.clientY);
    });
  }

  private _showColumnMenu(x: number, y: number) {
    if (!this.contextMenu || !this.soqlTable) {
      return;
    }
    this.contextMenu.show(
      buildColumnMenuItems(
        this.soqlTable,
        this.columnView,
        SOQL_VIEWS,
        ALWAYS_VISIBLE,
        Object.keys(this.columnOverrides),
      ),
      x,
      y,
    );
  }

  private _openColumnMenu(event: Event) {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this._showColumnMenu(rect.left, rect.bottom);
  }

  /** Rebuilds the open column menu so checkmarks/reset icons reflect current state. */
  private _refreshColumnMenu() {
    if (!this.contextMenu?.isVisible() || !this.soqlTable) {
      return;
    }
    this.contextMenu.items = buildColumnMenuItems(
      this.soqlTable,
      this.columnView,
      SOQL_VIEWS,
      ALWAYS_VISIBLE,
      Object.keys(this.columnOverrides),
    );
  }

  private _handleColumnMenuSelect(e: CustomEvent<{ itemId: string }>) {
    const { itemId } = e.detail;
    const table = this.soqlTable;
    if (!table) {
      return;
    }
    if (itemId.startsWith('view:')) {
      const id = itemId.slice('view:'.length);
      this._setColumnView(id);
      updateSetting('database.soql.columnView', id);
      this._refreshColumnMenu();
      return;
    }
    if (itemId.startsWith('col:')) {
      const field = itemId.slice('col:'.length);
      const fields = toggleField(
        this._columnViewFields(this.columnView),
        field,
        getTableFields(table),
      );
      this.columnOverrides = { ...this.columnOverrides, [this.columnView]: fields };
      applyColumnView(table, fields, ALWAYS_VISIBLE);
      updateSetting('database.soql.columnOverrides', this.columnOverrides);
      this._refreshColumnMenu();
      return;
    }
    if (itemId.startsWith('reset:')) {
      this._resetColumns(itemId.slice('reset:'.length));
      this._refreshColumnMenu();
    }
  }

  private _onResetOption(event: CustomEvent<{ value: string }>) {
    this._resetColumns(event.detail.value);
  }

  /** Clears a view's override, restoring its built-in columns (defaults to the active view). */
  private _resetColumns(id: string = this.columnView) {
    const table = this.soqlTable;
    if (!table || !this.columnOverrides[id]) {
      return;
    }
    const { [id]: _removed, ...rest } = this.columnOverrides;
    this.columnOverrides = rest;
    if (id === this.columnView) {
      applyColumnView(table, this._columnViewFields(id), ALWAYS_VISIBLE);
    }
    updateSetting('database.soql.columnOverrides', this.columnOverrides);
  }

  _copyToClipboard() {
    this.soqlTable?.copyToClipboard('all');
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
    const eventIndexToSOQL = new Map<number, SOQLExecuteBeginLine>();
    const queryRowLimit = this.timelineRoot?.governorLimits.queryRows.limit ?? 0;
    let nextRowId = 0;

    soqlLines?.forEach((line) => {
      eventIndexToSOQL.set(line.eventIndex, line);
    });

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
          callerNamespace: getCallerNamespace(soql),
          rowCount: soql.soqlRowCount.self,
          timeTaken: soql.duration.total,
          aggregations: soql.aggregations,
          leadingOperationType: explainLine?.leadingOperationType ?? null,
          sObjectType: explainLine?.sObjectType ?? null,
          cardinality: explainLine?.cardinality ?? null,
          sObjectCardinality: explainLine?.sObjectCardinality ?? null,
          fields: explainLine?.fields?.join(', ') ?? null,
          eventIndex: soql.eventIndex,
          _children: [
            {
              id: ++nextRowId,
              eventIndex: soql.eventIndex,
              isDetail: true,
            },
          ],
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
      selectableRowsCheck: function (row: RowComponent) {
        return !row.getData().isDetail;
      },
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
          cssClass: 'datagrid-textarea datagrid-code-text',
          variableHeight: true,
          formatter: (cell, _formatterParams, _onRendered) => {
            const data = cell.getData() as GridSOQLData;
            return `<call-stack
            eventIndex=${data.eventIndex}
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
          vertAlign: 'top',
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
          title: 'Caller Namespace',
          field: 'callerNamespace',
          sorter: 'string',
          width: 120,
          visible: false,
        },
        {
          title: 'Row Count',
          field: 'rowCount',
          sorter: 'number',
          cssClass: 'number-cell',
          width: 100,
          hozAlign: 'right',
          headerHozAlign: 'right',
          formatter: progressFormatter,
          formatterParams: { precision: 0, totalValue: queryRowLimit, showPercentageText: false },
          bottomCalc: 'sum',
          bottomCalcFormatter: progressFormatter,
          bottomCalcFormatterParams: {
            precision: 0,
            totalValue: queryRowLimit,
            showPercentageText: false,
          },
          tooltip: (_e, cell) => cell.getValue() + (queryRowLimit > 0 ? '/' + queryRowLimit : ''),
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
        {
          title: 'Relative Cost',
          field: 'relativeCost',
          sorter: 'number',
          cssClass: 'number-cell',
          width: 110,
          hozAlign: 'right',
          headerHozAlign: 'right',
          visible: false,
        },
        {
          title: 'Leading Operation',
          field: 'leadingOperationType',
          sorter: 'string',
          width: 140,
          visible: false,
        },
        {
          title: 'SObject Type',
          field: 'sObjectType',
          sorter: 'string',
          width: 130,
          visible: false,
        },
        {
          title: 'Cardinality',
          field: 'cardinality',
          sorter: 'number',
          cssClass: 'number-cell',
          width: 110,
          hozAlign: 'right',
          headerHozAlign: 'right',
          visible: false,
        },
        {
          title: 'SObject Cardinality',
          field: 'sObjectCardinality',
          sorter: 'number',
          cssClass: 'number-cell',
          width: 140,
          hozAlign: 'right',
          headerHozAlign: 'right',
          visible: false,
        },
        {
          title: 'Indexed Fields',
          field: 'fields',
          sorter: 'string',
          width: 140,
          visible: false,
        },
        // Time column sits at the far right.
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
      ],
      rowFormatter: (row) => {
        const data = row.getData();
        if (data.isDetail && data.eventIndex !== undefined) {
          const detailContainer = this.createSOQLDetailPanel(data.eventIndex, eventIndexToSOQL);
          row.getElement().replaceChildren(detailContainer);
        }
      },
    });

    this.soqlTable.on('groupClick', (_e: UIEvent, group: GroupComponent) => {
      const { type } = window.getSelection() ?? {};
      if (type === 'Range') {
        return;
      }
      group.toggle();

      if (this.soqlTable && group.isVisible()) {
        this.soqlTable.blockRedraw();
        for (const row of group.getRows()) {
          if (row.getTreeChildren() && !row.isTreeExpanded()) {
            row.treeExpand();
          }
        }
        this.soqlTable.restoreRedraw();
      }
    });

    this.soqlTable.on('rowClick', function (_e, row) {
      const { type } = window.getSelection() ?? {};
      if (type === 'Range') {
        return;
      }

      const data = row.getData();
      if (!(data.eventIndex !== undefined && data.soql)) {
        return;
      }

      const origRowHeight = row.getElement().offsetHeight;
      row.treeToggle();
      row.getCell('soql').getElement().style.height = origRowHeight + 'px';
    });

    this.soqlTable.on('tableBuilt', () => {
      const holder = this._getTableHolder();
      holder.style.overflowAnchor = 'none';
      //@ts-expect-error This is a custom function added in the GroupSort custom module
      this.soqlTable?.setSortedGroupBy('soql');
      if (this.soqlTable) {
        this._initTableColumns(this.soqlTable);
      }
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

  createSOQLDetailPanel(eventIndex: number, eventIndexToSOQL: Map<number, SOQLExecuteBeginLine>) {
    const detailContainer = document.createElement('div');
    detailContainer.className = 'row__details-container';

    const soqlLine = eventIndexToSOQL.get(eventIndex);
    render(
      html`<db-soql-detail-panel
        eventIndex=${eventIndex}
        soql=${soqlLine?.text}
      ></db-soql-detail-panel>`,
      detailContainer,
    );

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

interface GridSOQLData {
  id: number;
  isSelective?: boolean | null;
  relativeCost?: number | null;
  soql?: string;
  namespace?: string;
  callerNamespace?: string;
  rowCount?: number | null;
  timeTaken?: number | null;
  aggregations?: number;
  leadingOperationType?: string | null;
  sObjectType?: string | null;
  cardinality?: number | null;
  sObjectCardinality?: number | null;
  fields?: string | null;
  eventIndex?: number;
  isDetail?: boolean;
  _children?: GridSOQLData[];
}

type FindEvt = CustomEvent<{ text: string; count: number; options: { matchCase: boolean } }>;
