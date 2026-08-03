/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import '#vscode-elements/vscode-option.js';
import '../../../components/VsSelect.js';
import '#vscode-elements/vscode-toolbar-button.js';
import { LitElement, css, html, unsafeCSS, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { Tabulator, type GroupComponent, type RowComponent } from 'tabulator-tables';

import type { ApexLog, SOSLExecuteBeginLine } from 'apex-log-parser';
import { SelectionEchoGuard } from '../../../core/events/SelectionEchoGuard.js';
import { vscodeMessenger } from '../../../core/messaging/VSCodeExtensionMessenger.js';
import { getCallerNamespace } from '../../../core/utility/CallerNamespace.js';
import { goToRow } from '../../call-tree/navigation.js';
import { isVisible } from '../../../core/utility/Util.js';
import { getSettings, updateSetting } from '../../settings/Settings.js';
import { emitGridSelection } from './gridSelection.js';
import { selectRowByEventIndex } from './revealRow.js';
import { soqlInlineElement } from '../../soql/format/inlineCell.js';
import { soqlSyntaxStyles } from '../../soql/styles/soql-syntax.css.js';
import {
  applyColumnView,
  buildColumnMenuItems,
  getColumnView,
  getTableFields,
  resolveColumnView,
  SOSL_VIEWS,
  toggleField,
} from '../../../tabulator/ColumnViews.js';
import {
  DB_ROW_COUNT_WIDTH,
  DB_TIME_WIDTH,
  NAMESPACE_WIDTH,
} from '../../../tabulator/ColumnWidths.js';

// Tabulator custom modules, imports + styles
import NumberAccessor from '../../../tabulator/dataaccessor/Number.js';
import { inCountRange, inMsRange, type FilterRange } from '../../../tabulator/filters/MinMax.js';
import { progressFormatter } from '../../../tabulator/format/Progress.js';
import { progressFormatterMS } from '../../../tabulator/format/ProgressMS.js';
import { GroupCalcs } from '../../../tabulator/groups/GroupCalcs.js';
import { GroupChildIndent } from '../../../tabulator/groups/GroupChildIndent.js';
import { GroupSort } from '../../../tabulator/groups/GroupSort.js';
import * as CommonModules from '../../../tabulator/module/CommonModules.js';
import { Find } from '../../../tabulator/module/Find.js';
import { RowKeyboardNavigation } from '../../../tabulator/module/RowKeyboardNavigation.js';
import { RowNavigation } from '../../../tabulator/module/RowNavigation.js';
import dataGridStyles from '../../../tabulator/style/DataGrid.scss';
import { commonColumnDefaults, headerSortElement } from '../../call-tree/components/TableShared.js';

// styles
import { globalStyles } from '../../../styles/global.styles.js';
import databaseViewStyles from './DatabaseView.scss';

// web components
import '../../../components/ContextMenu.js';
import type { ContextMenu } from '../../../components/ContextMenu.js';
import { showStatementRowMenu } from './rowContextMenu.js';
import '../../../components/datagrid-facet-filter.js';
import '../../../components/datagrid-filter-bar.js';
import '../../../components/datagrid-range-filter.js';
import '../../../components/OverflowList.js';

/** The SOSL column is always shown in the SOSL table. */
const ALWAYS_VISIBLE = ['sosl'];

const groupLabelsToFields = new Map<string, string>([
  ['SOSL', 'sosl'],
  ['Namespace', 'namespace'],
  ['Caller Namespace', 'callerNamespace'],
  ['None', ''],
]);

@customElement('sosl-view')
export class SOSLView extends LitElement {
  @property()
  timelineRoot: ApexLog | null = null;

  @property()
  highlightIndex: number = 0;

  @property()
  oldIndex: number = 0;

  /** SOSL lines to display; supplied by the parent DatabaseView. */
  @property({ attribute: false })
  lines: SOSLExecuteBeginLine[] = [];

  soslTable: Tabulator | null = null;
  holder: HTMLElement | null = null;
  /** Guards the programmatic select made on the inspector's behalf. */
  private _echoGuard = new SelectionEchoGuard();
  table: HTMLElement | null = null;
  findArgs: { text: string; count: number; options: { matchCase: boolean } } = {
    text: '',
    count: 0,
    options: { matchCase: false },
  };
  findMap: { [key: number]: RowComponent } = {};
  totalMatches = 0;
  blockClearHighlights = true;

  @state()
  columnView = 'General';

  /** Per-view column overrides (view id → visible fields); empty until edited. */
  @state()
  private columnOverrides: Record<string, string[]> = {};
  private contextMenu: ContextMenu | null = null;
  /** eventIndex of the row whose context menu is open. */
  private contextMenuEventIndex: number | null = null;

  @state()
  private namespaces: string[] = [];
  private namespaceSelected: string[] = [];
  private rowCountRange: FilterRange = { start: null, end: null };
  private timeTakenRange: FilterRange = { start: null, end: null };

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
    this.columnOverrides = settings.database?.sosl?.columnOverrides ?? {};
    this._setColumnView(resolveColumnView(SOSL_VIEWS, settings.database?.sosl?.columnView));
  }

  updated(changedProperties: PropertyValues): void {
    if (
      this.timelineRoot &&
      (changedProperties.has('lines') || changedProperties.has('timelineRoot'))
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

      #sosl-table-container {
        height: 100%;
      }

      #db-sosl-table {
        overflow: hidden;
        table-layout: fixed;
        width: 100%;
        margin-bottom: 1rem;
      }
    `,
  ];

  render() {
    const soslSkeleton = !this.timelineRoot ? html`<grid-skeleton></grid-skeleton>` : ``;

    return html`
      <datagrid-filter-bar>
        <overflow-list slot="filters" menu-heading="Filters" icon="filter">
          <datagrid-facet-filter
            label="Namespace"
            .values="${this.namespaces}"
            @datagrid-facet-change="${this._handleNamespaceFacet}"
          ></datagrid-facet-filter>
          <datagrid-range-filter
            label="Row Count"
            @datagrid-range-change="${this._handleRowCountRange}"
          ></datagrid-range-filter>
          <datagrid-range-filter
            label="Time Taken"
            unit="ms"
            @datagrid-range-change="${this._handleTimeTakenRange}"
          ></datagrid-range-filter>
        </overflow-list>

        <vs-select
          dense
          slot="table-actions"
          id="sosl-column-view"
          prefix="Columns"
          label="Column view"
          @change="${this._handleColumnViewChange}"
          @vs-reset-option="${this._onResetOption}"
          .value="${this.columnView}"
          .resettableValues="${Object.keys(this.columnOverrides)}"
        >
          ${SOSL_VIEWS.map(
            (view) =>
              html`<vscode-option value="${view.id}" ?selected="${this.columnView === view.id}"
                >${view.id}</vscode-option
              >`,
          )}
        </vs-select>

        <vs-select
          dense
          slot="group"
          id="sosl-groupby-dropdown"
          prefix="Group"
          label="Group by"
          @change="${this._soslGroupBy}"
        >
          <vscode-option>SOSL</vscode-option>
          <vscode-option>Namespace</vscode-option>
          <vscode-option>Caller Namespace</vscode-option>
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

      <div id="sosl-table-container">
        ${soslSkeleton}
        <div id="db-sosl-table"></div>
      </div>
      <context-menu @menu-select="${this._handleContextMenuSelect}"></context-menu>
    `;
  }

  private _handleColumnViewChange(event: Event) {
    const id = (event.target as HTMLInputElement).value || 'General';
    this._setColumnView(id);
    updateSetting('database.sosl.columnView', id);
  }

  /** Effective fields for a view id: the user override, else the built-in preset. */
  private _columnViewFields(id: string): string[] | null {
    return this.columnOverrides[id] ?? getColumnView(SOSL_VIEWS, id)?.fields ?? null;
  }

  private _setColumnView(id: string) {
    this.columnView = id;
    // Only apply once the table is laid out; otherwise tableBuilt → _initTableColumns
    // applies the current view (redraw on an unrendered table throws).
    if (this.soslTable?.element?.clientHeight) {
      applyColumnView(this.soslTable, this._columnViewFields(id), ALWAYS_VISIBLE);
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
    if (!this.contextMenu || !this.soslTable) {
      return;
    }
    this.contextMenu.show(
      buildColumnMenuItems(
        this.soslTable,
        this.columnView,
        SOSL_VIEWS,
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
    if (!this.contextMenu?.isVisible() || !this.soslTable) {
      return;
    }
    this.contextMenu.items = buildColumnMenuItems(
      this.soslTable,
      this.columnView,
      SOSL_VIEWS,
      ALWAYS_VISIBLE,
      Object.keys(this.columnOverrides),
    );
  }

  private _showRowContextMenu(event: MouseEvent, row: RowComponent) {
    this.contextMenuEventIndex = showStatementRowMenu(event, row, this.soslTable, this.contextMenu);
  }

  private _handleContextMenuSelect(e: CustomEvent<{ itemId: string }>) {
    const { itemId } = e.detail;
    const table = this.soslTable;
    if (!table) {
      return;
    }
    if (itemId === 'show-in-call-tree') {
      const eventIndex = this.contextMenuEventIndex;
      if (eventIndex !== null) {
        void goToRow({ eventIndex });
      }
      return;
    }
    if (itemId.startsWith('view:')) {
      const id = itemId.slice('view:'.length);
      this._setColumnView(id);
      updateSetting('database.sosl.columnView', id);
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
      updateSetting('database.sosl.columnOverrides', this.columnOverrides);
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
    const table = this.soslTable;
    if (!table || !this.columnOverrides[id]) {
      return;
    }
    const { [id]: _removed, ...rest } = this.columnOverrides;
    this.columnOverrides = rest;
    if (id === this.columnView) {
      applyColumnView(table, this._columnViewFields(id), ALWAYS_VISIBLE);
    }
    updateSetting('database.sosl.columnOverrides', this.columnOverrides);
  }

  private _handleNamespaceFacet(event: CustomEvent<{ selected: string[] }>) {
    this.namespaceSelected = event.detail.selected;
    this.soslTable?.refreshFilter();
  }

  private _handleRowCountRange(event: CustomEvent<{ range: FilterRange }>) {
    this.rowCountRange = event.detail.range;
    this.soslTable?.refreshFilter();
  }

  private _handleTimeTakenRange(event: CustomEvent<{ range: FilterRange }>) {
    this.timeTakenRange = event.detail.range;
    this.soslTable?.refreshFilter();
  }

  private _namespaceFilter = (data: SOSLRow): boolean =>
    this.namespaceSelected.length === 0 || this.namespaceSelected.includes(data.namespace ?? '');

  private _rowCountFilter = (data: SOSLRow): boolean =>
    inCountRange(this.rowCountRange, data.rowCount ?? 0);

  private _timeTakenFilter = (data: SOSLRow): boolean =>
    inMsRange(this.timeTakenRange, data.timeTaken ?? 0);

  _copyToClipboard() {
    this.soslTable?.copyToClipboard('all');
  }

  _exportToCSV() {
    this.soslTable?.download('csv', 'sosl.csv', { bom: true, delimiter: ',' });
  }

  _findEvt = ((event: FindEvt) => {
    this._find(event);
  }) as EventListener;

  _soslGroupBy(event: Event) {
    if (!this.soslTable) {
      return;
    }
    const target = event.target as HTMLInputElement;
    const groupValue = groupLabelsToFields.get(target.value) ?? '';
    //@ts-expect-error This is a custom function added in the GroupSort custom module
    this.soslTable.setSortedGroupBy(groupValue);
  }

  get _soslTableWrapper(): HTMLDivElement | null {
    return this.renderRoot?.querySelector('#db-sosl-table');
  }

  _appendTableWhenVisible() {
    if (this.soslTable) {
      return;
    }

    isVisible(this).then((isVisible) => {
      const tableWrapper = this._soslTableWrapper;
      if (tableWrapper && this.timelineRoot && isVisible) {
        Tabulator.registerModule(Object.values(CommonModules));
        Tabulator.registerModule([
          RowKeyboardNavigation,
          RowNavigation,
          Find,
          GroupCalcs,
          GroupChildIndent,
          GroupSort,
        ]);
        this._renderSOSLTable(tableWrapper, this.lines);
      }
    });
  }

  async _highlightMatches(highlightIndex: number) {
    if (!this.soslTable?.element?.clientHeight) {
      return;
    }

    this.findArgs.count = highlightIndex;
    const currentRow = this.findMap[highlightIndex];
    this.blockClearHighlights = true;
    //@ts-expect-error This is a custom function added in by Find custom module
    await this.soslTable.setCurrentMatch(highlightIndex, currentRow, {
      scrollIfVisible: false,
      focusRow: false,
    });
    this.blockClearHighlights = false;
    this.oldIndex = highlightIndex;
  }

  async _find(e: CustomEvent<{ text: string; count: number; options: { matchCase: boolean } }>) {
    const isTableVisible = !!this.soslTable?.element?.clientHeight;
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
      const result = await this.soslTable.find(this.findArgs);
      this.blockClearHighlights = false;
      this.totalMatches = result.totalMatches;
      this.findMap = result.matchIndexes;

      if (!clearHighlights) {
        document.dispatchEvent(
          new CustomEvent('db-find-results', {
            detail: { totalMatches: result.totalMatches, type: 'sosl' },
          }),
        );
      }
    }
  }

  _renderSOSLTable(soslTableContainer: HTMLElement, soslLines: SOSLExecuteBeginLine[]) {
    const soslData: SOSLRow[] = [];
    let nextRowId = 0;
    if (soslLines) {
      for (const sosl of soslLines) {
        soslData.push({
          id: ++nextRowId,
          sosl: sosl.text,
          namespace: sosl.namespace,
          callerNamespace: getCallerNamespace(sosl),
          rowCount: sosl.soslRowCount.self,
          timeTaken: sosl.duration.total,
          eventIndex: sosl.eventIndex,
        });
      }
    }

    this.namespaces = [
      ...new Set(soslData.map((row) => row.namespace).filter((v): v is string => !!v)),
    ].sort();

    // Bars fill relative to this grid's own totals (the Total row's sum), not a governor limit.
    const soslRowCountTotal = soslData.reduce((sum, row) => sum + (row.rowCount ?? 0), 0);
    const soslTimeTakenTotal = soslData.reduce((sum, row) => sum + (row.timeTaken ?? 0), 0);

    this.soslTable = new Tabulator(soslTableContainer, {
      index: 'id',
      height: '100%',
      clipboard: true,
      downloadEncoder: this.downlodEncoder('sosl.csv'),
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
      data: soslData,
      layout: 'fitColumns',
      placeholder: 'No SOSL queries found',
      columnCalcs: 'table',
      groupCalcs: true,
      groupSort: true,
      groupClosedShowCalcs: true,
      groupStartOpen: false,
      groupToggleElement: false,
      selectableRows: 'highlight',
      columnDefaults: commonColumnDefaults,
      headerSortElement,
      columns: [
        {
          title: 'SOSL',
          field: 'sosl',
          sorter: 'string',
          tooltip: true,
          widthGrow: 5,
          bottomCalc: () => {
            return 'Total';
          },
          headerSortTristate: true,
          cssClass: 'datagrid-code-text',
          formatter: (cell) => soqlInlineElement(cell.getValue() as string, 'sosl'),
        },
        {
          title: 'Namespace',
          field: 'namespace',
          sorter: 'string',
          width: NAMESPACE_WIDTH,
        },
        {
          title: 'Caller Namespace',
          field: 'callerNamespace',
          sorter: 'string',
          width: NAMESPACE_WIDTH,
          visible: false,
        },
        {
          title: 'Row Count',
          field: 'rowCount',
          sorter: 'number',
          cssClass: 'number-cell',
          width: DB_ROW_COUNT_WIDTH,
          hozAlign: 'right',
          headerHozAlign: 'right',
          formatter: progressFormatter,
          formatterParams: {
            precision: 0,
            totalValue: soslRowCountTotal,
            showPercentageText: false,
          },
          bottomCalc: 'sum',
          bottomCalcFormatter: progressFormatter,
          bottomCalcFormatterParams: {
            precision: 0,
            totalValue: soslRowCountTotal,
            showPercentageText: false,
          },
          tooltip: (_e, cell) =>
            cell.getValue() + (soslRowCountTotal > 0 ? '/' + soslRowCountTotal : ''),
        },
        {
          title: 'Time Taken (ms)',
          field: 'timeTaken',
          sorter: 'number',
          cssClass: 'number-cell',
          width: DB_TIME_WIDTH,
          hozAlign: 'right',
          headerHozAlign: 'right',
          formatter: progressFormatterMS,
          formatterParams: {
            precision: 2,
            totalValue: soslTimeTakenTotal,
            showPercentageText: false,
          },
          accessorDownload: NumberAccessor,
          bottomCalc: 'sum',
          bottomCalcFormatter: progressFormatterMS,
          bottomCalcFormatterParams: {
            precision: 2,
            totalValue: soslTimeTakenTotal,
            showPercentageText: false,
          },
        },
      ],
    });

    this.soslTable.on('groupClick', (_e: UIEvent, group: GroupComponent) => {
      if (window.getSelection()?.type === 'Range') {
        return;
      }
      group.toggle();
    });

    // Drive the detail panel off selection (not click) so keyboard row
    // navigation updates it too, matching the SOQL/DML grids.
    this.soslTable.on('rowSelectionChanged', (_data, rows) => {
      emitGridSelection(this._echoGuard, 'sosl', rows, (data: SOSLRow) =>
        data.sosl ? data.eventIndex : undefined,
      );
    });

    this.soslTable.on('rowContext', (e, row) => {
      this._showRowContextMenu(e as MouseEvent, row);
    });

    this.soslTable.on('tableBuilt', () => {
      const holder = this._getTableHolder();
      holder.style.overflowAnchor = 'none';
      //@ts-expect-error This is a custom function added in the GroupSort custom module
      this.soslTable?.setSortedGroupBy('sosl');
      if (this.soslTable) {
        this._initTableColumns(this.soslTable);
        this.soslTable.addFilter(this._namespaceFilter);
        this.soslTable.addFilter(this._rowCountFilter);
        this.soslTable.addFilter(this._timeTakenFilter);
      }
    });

    this.soslTable.on('renderComplete', () => {
      const holder = this._getTableHolder();
      const table = this._getTable();
      holder.style.minHeight = Math.min(holder.clientHeight, table.clientHeight) + 'px';
    });

    this.soslTable.on('dataSorted', () => {
      if (!this.blockClearHighlights && this.totalMatches > 0) {
        this._resetFindWidget();
        this._clearSearchHighlights();
      }
    });

    this.soslTable.on('dataGrouped', () => {
      if (!this.blockClearHighlights && this.totalMatches > 0) {
        this._resetFindWidget();
        this._clearSearchHighlights();
      }
    });

    this.soslTable.on('dataFiltering', () => {
      if (!this.blockClearHighlights && this.totalMatches > 0) {
        this._resetFindWidget();
        this._clearSearchHighlights();
      }
    });
  }

  _resetFindWidget() {
    document.dispatchEvent(
      new CustomEvent('db-find-results', {
        detail: { totalMatches: 0, type: 'sosl' },
      }),
    );
  }

  private _clearSearchHighlights() {
    this.findArgs.text = '';
    this.findArgs.count = 0;
    //@ts-expect-error This is a custom function added in by Find custom module
    this.soslTable.clearFindHighlights();
    this.findMap = {};
    this.totalMatches = 0;

    document.dispatchEvent(
      new CustomEvent('db-find-results', {
        detail: { totalMatches: this.totalMatches, type: 'sosl' },
      }),
    );
  }

  _getTable() {
    this.table ??= this.soslTable?.element.querySelector('.tabulator-table') as HTMLElement;
    return this.table;
  }

  _getTableHolder() {
    this.holder = this.soslTable?.element.querySelector('.tabulator-tableholder') as HTMLElement;
    return this.holder;
  }

  /** Clears this grid because another one was picked, so it emits nothing. */
  deselectRows() {
    this._echoGuard.run(() => this.soslTable?.deselectRow());
  }

  /**
   * Select the row for `eventIndex`, without echoing `detail:select` back at the
   * inspector that asked for it. Returns false when this grid has no such row.
   */
  selectByEventIndex(eventIndex: number): boolean {
    return selectRowByEventIndex(this.soslTable, this._echoGuard, eventIndex);
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

interface SOSLRow {
  id: number;
  sosl?: string;
  namespace?: string;
  callerNamespace?: string;
  rowCount?: number;
  timeTaken?: number;
  eventIndex?: number;
}

type FindEvt = CustomEvent<{ text: string; count: number; options: { matchCase: boolean } }>;
