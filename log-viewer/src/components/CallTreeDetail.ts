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
  createDurationBarColumn,
  headerSortElement,
  clipboardCopyOptions,
  registerTableModules,
  waitForNextFrame,
} from '../features/call-tree/components/TableShared.js';
import { makeSumSelfTimeAllVisible } from '../features/call-tree/utils/BottomCalcs.js';
import { getSettings, updateSetting } from '../features/settings/Settings.js';
import { soqlInlineElement } from '../features/soql/format/inlineCell.js';
import { soqlSyntaxStyles } from '../features/soql/styles/soql-syntax.css.js';
import { globalStyles } from '../styles/global.styles.js';
import { progressColumnWidth } from '../tabulator/format/measureWidth.js';
import dataGridStyles from '../tabulator/style/DataGrid.scss';
import './ContextMenu.js';
import type { ContextMenu } from './ContextMenu.js';
import { PANEL_ROW_MENU_ITEMS, runPanelRowAction } from './panelRowMenu.js';
import {
  buildScopedCallTree,
  NODE_BUDGET,
  type ScopedCallTree,
  type ScopedRow,
} from './scopedCallTree.js';
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
    return soqlInlineElement(text, isSosl ? 'sosl' : 'soql');
  }

  const label = type && type !== text && !EXCLUDED_TYPES.has(type) ? `${type}: ${text}` : text;
  return document.createTextNode(label) as unknown as HTMLElement;
}

/**
 * The scoped call tree for the selected statement, switchable between Time Order
 * / Aggregated / Bottom-Up (Chrome-perf style). Reuses the Call Tree tab's data
 * transforms, name formatter and bottom-calc helpers with a compact
 * Name / Total / Self (+ Calls) column set; tables build lazily per mode and
 * rebuild when the selection changes.
 */
@customElement('call-tree-detail')
export class CallTreeDetail extends LitElement {
  @property({ type: Number })
  eventIndex = -1;

  /** Occurrence eventIndexes when the selection is an aggregate row; the tree
   *  then scopes to every occurrence, aggregated. */
  @property({ attribute: false })
  instances: number[] | null = null;

  @state()
  private viewMode: ViewMode = 'time-order';

  /** Show the zero-duration bookkeeping rows (heap, statements, assignments).
   *  Off by default, as on the Call Tree tab — they outnumber the timed frames
   *  several times over. */
  @state()
  private showDetails = false;

  private _tables: Record<ViewMode, Tabulator | null> = {
    'time-order': null,
    aggregated: null,
    'bottom-up': null,
  };

  // The scoped tree (all three representations) for the current eventIndex,
  // computed once per selection and shared across the mode tables.
  private _scoped: ScopedCallTree | null = null;

  // Guards against a slow view-switch resolving after a newer one.
  private _switchEpoch = 0;

  private _contextMenu: ContextMenu | null = null;
  /** eventIndex of the row whose context menu is open. */
  private _menuEventIndex = -1;
  // Set once the user picks a mode, so a late settings load can't overrule them.
  private _modeIsUserChoice = false;

  constructor() {
    super();
    // The mode is remembered UI state, so it's read here rather than threaded
    // through the section builders.
    getSettings()
      .then((settings) => {
        const mode = settings?.inspector?.callTreeMode;
        if (!this._modeIsUserChoice && VIEW_MODES.some((option) => option.value === mode)) {
          this.viewMode = mode as ViewMode;
          this.requestUpdate();
        }
      })
      .catch(() => {
        /* settings unavailable (e.g. outside the extension host) — keep the default */
      });
  }

  firstUpdated(): void {
    this._contextMenu = this.renderRoot.querySelector('context-menu');
  }

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
      .toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding-bottom: 4px;
        flex: 0 0 auto;
      }
      .note {
        flex: 0 0 auto;
        margin: 4px 0 0;
        color: var(--vscode-descriptionForeground);
        font-size: var(--filter-control-font-size);
      }
      .note .warn {
        color: var(--vscode-editorWarning-foreground, var(--vscode-descriptionForeground));
        margin-left: 0.5ch;
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
      /* Tabulator mounts into this inner div, whose class Lit never rewrites.
         Binding a class on the mount element itself would clobber the tabulator
         classes Tabulator adds imperatively on every re-render, breaking the
         header layout. */
      .grid {
        height: 100%;
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
    const scopeChanged = changed.has('eventIndex') || changed.has('instances');
    if (scopeChanged) {
      // The scoped root changed — drop every table so each rebuilds on demand,
      // and recompute the scoped tree once (all three modes share it).
      this._destroyTables();
      this._scoped = buildScopedCallTree(this.eventIndex, this.instances);
    }
    if (scopeChanged || changed.has('viewMode')) {
      void this._showActive();
    }
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

  private async _showActive(): Promise<void> {
    const epoch = ++this._switchEpoch;
    // Wait for the now-visible host to lay out before Tabulator measures column
    // widths — building against a hidden/zero-width host makes columns overlap.
    await this.updateComplete;
    await waitForNextFrame();
    // Bail if a newer switch superseded this one, or the component was
    // disconnected mid-wait (e.g. the pane collapsed) — otherwise we'd build a
    // Tabulator into detached DOM that disconnectedCallback already ran past,
    // leaking it.
    if (epoch !== this._switchEpoch || !this.isConnected) {
      return;
    }

    const mode = this.viewMode;
    const existing = this._tables[mode];
    if (existing) {
      existing.redraw(); // re-fit the layout for the now-visible host
      return;
    }

    const scoped = this._scoped;
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
      // @ts-expect-error custom option registered by the RowKeyboardNavigation module
      rowKeyboardNavigation: true,
      selectableRows: 'highlight',
      ...clipboardCopyOptions,
      headerSortElement,
      columnDefaults: commonColumnDefaults,
      columns: this._columns(mode, scoped.rootTotal),
      // Time Order stays chronological — that's what the mode is for. The
      // grouped modes lead with their ranking metric, as the Call Tree tab's
      // Bottom-Up does; either way the headers stay sortable.
      ...(mode === 'time-order'
        ? {}
        : {
            initialSort: [
              {
                column: mode === 'bottom-up' ? 'duration.self' : 'duration.total',
                dir: 'desc' as const,
              },
            ],
          }),
    });
    // Clicking a row toggles its subtree — jumping to the main Call Tree tab is
    // an explicit right-click action. The tree-control arrow handles its own
    // toggle, so skip those clicks.
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
    table.on('rowContext', (e, row) => {
      this._showRowMenu(e as MouseEvent, row, table);
    });
    // Filters must wait for the build; a table created later than a toggle picks
    // the current state up here.
    table.on('tableBuilt', () => {
      this._applyDetailsFilter(table);
    });
    this._tables[mode] = table;
  }

  private _detailsFilter = (data: ScopedRow): boolean => data._hasDetailsDeep;

  private _applyDetailsFilter(table: Tabulator) {
    table.blockRedraw();
    table.clearFilter(false);
    if (!this.showDetails) {
      table.addFilter(this._detailsFilter);
    }
    table.restoreRedraw();
  }

  private _toggleDetails() {
    this.showDetails = !this.showDetails;
    // @state field initializer shadows the accessor under @swc/jest; nudge it.
    this.requestUpdate();
    for (const table of Object.values(this._tables)) {
      if (table) {
        this._applyDetailsFilter(table);
      }
    }
  }

  /** Row right-click menu: reveal in the Call Tree tab, or copy the frame. */
  private _showRowMenu(event: MouseEvent, row: RowComponent, table: Tabulator) {
    if (!this._contextMenu || window.getSelection()?.type === 'Range') {
      return;
    }
    event.preventDefault();

    for (const selected of table.getSelectedRows()) {
      selected.deselect();
    }
    row.select();

    // Aggregated/bottom-up rows merge occurrences; `originalData` is the
    // representative frame, so the action lands on that occurrence.
    const { originalData } = row.getData() as { originalData?: LogEvent };
    this._menuEventIndex = originalData?.eventIndex ?? -1;
    if (this._menuEventIndex < 0) {
      return;
    }
    this._contextMenu.show(PANEL_ROW_MENU_ITEMS, event.clientX, event.clientY);
  }

  private _columns(mode: ViewMode, rootTotal: number): ColumnDefinition[] {
    const isTimeOrder = mode === 'time-order';
    const barParams = { precision: 2, totalValue: rootTotal, showPercentageText: true };
    const barWidth = progressColumnWidth(rootTotal);

    const columns: ColumnDefinition[] = [
      {
        title: 'Name',
        field: 'text',
        // Name absorbs the slack and shrinks + truncates first; the numeric
        // columns hold a fixed content width. Below Name's minWidth the table
        // scrolls horizontally.
        formatter: compactNameFormatter,
        cssClass: 'datagrid-code-text truncate',
        sorter: 'string',
        widthGrow: 1,
        widthShrink: 1,
        minWidth: 140,
        bottomCalc: () => 'Total',
      },
      createDurationBarColumn({
        title: 'Total (ms)',
        field: 'duration.total',
        barWidth,
        barParams,
        bottomCalc: 'sum',
        tooltip: (_e, cell: CellComponent) => formatDuration(cell.getValue()),
      }),
      createDurationBarColumn({
        title: 'Self (ms)',
        field: 'duration.self',
        barWidth,
        barParams,
        bottomCalc: makeSumSelfTimeAllVisible(() => this._tables[mode] ?? undefined),
      }),
    ];

    // Time Order rows are single calls, so a count only makes sense once frames
    // are grouped (aggregated / bottom-up).
    if (!isTimeOrder) {
      columns.push({
        title: 'Calls',
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
      <div class="toolbar">
        <view-mode-switch
          aria-label="Call tree view mode"
          .options=${VIEW_MODES}
          value=${this.viewMode}
          @view-mode-change=${(e: CustomEvent<{ value: string }>) =>
            this._setViewMode(e.detail.value as ViewMode)}
        ></view-mode-switch>
        <button
          type="button"
          class="filter-control pill-toggle"
          aria-pressed="${this.showDetails}"
          title="Show zero-duration rows (heap allocations, statements, variable assignments)"
          @click=${this._toggleDetails}
        >
          Details
        </button>
      </div>
      <div class="tables">
        <div class="table-host ${this.viewMode === 'time-order' ? '' : 'is-hidden'}">
          <div id="time-order-tree" class="grid"></div>
        </div>
        <div class="table-host ${this.viewMode === 'aggregated' ? '' : 'is-hidden'}">
          <div id="aggregated-tree" class="grid"></div>
        </div>
        <div class="table-host ${this.viewMode === 'bottom-up' ? '' : 'is-hidden'}">
          <div id="bottom-up-tree" class="grid"></div>
        </div>
      </div>
      <p class="note">
        <span>Times are relative to the selection.</span>${
          this._scoped?.truncated
            ? html`<span class="warn"
                >Large subtree — stopped at ${formatInteger(NODE_BUDGET)} rows.</span
              >`
            : ''
        }
      </p>
      <context-menu
        @menu-select=${(e: CustomEvent<{ itemId: string }>) =>
          runPanelRowAction(e.detail.itemId, this._menuEventIndex)}
      ></context-menu>
    `;
  }

  private _setViewMode(mode: ViewMode) {
    this._modeIsUserChoice = true;
    this.viewMode = mode;
    updateSetting('inspector.callTreeMode', mode);
    // @state field initializer shadows the accessor under @swc/jest; nudge it.
    this.requestUpdate();
  }
}
