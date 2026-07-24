/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { LogEvent, LogEventType } from 'apex-log-parser';
import { LitElement, css, html, unsafeCSS, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import {
  type CellComponent,
  type ColumnDefinition,
  type RowComponent,
  Tabulator,
} from 'tabulator-tables';

import { formatDuration, formatInteger } from '../core/utility/Util.js';
import {
  commonColumnDefaults,
  headerSortElement,
  registerTableModules,
} from '../features/call-tree/components/TableShared.js';
import { makeSumSelfTimeAllVisible } from '../features/call-tree/utils/BottomCalcs.js';
import { formatSOQL } from '../features/soql/format/formatter.js';
import { soqlSyntaxStyles } from '../features/soql/styles/soql-syntax.css.js';
import { globalStyles } from '../styles/global.styles.js';
import { progressFormatterMS } from '../tabulator/format/ProgressMS.js';
import dataGridStyles from '../tabulator/style/DataGrid.scss';
import { buildScopedCallTree } from './scopedCallTree.js';
import './ViewModeSwitch.js';
import type { ViewModeOption } from './ViewModeSwitch.js';

type ViewMode = 'time-order' | 'aggregated' | 'bottom-up';

const VIEW_MODES: ViewModeOption[] = [
  { value: 'time-order', label: 'Time Order' },
  { value: 'aggregated', label: 'Aggregated' },
  { value: 'bottom-up', label: 'Bottom-Up' },
];

// SOQL/DML frames already read as their statement text, so don't prefix the type.
const EXCLUDED_TYPES = new Set<LogEventType>(['SOQL_EXECUTE_BEGIN', 'DML_BEGIN']);

/**
 * Compact dataTree name cell: tree indent + single-line (inline) SOQL/SOSL +
 * type-prefixed plain text. Unlike the Call Tree tab's formatter it renders SOQL
 * inline (not pretty) and no `<a>` link, so cells truncate cleanly and the row
 * click alone drives navigation.
 */
function compactNameFormatter(cell: CellComponent): HTMLElement {
  const row = cell.getRow();
  // @ts-expect-error this.table is bound by tabulator but missing from the types
  const childIndent: number = this.table?.options?.dataTreeChildIndent ?? 9;
  // @ts-expect-error _row is private but is the only way to read the tree level
  const treeLevel: number = row._row.modules.dataTree?.index ?? 0;
  const treeIndent = treeLevel * childIndent;
  if (treeIndent) {
    const el = cell.getElement();
    el.style.paddingLeft = `calc(${treeIndent + 4}px + var(--lana-group-indent, 0px))`;
  }

  const { originalData: node } = cell.getData() as { originalData?: LogEvent };
  const text = node?.text ?? (cell.getValue() as string) ?? '';
  const type = node?.type;
  const isSoql = type === 'SOQL_EXECUTE_BEGIN';
  const isSosl = type === 'SOSL_EXECUTE_BEGIN';
  if ((isSoql || isSosl) && text) {
    const span = document.createElement('span');
    span.className = 'soql-block soql-inline';
    span.innerHTML = formatSOQL(text, { mode: 'inline', dialect: isSosl ? 'sosl' : 'soql' });
    return span;
  }

  const label = type && type !== text && !EXCLUDED_TYPES.has(type) ? `${type}: ${text}` : text;
  return document.createTextNode(label) as unknown as HTMLElement;
}

/**
 * The selected statement's enclosing execution as a compact call tree,
 * switchable between Time Order / Aggregated / Bottom-Up (Chrome-perf style).
 * Reuses the Call Tree tab's data transforms, name formatter and bottom-calc
 * helpers, but only the Name / Total / Self (+ Count) columns so it fits the
 * side bar without horizontal scroll. Tables build lazily per mode and rebuild
 * when the selection changes.
 */
@customElement('call-tree-detail')
export class CallTreeDetail extends LitElement {
  @property({ type: Number })
  eventIndex = -1;

  @state()
  private viewMode: ViewMode = 'time-order';

  private _tables: Record<ViewMode, Tabulator | null> = {
    'time-order': null,
    aggregated: null,
    'bottom-up': null,
  };

  static styles = [
    globalStyles,
    unsafeCSS(dataGridStyles),
    unsafeCSS(soqlSyntaxStyles),
    css`
      :host {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
      }
      view-mode-switch {
        padding-bottom: 4px;
        flex: 0 0 auto;
      }
      .tables {
        position: relative;
        flex: 1 1 auto;
        min-height: 0;
      }
      .table-host {
        position: absolute;
        inset: 0;
      }
      .table-host.is-hidden {
        display: none;
      }
      /* Name: single line, ellipsis — never wrap. */
      .table-host .tabulator-cell.truncate {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
    `,
  ];

  updated(changed: PropertyValues) {
    if (changed.has('eventIndex')) {
      // The scoped root changed — drop every table so each rebuilds on demand.
      this._destroyTables();
    }
    void this._ensureActiveTable();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._destroyTables();
  }

  private _destroyTables() {
    for (const mode of Object.keys(this._tables) as ViewMode[]) {
      this._tables[mode]?.destroy();
      this._tables[mode] = null;
    }
  }

  private async _ensureActiveTable(): Promise<void> {
    const mode = this.viewMode;
    if (this._tables[mode]) {
      return;
    }
    const scoped = buildScopedCallTree(this.eventIndex);
    if (!scoped) {
      return;
    }
    const container = this.renderRoot?.querySelector<HTMLDivElement>(`#${mode}-tree`);
    if (!container) {
      return;
    }

    const data =
      mode === 'time-order'
        ? scoped.timeOrder
        : mode === 'aggregated'
          ? scoped.aggregated
          : scoped.bottomUp;

    registerTableModules();
    const table = new Tabulator(container, {
      data,
      index: 'id',
      layout: 'fitColumns',
      height: '100%',
      maxHeight: '100%',
      placeholder: 'No call tree available',
      dataTree: true,
      dataTreeChildField: '_children',
      dataTreeChildColumnCalcs: false,
      dataTreeBranchElement: '<span/>',
      columnCalcs: 'table',
      // Arrow-key row navigation, matching the Call Tree tab.
      // @ts-expect-error custom option registered by the RowKeyboardNavigation module (types not updated)
      rowKeyboardNavigation: true,
      selectableRows: 'highlight',
      headerSortElement,
      columnDefaults: commonColumnDefaults,
      columns: this._columns(mode, scoped.rootTotal),
    });
    // Clicking a row toggles its subtree (never navigates to the main Call Tree
    // tab). The tree-control arrow handles its own toggle, so skip those clicks.
    table.on('rowClick', (e: UIEvent, row: RowComponent) => {
      if (window.getSelection()?.type === 'Range') {
        return;
      }
      if ((e.target as HTMLElement).closest('.tabulator-data-tree-control')) {
        return;
      }
      if (row.getTreeChildren().length) {
        row.treeToggle();
      }
    });
    this._tables[mode] = table;
  }

  private _columns(mode: ViewMode, rootTotal: number): ColumnDefinition[] {
    const isTimeOrder = mode === 'time-order';
    const barParams = { precision: 2, totalValue: rootTotal, showPercentageText: true };

    const columns: ColumnDefinition[] = [
      {
        title: 'Name',
        field: 'text',
        // Name absorbs the slack and shrinks + truncates first; the numeric
        // columns hold a fixed content width. Below Name's minWidth the table
        // scrolls horizontally.
        formatter: compactNameFormatter,
        cssClass: 'datagrid-code-text truncate',
        headerSort: false,
        widthGrow: 1,
        widthShrink: 1,
        minWidth: 140,
        bottomCalc: () => 'Total',
      },
      {
        title: 'Total (ms)',
        field: 'duration.total',
        sorter: 'number',
        hozAlign: 'right',
        headerHozAlign: 'right',
        width: 150,
        minWidth: 150,
        widthGrow: 0,
        widthShrink: 0,
        formatter: progressFormatterMS,
        formatterParams: barParams,
        bottomCalc: 'sum',
        bottomCalcFormatter: progressFormatterMS,
        bottomCalcFormatterParams: barParams,
        tooltip: (_e, cell: CellComponent) => formatDuration(cell.getValue()),
      },
      {
        title: 'Self (ms)',
        field: 'duration.self',
        sorter: 'number',
        hozAlign: 'right',
        headerHozAlign: 'right',
        width: 150,
        minWidth: 150,
        widthGrow: 0,
        widthShrink: 0,
        formatter: progressFormatterMS,
        formatterParams: barParams,
        bottomCalc: makeSumSelfTimeAllVisible(() => this._tables[mode] ?? undefined),
        bottomCalcFormatter: progressFormatterMS,
        bottomCalcFormatterParams: barParams,
      },
    ];

    // Time Order rows are single calls, so a count only makes sense once frames
    // are grouped (aggregated / bottom-up).
    if (!isTimeOrder) {
      columns.push({
        title: 'Count',
        field: 'callCount',
        sorter: 'number',
        hozAlign: 'right',
        headerHozAlign: 'right',
        width: 56,
        minWidth: 56,
        widthGrow: 0,
        widthShrink: 0,
        cssClass: 'number-cell',
        formatter: (cell: CellComponent) => formatInteger(cell.getValue()),
        bottomCalc: 'sum',
      });
    }

    return columns;
  }

  render() {
    return html`
      <view-mode-switch
        aria-label="Call tree view mode"
        .options=${VIEW_MODES}
        value=${this.viewMode}
        @view-mode-change=${(e: CustomEvent<{ value: string }>) =>
          this._setViewMode(e.detail.value as ViewMode)}
      ></view-mode-switch>
      <div class="tables">
        <div
          id="time-order-tree"
          class="table-host ${this.viewMode === 'time-order' ? '' : 'is-hidden'}"
        ></div>
        <div
          id="aggregated-tree"
          class="table-host ${this.viewMode === 'aggregated' ? '' : 'is-hidden'}"
        ></div>
        <div
          id="bottom-up-tree"
          class="table-host ${this.viewMode === 'bottom-up' ? '' : 'is-hidden'}"
        ></div>
      </div>
    `;
  }

  private _setViewMode(mode: ViewMode) {
    this.viewMode = mode;
    // @state field initializer shadows the accessor under @swc/jest; nudge it.
    this.requestUpdate();
  }
}
