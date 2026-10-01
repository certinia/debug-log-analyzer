/*
 * Copyright (c) 2022 Certinia Inc. All rights reserved.
 */
import '#vscode-elements/vscode-option.js';
import '../../../components/VsSelect.js';
import '#vscode-elements/vscode-toolbar-button.js';
import { LitElement, css, html, unsafeCSS, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { Tabulator, type GroupComponent, type RowComponent } from 'tabulator-tables';

import type { ApexLog, DMLBeginLine } from '@apexdevtools/apex-log-parser';
import { getCallerNamespace } from '../../../core/utility/CallerNamespace.js';
import { goToRow } from '../../call-tree/navigation.js';
import { isVisible } from '../../../core/utility/Util.js';
import { LocatedRowMarker } from '../../../components/locatedRow.js';
import { reportGridLocate, stampGridEventIndex } from './gridLocate.js';
import { reportGridSelection } from './gridSelection.js';
import { selectRowByEventIndex } from './revealRow.js';
import { ColumnSettingsController } from '../../../components/ColumnSettingsController.js';
import { GridColumnMenuController } from '../../../components/GridColumnMenuController.js';
import { GridFindController } from '../../../components/GridFindController.js';
import { DML_VIEWS } from '../../../tabulator/ColumnViews.js';
import {
  DB_ROW_COUNT_WIDTH,
  DB_TIME_WIDTH,
  NAMESPACE_WIDTH,
} from '../../../tabulator/ColumnWidths.js';

// Tabulator custom modules, imports + styles
import NumberAccessor from '../../../tabulator/dataaccessor/Number.js';
import { tableHolder } from '../../../tabulator/module/tableHolder.js';
import { inCountRange, inMsRange, type FilterRange } from '../../../tabulator/filters/MinMax.js';
import { progressFormatter } from '../../../tabulator/format/Progress.js';
import { progressFormatterMS } from '../../../tabulator/format/ProgressMS.js';
import dataGridStyles from '../../../tabulator/style/DataGrid.scss';
import {
  clipboardCopyOptions,
  commonColumnDefaults,
  downloadOptions,
  groupingOptions,
  headerSortElement,
  registerTableModules,
  textCellTooltip,
} from '../../call-tree/components/TableShared.js';

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

/** The DML column is always shown in the DML table. */
const ALWAYS_VISIBLE = ['dml'];

const groupLabelsToFields = new Map<string, string>([
  ['DML', 'dml'],
  ['Object', 'objectType'],
  ['Namespace', 'namespace'],
  ['Caller Namespace', 'callerNamespace'],
  ['None', ''],
]);

@customElement('dml-view')
export class DMLView extends LitElement {
  @property()
  timelineRoot: ApexLog | null = null;

  @property()
  highlightIndex: number = 0;

  /** DML lines to display; supplied by the parent DatabaseView. */
  @property({ attribute: false })
  lines: DMLBeginLine[] = [];

  dmlTable: Tabulator | null = null;
  holder: HTMLElement | null = null;
  table: HTMLElement | null = null;
  private readonly _finder = new GridFindController(this, {
    table: () => this.dmlTable,
    report: (totalMatches) =>
      document.dispatchEvent(
        new CustomEvent('db-find-results', { detail: { totalMatches, type: 'dml' } }),
      ),
  });

  private readonly _columns = new ColumnSettingsController(this, {
    section: 'database.dml',
    read: (settings) => settings.database?.dml,
    views: DML_VIEWS,
    alwaysVisible: ALWAYS_VISIBLE,
    tables: () => (this.dmlTable ? [this.dmlTable] : []),
  });
  private readonly _menus = new GridColumnMenuController({
    table: () => this.dmlTable,
    menu: () => this._contextMenu,
    columns: this._columns,
  });
  /** eventIndex of the row whose context menu is open. */
  private contextMenuEventIndex: number | null = null;
  /** Marks the rows for the statements under the inspector's pointer. */
  private _locatedRow = new LocatedRowMarker();

  @state()
  private callerNamespaces: string[] = [];
  @state()
  private objects: string[] = [];
  private callerNamespaceSelected: string[] = [];
  private objectSelected: string[] = [];
  private rowCountRange: FilterRange = { start: null, end: null };
  private timeTakenRange: FilterRange = { start: null, end: null };

  private get _contextMenu(): ContextMenu | null {
    return this.renderRoot.querySelector('context-menu');
  }

  updated(changedProperties: PropertyValues): void {
    if (
      this.timelineRoot &&
      (changedProperties.has('lines') || changedProperties.has('timelineRoot'))
    ) {
      this._appendTableWhenVisible();
    }

    if (changedProperties.has('highlightIndex')) {
      void this._finder.highlight(this.highlightIndex);
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
      <datagrid-filter-bar>
        <overflow-list slot="filters" menu-heading="Filters" icon="filter">
          <datagrid-facet-filter
            label="Caller Namespace"
            .values="${this.callerNamespaces}"
            @datagrid-facet-change="${this._handleCallerNamespaceFacet}"
          ></datagrid-facet-filter>
          <datagrid-facet-filter
            label="Object"
            .values="${this.objects}"
            @datagrid-facet-change="${this._handleObjectFacet}"
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
          id="dml-column-view"
          prefix="Columns"
          label="Column view"
          @change="${this._menus.chooseView}"
          @vs-reset-option="${this._menus.resetView}"
          .value="${this._columns.view}"
          .resettableValues="${this._columns.editedViews}"
        >
          ${DML_VIEWS.map(
            (view) =>
              html`<vscode-option value="${view.id}" ?selected="${this._columns.view === view.id}"
                >${view.id}</vscode-option
              >`,
          )}
        </vs-select>

        <vs-select
          dense
          slot="group"
          id="dml-groupby-dropdown"
          prefix="Group"
          label="Group by"
          @change="${this._dmlGroupBy}"
        >
          <vscode-option>DML</vscode-option>
          <vscode-option>Object</vscode-option>
          <vscode-option>Namespace</vscode-option>
          <vscode-option>Caller Namespace</vscode-option>
          <vscode-option>None</vscode-option>
        </vs-select>

        <div slot="actions">
          <vscode-toolbar-button
            icon="list-selection"
            label="Columns"
            title="Columns"
            @click=${this._menus.open}
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

      <div id="dml-table-container">
        ${dmlSkeleton}
        <div id="db-dml-table"></div>
      </div>
      <context-menu @menu-select="${this._handleContextMenuSelect}"></context-menu>
    `;
  }

  private _showRowContextMenu(event: MouseEvent, row: RowComponent) {
    this.contextMenuEventIndex = showStatementRowMenu(event, row, this.dmlTable, this._contextMenu);
  }

  private _handleContextMenuSelect(e: CustomEvent<{ itemId: string }>) {
    const { itemId } = e.detail;
    if (itemId === 'show-in-call-tree') {
      const eventIndex = this.contextMenuEventIndex;
      if (eventIndex !== null) {
        void goToRow({ eventIndex });
      }
      return;
    }
    this._menus.select(itemId);
  }

  private _handleCallerNamespaceFacet(event: CustomEvent<{ selected: string[] }>) {
    this.callerNamespaceSelected = event.detail.selected;
    this.dmlTable?.refreshFilter();
  }

  private _handleObjectFacet(event: CustomEvent<{ selected: string[] }>) {
    this.objectSelected = event.detail.selected;
    this.dmlTable?.refreshFilter();
  }

  private _handleRowCountRange(event: CustomEvent<{ range: FilterRange }>) {
    this.rowCountRange = event.detail.range;
    this.dmlTable?.refreshFilter();
  }

  private _handleTimeTakenRange(event: CustomEvent<{ range: FilterRange }>) {
    this.timeTakenRange = event.detail.range;
    this.dmlTable?.refreshFilter();
  }

  private _callerNamespaceFilter = (data: DMLRow): boolean =>
    this.callerNamespaceSelected.length === 0 ||
    this.callerNamespaceSelected.includes(data.callerNamespace ?? '');

  private _objectFilter = (data: DMLRow): boolean =>
    this.objectSelected.length === 0 || this.objectSelected.includes(data.objectType ?? '');

  private _rowCountFilter = (data: DMLRow): boolean =>
    inCountRange(this.rowCountRange, data.rowCount ?? 0);

  private _timeTakenFilter = (data: DMLRow): boolean =>
    inMsRange(this.timeTakenRange, data.timeTaken ?? 0);

  _copyToClipboard() {
    this.dmlTable?.copyToClipboard('all');
  }

  /** Drops this grid's row highlight, reported upward like any other change. */
  deselectRows() {
    this.dmlTable?.deselectRow();
  }

  /**
   * Select the row for `eventIndex`. Returns false when this grid has no such row.
   */
  selectByEventIndex(eventIndex: number): boolean {
    return selectRowByEventIndex(this.dmlTable, eventIndex);
  }

  /**
   * Mark the rows for the statements under the inspector's pointer, or drop the
   * mark with an empty list. Not a pick: nothing scrolls and nothing is selected.
   */
  markLocated(eventIndexes: readonly number[]): void {
    this._locatedRow.mark(this.dmlTable?.element ?? null, eventIndexes);
  }

  _exportToCSV() {
    this.dmlTable?.download('csv', 'dml.csv', { bom: true, delimiter: ',' });
  }

  _dmlGroupBy(event: Event) {
    if (!this.dmlTable) {
      return;
    }
    const target = event.target as HTMLInputElement;
    const groupValue = groupLabelsToFields.get(target.value) ?? '';
    //@ts-expect-error This is a custom function added in the GroupSort custom module
    this.dmlTable.setSortedGroupBy(groupValue);
  }

  get _dmlTableWrapper(): HTMLDivElement | null {
    return this.renderRoot?.querySelector('#db-dml-table');
  }

  _appendTableWhenVisible() {
    if (this.dmlTable) {
      return;
    }

    void isVisible(this).then((isVisible) => {
      const tableWrapper = this._dmlTableWrapper;
      if (tableWrapper && this.timelineRoot && isVisible) {
        registerTableModules({ grouping: true });
        this._renderDMLTable(tableWrapper, this.lines);
      }
    });
  }

  _renderDMLTable(dmlTableContainer: HTMLElement, dmlLines: DMLBeginLine[]) {
    const dmlData: DMLRow[] = [];
    let nextRowId = 0;
    if (dmlLines) {
      for (const dml of dmlLines) {
        dmlData.push({
          id: ++nextRowId,
          dml: dml.text,
          objectType: dml.sObjectType,
          namespace: dml.namespace,
          callerNamespace: getCallerNamespace(dml),
          rowCount: dml.dmlRowCount.self,
          timeTaken: dml.duration.total,
          eventIndex: dml.eventIndex,
        });
      }
    }

    // Bars fill relative to this grid's own totals (the Total row's sum), not a governor limit.
    const dmlRowCountTotal = dmlData.reduce((sum, row) => sum + (row.rowCount ?? 0), 0);
    const dmlTimeTakenTotal = dmlData.reduce((sum, row) => sum + (row.timeTaken ?? 0), 0);

    this.callerNamespaces = [
      ...new Set(dmlData.map((row) => row.callerNamespace).filter((v): v is string => !!v)),
    ].sort();
    this.objects = [
      ...new Set(dmlData.map((row) => row.objectType).filter((v): v is string => !!v)),
    ].sort();

    this.dmlTable = new Tabulator(dmlTableContainer, {
      index: 'id',
      height: '100%',
      ...clipboardCopyOptions,
      ...downloadOptions('dml.csv'),
      rowKeyboardNavigation: true,
      data: dmlData, //set initial table data
      layout: 'fitColumns',
      placeholder: 'No DML statements found',
      columnCalcs: 'table',
      ...groupingOptions,
      groupToggleElement: false,
      selectableRows: 'highlight',
      rowFormatter: stampGridEventIndex,
      columnDefaults: commonColumnDefaults,
      headerSortElement,
      columns: [
        {
          title: 'DML',
          field: 'dml',
          sorter: 'string',
          tooltip: textCellTooltip,
          widthGrow: 5,
          bottomCalc: () => {
            return 'Total';
          },
          headerSortTristate: true,
          cssClass: 'datagrid-code-text',
        },
        {
          title: 'Caller Namespace',
          field: 'callerNamespace',
          sorter: 'string',
          width: NAMESPACE_WIDTH,
        },
        {
          title: 'Object',
          field: 'objectType',
          sorter: 'string',
          width: 110,
          tooltip: textCellTooltip,
          visible: false,
          formatter: (cell) => (cell.getValue() as string | null) ?? '—',
        },
        {
          title: 'Namespace',
          field: 'namespace',
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
            totalValue: dmlRowCountTotal,
            showPercentageText: false,
          },
          bottomCalc: 'sum',
          bottomCalcFormatter: progressFormatter,
          bottomCalcFormatterParams: {
            precision: 0,
            totalValue: dmlRowCountTotal,
            showPercentageText: false,
          },
          tooltip: (_e, cell) =>
            cell.getValue() + (dmlRowCountTotal > 0 ? '/' + dmlRowCountTotal : ''),
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
            totalValue: dmlTimeTakenTotal,
            showPercentageText: false,
          },
          accessorDownload: NumberAccessor,
          bottomCalc: 'sum',
          bottomCalcFormatter: progressFormatterMS,
          bottomCalcFormatterParams: {
            precision: 2,
            totalValue: dmlTimeTakenTotal,
            showPercentageText: false,
          },
        },
      ],
    });

    this.dmlTable.on('groupClick', (_e: UIEvent, group: GroupComponent) => {
      const { type } = window.getSelection() ?? {};
      if (type === 'Range') {
        return;
      }

      group.toggle();
    });

    // Drive the detail panel off selection (not click) so keyboard row
    // navigation updates it too. RowKeyboardNavigation keeps a single row
    // selected across mouse and arrow-key navigation.
    this.dmlTable.on('rowSelectionChanged', (_data, rows) => {
      reportGridSelection(this, 'dml', rows, (data: DMLRow) =>
        data.dml ? data.eventIndex : undefined,
      );
    });

    // Hovering a statement marks it in the inspector, without picking it.
    reportGridLocate(this, this.dmlTable, (data: DMLRow) =>
      data.dml ? data.eventIndex : undefined,
    );

    this.dmlTable.on('rowContext', (e, row) => {
      this._showRowContextMenu(e as MouseEvent, row);
    });

    this.dmlTable.on('tableBuilt', () => {
      this._getTableHolder()?.style.setProperty('overflow-anchor', 'none');
      //@ts-expect-error This is a custom function added in the GroupSort custom module
      this.dmlTable?.setSortedGroupBy('dml');
      if (this.dmlTable) {
        this._menus.initTable(this.dmlTable);
        this.dmlTable.addFilter(this._callerNamespaceFilter);
        this.dmlTable.addFilter(this._objectFilter);
        this.dmlTable.addFilter(this._rowCountFilter);
        this.dmlTable.addFilter(this._timeTakenFilter);
      }
    });

    this.dmlTable.on('renderComplete', () => {
      const holder = this._getTableHolder();
      if (!holder) {
        return;
      }
      const table = this._getTable();
      holder.style.minHeight = Math.min(holder.clientHeight, table.clientHeight) + 'px';
    });

    for (const reshaped of ['dataSorted', 'dataGrouped', 'dataFiltering'] as const) {
      this.dmlTable.on(reshaped, () => this._finder.dropOnReshape());
    }
  }

  _getTable() {
    this.table ??= this.dmlTable?.element.querySelector('.tabulator-table') as HTMLElement;
    return this.table;
  }

  _getTableHolder() {
    this.holder ??= tableHolder(this.dmlTable?.element);
    return this.holder;
  }
}

interface DMLRow {
  id: number;
  dml?: string;
  objectType?: string | null;
  namespace?: string;
  callerNamespace?: string;
  rowCount?: number;
  timeTaken?: number;
  eventIndex?: number;
}
