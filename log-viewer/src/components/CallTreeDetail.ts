/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { LogEvent } from 'apex-log-parser';
import { LitElement, css, html, unsafeCSS, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import {
  type CellComponent,
  type ColumnDefinition,
  type RowComponent,
  Tabulator,
} from 'tabulator-tables';

import { LogLoadedController } from '../core/events/LogLoadedController.js';
import { formatDuration, formatInteger } from '../core/utility/Util.js';
import {
  commonColumnDefaults,
  createDurationBarColumn,
  headerSortElement,
  clipboardCopyOptions,
  registerTableModules,
  virtualScrollOptions,
  waitForNextFrame,
} from '../features/call-tree/components/TableShared.js';
import { makeSumSelfTimeAllVisible } from '../features/call-tree/utils/BottomCalcs.js';
import { eventLabel } from '../features/call-tree/utils/eventText.js';
import { soqlInlineElement } from '../features/soql/format/inlineCell.js';
import { SelectionEchoGuard } from '../core/events/SelectionEchoGuard.js';
import { soqlSyntaxStyles } from '../features/soql/styles/soql-syntax.css.js';
import { globalStyles } from '../styles/global.styles.js';
import { progressColumnWidth } from '../tabulator/format/measureWidth.js';
import type { ProgressParams } from '../tabulator/format/ProgressMS.js';
import dataGridStyles from '../tabulator/style/DataGrid.scss';
import './ContextMenu.js';
import type { ContextMenu } from './ContextMenu.js';
import { dispatchInspectorReveal } from './inspectorReveal.js';
import { PANEL_ROW_MENU_ITEMS, runPanelRowAction } from './panelRowMenu.js';
import {
  buildScopedCallTree,
  buildWholeLogCallTree,
  revealableEventIndex,
  type ScopedBuildOptions,
  type ScopedCallTree,
  type ScopedRow,
} from './scopedCallTree.js';
import './ViewModeSwitch.js';
import type { ViewModeOption } from './ViewModeSwitch.js';

// The switch options are the source of the union, so the guard below can't drift.
const VIEW_MODES = [
  { value: 'time-order', label: 'Time Order' },
  { value: 'aggregated', label: 'Aggregated' },
  { value: 'bottom-up', label: 'Bottom-Up' },
] as const satisfies readonly ViewModeOption[];

type ViewMode = (typeof VIEW_MODES)[number]['value'];

function isViewMode(value: unknown): value is ViewMode {
  return VIEW_MODES.some((option) => option.value === value);
}

/**
 * The picked view mode, shared by every instance: the pane is torn down and
 * rebuilt on each collapse, tab hop and panel toggle, so without this the mode
 * would reset on every selection. Deliberately not persisted — a log opens on
 * Time Order, the mode that matches the Call Tree tab and the timeline, so an
 * aggregated view is always something you chose in this log, not last week.
 */
let sharedViewMode: ViewMode | undefined;

/**
 * Compact dataTree name cell: tree indent + single-line (inline) SOQL/SOSL +
 * the frame's label. Unlike the Call Tree tab's formatter it renders SOQL
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

  return document.createTextNode(node ? eventLabel(node) : text) as unknown as HTMLElement;
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

  /** The frame the user walked to inside the scope. It only moves the mark: the
   *  scope is anchored on `eventIndex`, so the trees are never rebuilt for it. */
  @property({ type: Number })
  activeEventIndex = -1;

  /** True shows the whole log rooted at the log itself — real durations,
   *  nothing scoped or attributed. `eventIndex`/`instances` are then ignored. */
  @property({ type: Boolean })
  wholeLog = false;

  @state()
  private viewMode: ViewMode = 'time-order';

  /** A built table. `stale` means it holds a previous selection's rows, so it
   *  needs re-filling before it is shown again. */
  private _tables: Record<ViewMode, { table: Tabulator; stale: boolean } | null> = {
    'time-order': null,
    aggregated: null,
    'bottom-up': null,
  };

  /**
   * The bar/percentage params, shared by every column of every mode table and
   * mutated in place per selection. Tabulator reads `formatterParams` by
   * reference at render time, so this keeps the column definitions
   * selection-independent — which is what lets a new selection re-fill a table
   * with `setData` instead of rebuilding it.
   */
  private readonly _barParams: ProgressParams = {
    precision: 2,
    totalValue: 0,
    showPercentageText: true,
  };

  // The scoped tree (all three representations) for the current eventIndex,
  // computed once per selection and shared across the mode tables.
  private _scoped: ScopedCallTree | null = null;

  // Guards against a slow view-switch resolving after a newer one.
  private _switchEpoch = 0;

  /** True while a scoped build is in flight. Read by the tables' placeholder,
   *  which Tabulator re-evaluates every time it shows one. */
  private _pending = false;

  private _contextMenu: ContextMenu | null = null;
  /** eventIndex of the row whose context menu is open. */
  private _menuEventIndex = -1;

  /** Guards the mark this component sets itself, so it is never read as a pick. */
  private _echoGuard = new SelectionEchoGuard();

  // A whole-log tree can mount before the first parse finishes (the scoped
  // tree cannot — a selection implies a parsed log), so rebuild when the log
  // lands.
  private readonly _logLoaded = new LogLoadedController(this, () => {
    if (!this.wholeLog) {
      return;
    }
    this._invalidateScope();
    void this._showActive();
  });

  constructor() {
    super();
    // Session UI state, so it's read here rather than threaded through the
    // section builders.
    if (sharedViewMode) {
      this.viewMode = sharedViewMode;
    }
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
      this._invalidateScope();
    }
    if (scopeChanged || changed.has('viewMode')) {
      void this._showActive();
    } else if (changed.has('activeEventIndex')) {
      // The anchor holds, so the rows are unchanged — only the mark moves.
      this._markActive();
    }
  }

  /**
   * Marks the active frame, without reporting it as a new pick. Only Time Order
   * keys its rows by event, so the grouped modes have nothing to mark.
   */
  private _markActive(): void {
    const table = this._tables[this.viewMode]?.table;
    if (!table) {
      return;
    }
    this._echoGuard.run(() => {
      for (const selected of table.getSelectedRows()) {
        selected.deselect();
      }
      if (this.viewMode === 'time-order' && this.activeEventIndex >= 0) {
        table.selectRow([this.activeEventIndex]);
      }
    });
  }

  /**
   * The scoped root changed — mark every built table stale so each is re-filled
   * on demand, rather than destroyed and rebuilt. `_scoped` is only invalidated
   * here and only rebuilt in `_showActive`, past its paint yield — never
   * before it.
   */
  private _invalidateScope(): void {
    this._scoped = null;
    for (const slot of Object.values(this._tables)) {
      if (slot) {
        slot.stale = true;
      }
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._destroyTables();
  }

  private _destroyTables() {
    for (const mode of Object.keys(this._tables) as ViewMode[]) {
      this._tables[mode]?.table.destroy();
      this._tables[mode] = null;
    }
  }

  /**
   * The rows for `mode`, building (and caching) the scoped tree first if this is
   * the selection's first view. Returns an empty array when nothing is in scope,
   * and null when the build was abandoned because a newer selection arrived.
   */
  private async _rows(mode: ViewMode, options: ScopedBuildOptions): Promise<ScopedRow[] | null> {
    if (!this._scoped) {
      const scoped = this.wholeLog
        ? await buildWholeLogCallTree(options)
        : await buildScopedCallTree(this.eventIndex, this.instances, options);
      if (options.cancelled?.()) {
        // Abandoned rather than empty — don't cache the null over a scope that
        // was never walked.
        return null;
      }
      this._scoped = scoped;
    }
    const scoped = this._scoped;
    if (!scoped) {
      return [];
    }
    switch (mode) {
      case 'time-order':
        return scoped.timeOrder(options);
      case 'aggregated':
        return scoped.aggregated(options);
      case 'bottom-up':
        return scoped.bottomUp(options);
    }
  }

  /**
   * True once `epoch`'s work should be thrown away: a newer switch replaced it,
   * or the component was disconnected mid-wait (e.g. the pane collapsed) —
   * building into detached DOM that disconnectedCallback already ran past would
   * leak the Tabulator.
   */
  private _superseded(epoch: number): boolean {
    return epoch !== this._switchEpoch || !this.isConnected;
  }

  private async _showActive(): Promise<void> {
    const epoch = ++this._switchEpoch;
    // Wait for the now-visible host to lay out before Tabulator measures column
    // widths — building against a hidden/zero-width host makes columns overlap.
    await this.updateComplete;
    await waitForNextFrame();
    if (this._superseded(epoch)) {
      return;
    }

    const mode = this.viewMode;
    const built = this._tables[mode];
    if (built && !built.stale) {
      built.table.redraw(); // re-fit the layout for the now-visible host
      return;
    }

    // Started here, after the yield above, so the selection highlight and the
    // rest of the panel paint before the walk does anything; the walk then
    // slices itself, so it never blocks a frame either.
    this._pending = true;
    if (built) {
      // Those rows belong to the previous selection and the build below spans
      // several frames — clear them rather than leave them standing under a
      // selection they don't describe.
      void built.table.setData([]);
    }
    const data = await this._rows(mode, {
      yieldFrame: waitForNextFrame,
      cancelled: () => this._superseded(epoch),
    });
    if (!data || this._superseded(epoch)) {
      return;
    }
    this._pending = false;
    // Percentages are relative to the selection, so retarget the shared params
    // the formatters read rather than rebuilding the columns around a new total.
    const scoped = this._scoped;
    this._barParams.totalValue = scoped?.rootTotal ?? 0;

    const slot = this._tables[mode];
    if (slot) {
      slot.stale = false;
      void slot.table.setData(data).then(() => this._markActive());
      return;
    }
    if (!scoped) {
      // Nothing in scope, so there is nothing to size a new table against.
      return;
    }

    const container = this.renderRoot?.querySelector<HTMLDivElement>(`#${mode}-tree`);
    if (!container) {
      return;
    }

    registerTableModules();
    const table = new Tabulator(container, {
      data,
      index: 'id',
      layout: 'fitColumns',
      height: '100%',
      maxHeight: '100%',
      // Re-evaluated every time Tabulator shows the placeholder, so the pending
      // text tracks the build without a second empty-state element.
      placeholder: () => (this._pending ? 'Building the call tree…' : 'No call tree available'),
      // A scoped subtree is unbounded, so only the visible rows are rendered —
      // the same deal the Call Tree tab's tables get. The build in
      // `scopedCallTree` is still eager; this bounds the paint, not the walk.
      ...virtualScrollOptions,
      dataTree: true,
      dataTreeChildField: '_children',
      dataTreeChildColumnCalcs: false,
      dataTreeBranchElement: '<span/>',
      columnCalcs: 'table',
      // Arrow-key row navigation, matching the Call Tree tab.
      rowKeyboardNavigation: true,
      selectableRows: 'highlight',
      ...clipboardCopyOptions,
      headerSortElement,
      columnDefaults: commonColumnDefaults,
      columns: this._columns(mode, progressColumnWidth(scoped.logTotal)),
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
    // Selecting a real frame reveals it in the tab on screen. Aggregated and
    // bottom-up rows merge occurrences behind a synthetic negative id, so
    // revealing one would misname which occurrence was clicked.
    table.on('rowSelectionChanged', (_data, rows) => {
      if (this._echoGuard.suppressed) {
        return;
      }
      const eventIndex = revealableEventIndex(rows[0]?.getData() as Partial<ScopedRow> | undefined);
      if (eventIndex !== null) {
        dispatchInspectorReveal(this, eventIndex);
      }
    });
    table.on('tableBuilt', () => {
      this._markActive();
    });
    this._tables[mode] = { table, stale: false };
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

  /**
   * `barWidth` is sized from the whole log rather than the selection, so the bar
   * columns keep one width as the selection changes — and never have to grow for
   * a wider total.
   */
  private _columns(mode: ViewMode, barWidth: number): ColumnDefinition[] {
    const isTimeOrder = mode === 'time-order';
    const barParams = this._barParams;

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
        bottomCalc: makeSumSelfTimeAllVisible(() => this._tables[mode]?.table),
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
            this._setViewMode(e.detail.value)}
        ></view-mode-switch>
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
      <context-menu
        @menu-select=${(e: CustomEvent<{ itemId: string }>) =>
          runPanelRowAction(e.detail.itemId, this._menuEventIndex)}
      ></context-menu>
    `;
  }

  private _setViewMode(mode: string) {
    if (!isViewMode(mode)) {
      return;
    }
    sharedViewMode = mode;
    this.viewMode = mode;
  }
}
