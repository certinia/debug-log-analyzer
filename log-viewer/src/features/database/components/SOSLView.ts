/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import '#vscode-elements/vscode-option.js';
import '../../../components/VsSelect.js';
import '#vscode-elements/vscode-toolbar-button.js';
import { LitElement, css, html, unsafeCSS, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { Tabulator, type GroupComponent, type RowComponent } from 'tabulator-tables';

import type { ApexLog, SOSLExecuteBeginLine } from '@apexdevtools/apex-log-parser';
import { getCallerNamespace } from '../../../core/utility/CallerNamespace.js';
import { goToRow } from '../../call-tree/navigation.js';
import { isVisible } from '../../../core/utility/Util.js';
import { LocatedRowMarker } from '../../../components/locatedRow.js';
import { reportGridLocate, stampGridEventIndex } from './gridLocate.js';
import { reportGridSelection } from './gridSelection.js';
import { selectRowByEventIndex } from './revealRow.js';
import { soqlInlineElement } from '../../soql/format/inlineCell.js';
import { soqlSyntaxStyles } from '../../soql/styles/soql-syntax.css.js';
import { ColumnSettingsController } from '../../../components/ColumnSettingsController.js';
import { GridColumnMenuController } from '../../../components/GridColumnMenuController.js';
import { columnViewSelect, gridToolbarActions } from '../../../components/gridToolbar.js';
import { GridFindController } from '../../../components/GridFindController.js';
import { SOSL_VIEWS } from '../../../tabulator/ColumnViews.js';
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

  /** SOSL lines to display; supplied by the parent DatabaseView. */
  @property({ attribute: false })
  lines: SOSLExecuteBeginLine[] = [];

  soslTable: Tabulator | null = null;
  holder: HTMLElement | null = null;
  table: HTMLElement | null = null;
  private readonly _finder = new GridFindController(this, {
    table: () => this.soslTable,
    report: (totalMatches) =>
      document.dispatchEvent(
        new CustomEvent('db-find-results', { detail: { totalMatches, type: 'sosl' } }),
      ),
  });

  private readonly _columns = new ColumnSettingsController(this, {
    section: 'database.sosl',
    read: (settings) => settings.database?.sosl,
    views: SOSL_VIEWS,
    alwaysVisible: ALWAYS_VISIBLE,
    tables: () => (this.soslTable ? [this.soslTable] : []),
  });
  private readonly _menus = new GridColumnMenuController({
    table: () => this.soslTable,
    menu: () => this._contextMenu,
    columns: this._columns,
  });
  /** eventIndex of the row whose context menu is open. */
  private contextMenuEventIndex: number | null = null;
  /** Marks the rows for the statements under the inspector's pointer. */
  private _locatedRow = new LocatedRowMarker();

  @state()
  private namespaces: string[] = [];
  private namespaceSelected: string[] = [];
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

        ${columnViewSelect({
          id: 'sosl-column-view',
          views: SOSL_VIEWS,
          columns: this._columns,
          menus: this._menus,
        })}

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

        ${gridToolbarActions({
          menus: this._menus,
          exportToCSV: () => this._exportToCSV(),
          copyToClipboard: () => this._copyToClipboard(),
        })}
      </datagrid-filter-bar>

      <div id="sosl-table-container">
        ${soslSkeleton}
        <div id="db-sosl-table"></div>
      </div>
      <context-menu @menu-select="${this._handleContextMenuSelect}"></context-menu>
    `;
  }

  private _showRowContextMenu(event: MouseEvent, row: RowComponent) {
    this.contextMenuEventIndex = showStatementRowMenu(
      event,
      row,
      this.soslTable,
      this._contextMenu,
    );
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

    void isVisible(this).then((isVisible) => {
      const tableWrapper = this._soslTableWrapper;
      if (tableWrapper && this.timelineRoot && isVisible) {
        registerTableModules({ grouping: true });
        this._renderSOSLTable(tableWrapper, this.lines);
      }
    });
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
      ...clipboardCopyOptions,
      ...downloadOptions('sosl.csv'),
      rowKeyboardNavigation: true,
      data: soslData,
      layout: 'fitColumns',
      placeholder: 'No SOSL queries found',
      columnCalcs: 'table',
      ...groupingOptions,
      groupToggleElement: false,
      selectableRows: 'highlight',
      rowFormatter: stampGridEventIndex,
      columnDefaults: commonColumnDefaults,
      headerSortElement,
      columns: [
        {
          title: 'SOSL',
          field: 'sosl',
          sorter: 'string',
          tooltip: textCellTooltip,
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
      reportGridSelection(this, 'sosl', rows, (data: SOSLRow) =>
        data.sosl ? data.eventIndex : undefined,
      );
    });

    // Hovering a search marks it in the inspector, without picking it.
    reportGridLocate(this, this.soslTable, (data: SOSLRow) =>
      data.sosl ? data.eventIndex : undefined,
    );

    this.soslTable.on('rowContext', (e, row) => {
      this._showRowContextMenu(e as MouseEvent, row);
    });

    this.soslTable.on('tableBuilt', () => {
      this._getTableHolder()?.style.setProperty('overflow-anchor', 'none');
      //@ts-expect-error This is a custom function added in the GroupSort custom module
      this.soslTable?.setSortedGroupBy('sosl');
      if (this.soslTable) {
        this._menus.initTable(this.soslTable);
        this.soslTable.addFilter(this._namespaceFilter);
        this.soslTable.addFilter(this._rowCountFilter);
        this.soslTable.addFilter(this._timeTakenFilter);
      }
    });

    this.soslTable.on('renderComplete', () => {
      const holder = this._getTableHolder();
      if (!holder) {
        return;
      }
      const table = this._getTable();
      holder.style.minHeight = Math.min(holder.clientHeight, table.clientHeight) + 'px';
    });

    for (const reshaped of ['dataSorted', 'dataGrouped', 'dataFiltering'] as const) {
      this.soslTable.on(reshaped, () => this._finder.dropOnReshape());
    }
  }

  _getTable() {
    this.table ??= this.soslTable?.element.querySelector('.tabulator-table') as HTMLElement;
    return this.table;
  }

  _getTableHolder() {
    this.holder ??= tableHolder(this.soslTable?.element);
    return this.holder;
  }

  /** Drops this grid's row highlight, reported upward like any other change. */
  deselectRows() {
    this.soslTable?.deselectRow();
  }

  /**
   * Select the row for `eventIndex`. Returns false when this grid has no such row.
   */
  selectByEventIndex(eventIndex: number): boolean {
    return selectRowByEventIndex(this.soslTable, eventIndex);
  }

  /**
   * Mark the rows for the statements under the inspector's pointer, or drop the
   * mark with an empty list. Not a pick: nothing scrolls and nothing is selected.
   */
  markLocated(eventIndexes: readonly number[]): void {
    this._locatedRow.mark(this.soslTable?.element ?? null, eventIndexes);
  }
}

interface SOSLRow {
  id: number;
  sosl?: string;
  namespace?: string;
  callerNamespace?: string;
  rowCount?: number;
  timeTaken?: number;
  eventIndex?: number;
}
