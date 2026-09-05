/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { consume } from '@lit/context';
import type { LogEvent } from 'apex-log-parser';
import { LitElement, css, html, unsafeCSS, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import {
  type CellComponent,
  type ColumnDefinition,
  type RowComponent,
  Tabulator,
} from 'tabulator-tables';

import { eventBus, type DetailSource, type SelectionView } from '../core/events/EventBus.js';
import { logContext } from '../core/log/logContext.js';
import type { LogStore } from '../core/log/LogStore.js';
import { formatDuration, formatInteger } from '../core/utility/Util.js';
import {
  commonColumnDefaults,
  createDurationBarColumn,
  headerSortElement,
  clipboardCopyOptions,
  registerTableModules,
  virtualScrollOptions,
} from '../features/call-tree/components/TableShared.js';
import { waitForNextFrame, type FrameBudgetOptions } from '../core/utility/FrameBudget.js';
import { makeSumSelfTimeAllVisible } from '../features/call-tree/utils/BottomCalcs.js';
import { eventLabel } from '../features/call-tree/utils/eventText.js';
import { soqlInlineElement } from '../features/soql/format/inlineCell.js';
import { SelectionEchoGuard } from '../core/events/SelectionEchoGuard.js';
import { soqlSyntaxStyles } from '../features/soql/styles/soql-syntax.css.js';
import { globalStyles } from '../styles/global.styles.js';
import { progressColumnWidth } from '../tabulator/format/measureWidth.js';
import type { ProgressParams } from '../tabulator/format/ProgressMS.js';
import { tableHolder } from '../tabulator/module/tableHolder.js';
import dataGridStyles from '../tabulator/style/DataGrid.scss';
import './ContextMenu.js';
import type { ContextMenu } from './ContextMenu.js';
import { dispatchInspectorLocate, dispatchInspectorReveal } from './inspectorReveal.js';
import {
  LOCATED_ROW_CLASS,
  LocatedRowIds,
  LocatedRowMarker,
  rowId,
  rowIndexStamper,
} from './locatedRow.js';
import { PANEL_ROW_MENU_ITEMS, runPanelRowAction } from './panelRowMenu.js';
import {
  buildScopedCallTree,
  buildWholeLogCallTree,
  frameEventIndexes,
  locatableEventIndexes,
  revealableEventIndex,
  rowIdsByPath,
  type ScopedCallTree,
  type ScopedRow,
} from './scopedCallTree.js';
import './ViewModeSwitch.js';
import { VIEW_MODES, defaultViewMode, isViewMode, type ViewMode } from './callTreeViewModes.js';

/**
 * The mode picked per source tab, shared by every instance: the pane is torn
 * down and rebuilt on each collapse, tab hop and panel toggle, so without this
 * the pick would reset on every selection. Absent until the user picks, so the
 * default applies until then. Keyed by the log, so a pick is something you made
 * in this log and dies with it — never persisted, never carried to the next.
 */
const pickedViewMode = new WeakMap<LogStore, Map<DetailSource | undefined, ViewMode>>();

/** The picks made in one log, created on the first pick. */
function picksFor(store: LogStore): Map<DetailSource | undefined, ViewMode> {
  let picks = pickedViewMode.get(store);
  if (!picks) {
    picks = new Map();
    pickedViewMode.set(store, picks);
  }
  return picks;
}

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

  /** The tab the selection came from, so a pick is remembered per tab. Absent on
   *  the whole-log tree, which no tab selected. */
  @property({ attribute: false })
  source?: DetailSource;

  /** The direction that tab is showing, where it shows a tree at all. */
  @property({ attribute: false })
  sourceView?: SelectionView;

  @state()
  private viewMode: ViewMode = 'time-order';

  /** A built table. `stale` means it holds a previous selection's rows, so it
   *  needs re-filling before it is shown again. */
  private _tables: Record<
    ViewMode,
    /** `rows` is the data the table was filled with. Never read it back with
     *  `getData()`: that runs Tabulator's accessors, which deep-clone the row
     *  data, and our rows hold the parsed log. */
    { table: Tabulator; stale: boolean; rows: ScopedRow[] } | null
  > = {
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

  /** The scope's own call count, read by the Calls total. Retargeted per
   *  selection for the same reason `_barParams` is. */
  private _scopeCalls = 0;

  // The scoped tree (all three representations) for the current eventIndex,
  // computed once per selection and shared across the mode tables.
  private _scoped: ScopedCallTree | null = null;

  // The build in flight; a newer view-switch aborts it, and so does a disconnect.
  private _switch: AbortController | null = null;

  /** True while a scoped build is in flight. Read by the tables' placeholder,
   *  which Tabulator re-evaluates every time it shows one. */
  private _pending = false;

  private _contextMenu: ContextMenu | null = null;
  /** eventIndex of the row whose context menu is open. */
  private _menuEventIndex = -1;

  /** Guards the mark this component sets itself, so it is never read as a pick. */
  private _echoGuard = new SelectionEchoGuard();

  /** Marks the row for the frame under the pointer in the tab's own view. */
  private _locatedRow = new LocatedRowMarker();
  /** Translates the reported frames into bucket paths, memoised on the report:
   *  the tab re-reports the same list every time the pointer leaves a row. */
  private _locateIds = new LocatedRowIds();
  // The last report and the frames of it this scope stands for, so the filter
  // runs once per report rather than once per pointer move.
  private _reported: readonly number[] = [];
  private _reportedInScope: readonly number[] = [];
  // The frames the tab on screen last reported under its pointer, so a table
  // that finishes building after the report still marks them.
  private _locatedEvents: readonly number[] = [];
  private _locateUnsubscribe?: () => void;
  private _selectionClearUnsubscribe?: () => void;

  /**
   * Bucket path to the ids of the rows that stand for it, per grouped mode. Built
   * on the first mark of a scope, since only a pointer in the tab's own view
   * needs it, and dropped with the rows it describes.
   */
  private _rowsByPath: Record<ViewMode, Map<number, number> | null> = {
    'time-order': null,
    aggregated: null,
    'bottom-up': null,
  };

  /** The log on screen, from the app root. */
  @consume({ context: logContext, subscribe: true })
  @property({ attribute: false })
  logStore: LogStore | null = null;

  willUpdate() {
    // Idempotent: a pick is written to the map before the mode is set, so
    // recomputing it here always lands on the same answer.
    const picked = this.logStore && pickedViewMode.get(this.logStore)?.get(this.source);
    this._applyViewMode(picked || defaultViewMode(this.sourceView, !!this.instances?.length));
  }

  firstUpdated(): void {
    this._contextMenu = this.renderRoot.querySelector('context-menu');
  }

  connectedCallback(): void {
    super.connectedCallback();
    this._locateUnsubscribe = eventBus.on('detail:locate', ({ eventIndexes }) => {
      this._locatedEvents = eventIndexes;
      this._markLocated();
    });
    // Escape clears the selection of the tab on screen. A picked row here is no
    // selection of that view, so this table drops its own.
    this._selectionClearUnsubscribe = eventBus.on('selection:clear', () => {
      this._dropPick();
    });
  }

  /**
   * The ids of the rows that name `eventIndexes` in `mode`. Time Order keys its
   * rows by event, so there the ids are the indexes themselves — unless it merged
   * a selection's occurrences, when its rows are grouped like the other views'. A
   * grouped row merges occurrences behind a synthetic id, so it is found by the
   * bucket path it stands for.
   */
  private _markLocated(): void {
    this._locatedRow.mark(
      this._tableHost(this.viewMode),
      this._rowIdsFor(this.viewMode, this._locatedEvents),
    );
  }

  private _rowIdsFor(mode: ViewMode, eventIndexes: readonly number[]): readonly number[] {
    if ((mode === 'time-order' && !this._scoped?.timeOrderMerged) || !eventIndexes.length) {
      return eventIndexes;
    }
    const rows = this._tables[mode]?.rows ?? [];
    if (!rows.length) {
      // Still building. Caching the map now would hold an empty one for the life
      // of the scope, since only a new scope clears it.
      return [];
    }
    const byPath = (this._rowsByPath[mode] ??= rowIdsByPath(rows));
    const pathIds = this._locateIds.idsFor(
      this.logStore?.log ?? null,
      this._inScope(eventIndexes),
      mode === 'bottom-up' ? 'callers' : 'callees',
    );
    const ids: number[] = [];
    for (const pathId of pathIds) {
      const id = byPath.get(pathId);
      if (id !== undefined) {
        ids.push(id);
      }
    }
    return ids;
  }

  /**
   * The reported frames this scope stands for. A merged row is named by its
   * bucket path, so without this a frame at the same path elsewhere in the log
   * would mark a row that holds a different call.
   */
  private _inScope(eventIndexes: readonly number[]): readonly number[] {
    const holds = this._scoped?.holds;
    if (!holds) {
      return eventIndexes;
    }
    if (this._reported !== eventIndexes) {
      this._reported = eventIndexes;
      this._reportedInScope = eventIndexes.filter(holds);
    }
    return this._reportedInScope;
  }

  /**
   * Drops a picked row — its selection here, and the mark it holds in the tab on
   * screen. A grouped row's pick moves nothing, so nothing else would drop it.
   */
  private _dropPick(): void {
    const selected = this._tables[this.viewMode]?.table.getSelectedRows() ?? [];
    if (!selected.length) {
      return;
    }
    this._echoGuard.run(() => {
      for (const row of selected) {
        row.deselect();
      }
    });
    dispatchInspectorLocate(this, [], true);
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
        gap: var(--lana-space-sm);
        padding-bottom: var(--lana-space-2xs);
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
      /* The frame under the pointer in the tab on screen. */
      .table-host .tabulator-row.${unsafeCSS(LOCATED_ROW_CLASS)} {
        background-color: var(--lana-row-hover-bg);
      }
    `,
  ];

  updated(changed: PropertyValues) {
    // Only the whole-log tree can mount before a parse, so there a new log is a new scope.
    const scopeChanged =
      (changed.has('logStore') && this.wholeLog) ||
      changed.has('eventIndex') ||
      changed.has('instances');
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
   * Marks the active frame, without reporting it as a new pick. Only rows keyed
   * by event can be selected by index, so a view whose rows merge occurrences
   * keeps the row the user picked: clearing it would take away the row the
   * keyboard moves from.
   */
  private _markActive(): void {
    const table = this._tables[this.viewMode]?.table;
    if (!table || this.viewMode !== 'time-order' || this._scoped?.timeOrderMerged) {
      return;
    }
    const selected = table.getSelectedRows();
    // Already where it belongs, which is the usual case: the row the walk
    // reports is the row the user just picked here. Selecting it again re-renders
    // it, and tabulator's row re-render takes the table's focus with it.
    if (selected.length === 1 && rowId(selected[0]) === this.activeEventIndex) {
      return;
    }
    const holder = tableHolder(this._tableHost(this.viewMode));
    const root = holder?.getRootNode();
    const hadFocus = root instanceof ShadowRoot && root.activeElement === holder;
    this._echoGuard.run(() => {
      for (const row of selected) {
        row.deselect();
      }
      if (this.activeEventIndex >= 0) {
        table.selectRow([this.activeEventIndex]);
      }
    });
    // The re-render above drops focus, so the keyboard keeps its place here.
    if (hadFocus) {
      holder?.focus({ preventScroll: true });
    }
  }

  /**
   * The scoped root changed — mark every built table stale so each is re-filled
   * on demand, rather than destroyed and rebuilt. `_scoped` is only invalidated
   * here and only rebuilt in `_showActive`, past its paint yield — never
   * before it.
   */
  private _invalidateScope(): void {
    this._scoped = null;
    for (const mode of Object.keys(this._tables) as ViewMode[]) {
      const slot = this._tables[mode];
      if (slot) {
        slot.stale = true;
      }
      this._rowsByPath[mode] = null;
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._locateUnsubscribe?.();
    this._locateUnsubscribe = undefined;
    this._selectionClearUnsubscribe?.();
    this._selectionClearUnsubscribe = undefined;
    this._switch?.abort();
    this._destroyTables();
  }

  private _tableHost(mode: ViewMode): HTMLDivElement | null {
    return this.renderRoot?.querySelector<HTMLDivElement>(`#${mode}-tree`) ?? null;
  }

  private _destroyTables() {
    // Rows go with their tables, so the mark can't outlive them.
    this._locatedRow.clear();
    for (const mode of Object.keys(this._tables) as ViewMode[]) {
      this._tables[mode]?.table.destroy();
      this._tables[mode] = null;
      this._rowsByPath[mode] = null;
    }
  }

  /**
   * The rows for `mode`, building (and caching) the scoped tree first if this is
   * the selection's first view. Returns an empty array when nothing is in scope,
   * and null when the build was abandoned because a newer selection arrived.
   */
  private async _rows(mode: ViewMode, options: FrameBudgetOptions): Promise<ScopedRow[] | null> {
    if (!this._scoped) {
      const scoped = this.wholeLog
        ? await buildWholeLogCallTree(options)
        : await buildScopedCallTree(this.eventIndex, this.instances, options);
      if (options.signal?.aborted) {
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

  private async _showActive(): Promise<void> {
    // A newer switch, or a disconnect, aborts this one: building into detached
    // DOM that disconnectedCallback already ran past would leak the Tabulator.
    this._switch?.abort();
    const { signal } = (this._switch = new AbortController());
    // Wait for the now-visible host to lay out before Tabulator measures column
    // widths — building against a hidden/zero-width host makes columns overlap.
    await this.updateComplete;
    await waitForNextFrame();
    if (signal.aborted) {
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
      built.rows = [];
      void built.table.setData([]);
    }
    const data = await this._rows(mode, { signal });
    if (!data || signal.aborted) {
      return;
    }
    this._pending = false;
    // Percentages are relative to the selection, so retarget the shared params
    // the formatters read rather than rebuilding the columns around a new total.
    const scoped = this._scoped;
    this._barParams.totalValue = scoped?.rootTotal ?? 0;
    this._scopeCalls = scoped?.calls ?? 0;

    const slot = this._tables[mode];
    if (slot) {
      slot.stale = false;
      slot.rows = data;
      this._rowsByPath[mode] = null;
      void slot.table.setData(data).then(() => {
        this._markActive();
        this._markLocated();
      });
      return;
    }
    if (!scoped) {
      // Nothing in scope, so there is nothing to size a new table against.
      return;
    }

    const container = this._tableHost(mode);
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
      // Open the callers above the selection so it is on screen, and leave what
      // ran inside it closed.
      dataTreeStartExpanded: (row: RowComponent) =>
        (row.getData() as Partial<ScopedRow>).onPath === true,
      dataTreeChildColumnCalcs: false,
      dataTreeBranchElement: '<span/>',
      columnCalcs: 'table',
      // Arrow-key row navigation, matching the Call Tree tab.
      rowKeyboardNavigation: true,
      selectableRows: 'highlight',
      // Lets the hover mark find a row by one DOM query.
      rowFormatter: rowIndexStamper('id'),
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
    // No rowClick handler: a click only picks the row (RowKeyboardNavigation).
    // Expanding is the tree-control arrow's own job — doing both on one click
    // moved the row the user was aiming at. Jumping to the main Call Tree tab is
    // an explicit right-click action.
    table.on('rowContext', (e, row) => {
      this._showRowMenu(e as MouseEvent, row, table);
    });
    // Selecting a real frame reveals it in the tab on screen. Aggregated and
    // bottom-up rows merge occurrences behind a synthetic negative id, so
    // revealing one would misname which occurrence was clicked; the pick marks
    // every frame the row stands for instead, and holds until it is dropped, as
    // the Chrome DevTools performance panel keeps a selected group's frames lit.
    table.on('rowSelectionChanged', (_data, rows) => {
      if (this._echoGuard.suppressed) {
        return;
      }
      const data = rows[0]?.getData() as Partial<ScopedRow> | undefined;
      const eventIndex = revealableEventIndex(data);
      if (eventIndex !== null) {
        dispatchInspectorReveal(this, eventIndex);
      } else {
        // The same aggregate a merged row in the tab itself reports, so Details
        // reads the same either way. Built from the row: a scoped row carries no
        // key, which is what the tab's own rows are read through.
        const instances = locatableEventIndexes(data);
        dispatchInspectorLocate(this, frameEventIndexes(data), true, {
          kind: 'aggregate',
          instances,
          calledBy: this.viewMode === 'bottom-up' ? callerOfRow(rows[0]) : undefined,
        });
      }
    });
    // Hovering a row marks it in the tab on screen, so the user can see where it
    // sits before deciding to pick it. A grouped row cannot be revealed - there is
    // no one frame to jump to - but every frame it stands for can be marked.
    table.on('rowMouseEnter', (_e, row) => {
      dispatchInspectorLocate(this, frameEventIndexes(row.getData() as Partial<ScopedRow>));
    });
    table.on('rowMouseLeave', () => {
      dispatchInspectorLocate(this, []);
    });
    table.on('tableBuilt', () => {
      this._markActive();
      this._markLocated();
    });
    this._tables[mode] = { table, stale: false, rows: data };
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
        // Tabulator sums the top level only, which is the whole scope in the
        // grouped modes and overlapping rows in Bottom-Up. The scope's own total
        // answers in every mode, through `barParams`, which is retargeted per
        // selection.
        bottomCalc: () => barParams.totalValue,
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
    // are grouped (aggregated / bottom-up). The column set is built once per mode
    // and re-filled per selection, so it cannot depend on the selection.
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
        // Aggregated counts a call at its own depth and Bottom-Up counts it in
        // its leaf row, so neither top level holds them all. The scope does.
        bottomCalc: () => this._scopeCalls,
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
    if (this.logStore) {
      picksFor(this.logStore).set(this.source, mode);
    }
    this._applyViewMode(mode);
  }

  private _applyViewMode(mode: ViewMode): void {
    if (mode === this.viewMode) {
      return;
    }
    // The marked row belongs to the mode being left.
    this._locatedRow.clear();
    this.viewMode = mode;
  }
}

/** What a picked bottom-up row's calls were reached through: the row's own frame,
 *  or nothing on a top-level row, which names its own calls. */
function callerOfRow(row: RowComponent | undefined): string | undefined {
  if (!row?.getTreeParent()) {
    return undefined;
  }
  return (row.getData() as Partial<ScopedRow>).text;
}
