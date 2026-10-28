/*
 * Copyright (c) 2022 Certinia Inc. All rights reserved.
 */
import '#vscode-elements/vscode-option.js';
import '../../../components/VsSelect.js';
import { consume } from '@lit/context';
import { initialState, Task } from '@lit/task';
import { css, html, LitElement, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { logContext } from '#core/log/logContext.js';
import type { LogStore } from '#core/log/LogStore.js';
import { repeat } from 'lit/directives/repeat.js';

import { eventType } from '@apexdevtools/apex-log-parser';
import { DomListenerController } from '#core/events/DomListenerController.js';
import { eventBus, type SelectionView } from '#core/events/EventBus.js';
import { SelectionEchoGuard } from '#core/events/SelectionEchoGuard.js';
import { SubscriptionController } from '#core/events/SubscriptionController.js';
import { vscodeMessenger } from '#core/messaging/VSCodeExtensionMessenger.js';
import { type LogIndex, NO_ROW } from '#core/log/LogIndex.js';
import { isVisible } from '#core/utility/Util.js';
import { CALLTREE_GO_TO_ROW, type CalltreeNavigationEventMap } from '../navigation.js';
import { goToTimelineEvent } from '../../timeline/navigation.js';
import type { AggregatedRow, BottomUpRow } from '../utils/Aggregation.js';
import { TimeOrderSource, type TimeOrderNode } from '../utils/TimeOrderTree.js';
import { eventKind } from '#core/log/eventKind.js';
import { wireCategoryColoring } from '../utils/CategoryColoring.js';
import { waitForNextFrame } from '#core/utility/FrameBudget.js';
import type {
  GridContextDetail,
  GridHeaderContextDetail,
  LvGrid,
  RowFilter,
  RowKey,
} from '../../../grid/index.js';
import { categoryClass } from '../grid/CallTreeGrid.js';
import {
  AGGREGATED_WITHOUT_DETAILS,
  aggregatedColumns,
  BOTTOM_UP_WITHOUT_DETAILS,
  BOTTOM_UP_SORT,
  bottomUpColumns,
  BOTTOM_UP_GROUPS,
  bottomUpGroupBy,
  CALL_TREE_COLUMN_SETTINGS,
  mergedLines,
  openType,
  timeOrderColumns,
} from '../grid/columns.js';
import { inspectorRowEvents } from '../grid/inspectorRowEvents.js';
import { MergedTree } from '../grid/mergedRows.js';

import type { FilterRange } from '../../../components/grid/MinMax.js';
import {
  BOTTOM_UP_MEASURES,
  deep,
  measureFilters,
  RowFilterCache,
  type MeasureFields,
} from '../grid/rowFilters.js';

// styles
import { globalStyles } from '../../../styles/global.styles.js';

// web components
import '../../../components/ContextMenu.js';
import type { ContextMenu } from '../../../components/ContextMenu.js';
import '../../../components/GridSkeleton.js';
import '../../../components/ViewModeSwitch.js';
import {
  VIEW_MODES,
  callTreeLabel,
  directionOf,
  type ViewMode,
} from '../../../components/callTreeViewModes.js';
import '../../../components/datagrid-facet-filter.js';
import '../../../components/datagrid-filter-bar.js';
import '../../../components/datagrid-range-filter.js';
import '../../../components/OverflowList.js';

import {
  ColumnSettingsController,
  gridColumnTarget,
  type ColumnTarget,
} from '../../../components/ColumnSettingsController.js';
import { CALL_TREE_VIEWS } from '../../../components/grid/ColumnViews.js';
import { exportCsv } from '../../../components/grid/exportCsv.js';
import {
  columnViewSelect,
  gridGroupControls,
  gridToolbarActions,
} from '../../../components/gridToolbar.js';
import {
  clearGridFilters,
  hiddenAfterGoTo,
  HiddenRowController,
  hiddenRowNoteStyles,
  type HiddenRow,
} from '../../../components/grid/hiddenRowNote.js';
import { reportedUsageOf } from '../utils/reportedUsage.js';
import { selectColumnWidthItem } from '../../../components/grid/columnWidthMenu.js';
import { LocatedRowIds, type RowData } from '../../../components/locatedRow.js';
import { InspectorTabController } from '../../../components/InspectorTabController.js';
import { FindController } from '../../find/FindController.js';
import { revealFirstOf } from '../../../components/inspectorTab.js';

const AGGREGATED_DEBUG_ONLY: RowFilter<AggregatedRow> = {
  test: (row) => DEBUG_VALUE_TYPES.has(row.type),
  keepAncestors: true,
};

/** Where each view builds its table. */
const CONTAINER_IDS: Record<ViewMode, string> = {
  'time-order': '#call-tree-table',
  aggregated: '#aggregated-tree-table',
  'bottom-up': '#bottom-up-tree-table',
};

function typeNamesIn(index: LogIndex): string[] {
  const types = index.column(index.log.columns.type);
  const typeIds = new Set<number>();
  for (let row = 0; row < index.rowCount; row++) {
    typeIds.add(types[row]!);
  }
  return [...typeIds].flatMap((typeId) => eventType(typeId)?.type ?? []).sort();
}

const DEBUG_VALUE_TYPES: ReadonlySet<string> = new Set([
  'USER_DEBUG',
  'DATAWEAVE_USER_DEBUG',
  'USER_DEBUG_FINER',
  'USER_DEBUG_FINEST',
  'USER_DEBUG_FINE',
  'USER_DEBUG_DEBUG',
  'USER_DEBUG_INFO',
  'USER_DEBUG_WARN',
  'USER_DEBUG_ERROR',
]);

type ViewGrid = LvGrid<TimeOrderNode> | LvGrid<AggregatedRow> | LvGrid<BottomUpRow>;

type RevealedRow = HiddenRow & { revealed: boolean };

/** What the filters read from a view's rows. Bottom-Up has no type or debug filter. */
interface FilterFields<R> extends MeasureFields<R> {
  type?: { of: (row: R) => string | null | undefined; debugOnly: RowFilter<R> };
  withoutDetails: RowFilter<R>;
}

@customElement('call-tree-view')
export class CalltreeView extends LitElement {
  /** The log on screen, from the app root. */
  @consume({ context: logContext, subscribe: true })
  @property({ attribute: false })
  logStore: LogStore | null = null;

  @state()
  isVisible = false;

  @state()
  viewMode: ViewMode = 'time-order';

  // The view is mounted hidden, so a log whose call tree is never opened costs nothing.
  private readonly _types = new Task(this, {
    task: ([store]) => store?.derive(typeNamesIn) ?? initialState,
    args: () => [this.isVisible ? this.logStore : null],
  });

  // State, so the expand button follows the grid on show once it is built.
  @state()
  timeOrderGrid: LvGrid<TimeOrderNode> | null = null;
  @state()
  aggregatedGrid: LvGrid<AggregatedRow> | null = null;
  @state()
  bottomUpGrid: LvGrid<BottomUpRow> | null = null;
  private _aggregatedTree: MergedTree<AggregatedRow> | null = null;
  private _bottomUpTree: MergedTree<BottomUpRow> | null = null;
  private _timeOrderBuild: Promise<void> | null = null;
  private _aggregatedBuild: Promise<void> | null = null;
  private _bottomUpBuild: Promise<void> | null = null;
  // The Time Order filters read the source on show, so a new log keeps the same filter objects.
  private _timeOrderSource: TimeOrderSource | null = null;
  private readonly _timeOrderDebugOnly = deep<TimeOrderNode>((node) =>
    DEBUG_VALUE_TYPES.has(this._timeOrderSource?.type(node) ?? ''),
  );
  private readonly _timeOrderWithoutDetails: RowFilter<TimeOrderNode> = {
    test: (node) => this._timeOrderSource?.withoutDetails.test(node) ?? true,
  };

  /** `revealed`, so Clear goes to the row in the view on show, as the reveal did, not in Time Order. */
  private readonly _hiddenRows = new HiddenRowController<RevealedRow>(this, {
    grid: () => this._activeGrid(),
    onClear: (hidden) => this._clearFiltersAndGo(hidden),
  });

  filterState: { showDetails: boolean; debugOnly: boolean; selectedTypes: Set<string> } = {
    showDetails: false,
    debugOnly: false,
    selectedTypes: new Set<string>(),
  };
  // True while Details is on only because the Type pick needed it, so a later pick turns it off.
  private _typeTurnedDetailsOn = false;
  bottomUpGroupBy = 'None';
  typeFilter = 'All';
  namespaceSelected: string[] = [];
  totalTimeRange: FilterRange = { start: null, end: null };
  private readonly _filterCache = new RowFilterCache();
  selfTimeRange: FilterRange = { start: null, end: null };

  tableContainer: HTMLDivElement | null = null;
  /** The store the grids were built from. */
  rootStore: LogStore | null = null;

  private readonly _columns = new ColumnSettingsController(this, {
    ...CALL_TREE_COLUMN_SETTINGS,
    // All three, so a mode the user has not switched back to is already right.
    targets: () => this._gridTargets,
  });

  private contextMenu: ContextMenu | null = null;
  /** The event id of the row the menu opened on. */
  private contextMenuEventIndex: number | null = null;
  /** The grid whose header was right-clicked (for column-toggle actions). */
  private contextMenuTarget: ColumnTarget | null = null;
  /** The header the column menu opened from; null from the toolbar. */
  private contextMenuColumn: string | null = null;
  private viewSwitchEpoch = 0;
  /** Drops a pending wait for the view to come on screen, once per attach. */
  private _visibilityWait: AbortController | null = null;
  // Aborted with the grids, so their Aggregated or Bottom-Up build stops.
  private _builds = new AbortController();

  get _callTreeTableWrapper(): HTMLDivElement | null {
    return (this.tableContainer = this.renderRoot?.querySelector('#call-tree-table') ?? null);
  }

  /** Guards the programmatic select made on the inspector's behalf. */
  private _echoGuard = new SelectionEchoGuard();
  private _locateIds = new LocatedRowIds();

  private readonly _documentBus = new DomListenerController<CalltreeNavigationEventMap>(
    this,
    document,
    { [CALLTREE_GO_TO_ROW]: (e) => void this._goToRow(e.detail.eventIndex) },
  );

  private readonly _finder = new FindController(this, {
    targets: () => {
      const grid = this._activeGrid();
      return grid ? [grid] : [];
    },
  });

  private _colorize = false;
  private readonly _subscriptions = new SubscriptionController(this, () => [
    wireCategoryColoring(this, (on) => {
      this._colorize = on;
      for (const grid of this._grids) {
        grid.toggleAttribute('category-colorize', on);
      }
    }),
  ]);

  private readonly _inspector = new InspectorTabController(this, 'calltree', {
    mark: (eventIndexes) => this._markLocated(eventIndexes),
    reveal: (eventIndex, signal) => this._revealEventIndex(eventIndex, signal),
    clear: () => {
      // The grid reports the clear itself, which is what reaches the inspector.
      for (const grid of this._grids) {
        grid.deselect();
      }
    },
    // A picked row merges calls, so the mark shows all of them while the view
    // moves to the first of them.
    revealMerged: revealFirstOf((eventIndex, signal) => this._revealEventIndex(eventIndex, signal)),
  });

  override connectedCallback(): void {
    super.connectedCallback();

    // A detach destroyed the tables, and `updated` builds only for the log's
    // arrival. With a log already in hand this is a re-attach, and the build's
    // own guard decides whether there is anything to do.
    if (this.rootStore) {
      this._appendTableWhenVisible();
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._visibilityWait?.abort();
    this._visibilityWait = null;
    this._destroyCurrentTable();
  }

  updated(changedProperties: PropertyValues): void {
    if (!this.logStore || !changedProperties.has('logStore')) {
      return;
    }
    if (changedProperties.get('logStore')) {
      void this._replaceLog(this.logStore);
    } else {
      this._appendTableWhenVisible();
    }
  }

  private async _replaceLog(store: LogStore): Promise<void> {
    this.rootStore = store;
    this._hiddenRows.invalidate();
    // `rootStore` is not reactive, and the Namespace filter lists its namespaces.
    this.requestUpdate();
    // A build still running reads the old log.
    this._builds.abort();
    this._builds = new AbortController();
    // Each grid keeps its sort, widths, group and filters. Its selection and mark named rows of the old log.
    for (const grid of this._grids) {
      grid.marked = new Set();
      grid.deselect();
    }
    await Promise.all([
      this.timeOrderGrid && this._loadTimeOrder(this.timeOrderGrid, store),
      this.aggregatedGrid && this._loadAggregated(this.aggregatedGrid, store),
      this.bottomUpGrid && this._loadBottomUp(this.bottomUpGrid, store),
    ]);
  }

  firstUpdated(): void {
    this.contextMenu = this.renderRoot.querySelector('context-menu');
  }

  static styles = [
    globalStyles,
    hiddenRowNoteStyles,
    css`
      :host {
        height: 100%;
        width: 100%;
        display: flex;
        /* inset previously provided by the tab panel's padding */
        padding: 10px 6px;
        box-sizing: border-box;
      }

      #call-tree-container {
        display: flex;
        flex-direction: column;
        height: 100%;
        width: 100%;
      }

      #call-tree-table-container {
        height: 100%;
        width: 100%;
        min-height: 0;
        min-width: 0;
        position: relative;
      }

      #call-tree-table,
      #aggregated-tree-table,
      #bottom-up-tree-table {
        display: inline-block;
        height: 100%;
        width: 100%;
      }

      .table-host {
        height: 100%;
        width: 100%;
        position: absolute;
        inset: 0;
      }

      .table-host.is-hidden {
        visibility: hidden;
        opacity: 0;
        pointer-events: none;
      }
    `,
  ];

  render() {
    const skeleton = !this.logStore ? html`<grid-skeleton></grid-skeleton>` : '';
    const isTimeOrder = this.viewMode === 'time-order';

    return html`
      <div id="call-tree-container">
        ${this._hiddenRows.renderStatus()}
        <div>
          <datagrid-filter-bar>
            <view-mode-switch
              slot="global"
              aria-label="View mode"
              .options=${VIEW_MODES}
              value=${this.viewMode}
              @view-mode-change=${(e: CustomEvent<{ value: string }>) =>
                this._setViewMode(e.detail.value as ViewMode)}
            ></view-mode-switch>

            ${columnViewSelect({ id: 'column-view', views: CALL_TREE_VIEWS, columns: this._columns })}

            <overflow-list slot="filters" menu-heading="Filters" icon="filter">
              <datagrid-facet-filter
                label="Namespace"
                .values="${this.rootStore?.log.namespaces ?? []}"
                @datagrid-facet-change="${this._handleNamespaceFacet}"
              ></datagrid-facet-filter>

              ${
                isTimeOrder || this.viewMode === 'aggregated'
                  ? html`
                      <vs-select
                        dense
                        prefix="Type"
                        label="Type"
                        emptyValue=""
                        combobox
                        filter="fuzzy"
                        .filterActive="${this.typeFilter !== 'All'}"
                        @change="${this._handleTypeFilter}"
                      >
                        <vscode-option ?selected="${this.typeFilter === 'All'}">All</vscode-option>
                        ${this._types.render({
                          complete: (types) =>
                            repeat(
                              types,
                              (type, _index) =>
                                html`<vscode-option ?selected="${this.typeFilter === type}"
                                  >${type}</vscode-option
                                >`,
                            ),
                        })}
                      </vs-select>
                    `
                  : ''
              }

              <datagrid-range-filter
                label="Total Time"
                unit="ms"
                @datagrid-range-change="${this._handleTotalTimeRange}"
              ></datagrid-range-filter>

              <datagrid-range-filter
                label="Self Time"
                unit="ms"
                @datagrid-range-change="${this._handleSelfTimeRange}"
              ></datagrid-range-filter>

              <button
                type="button"
                class="filter-control pill-toggle"
                aria-pressed="${this.filterState.showDetails}"
                title="Show Detail Events"
                @click="${this._handleShowDetailsChange}"
              >
                Details
              </button>

              ${
                isTimeOrder || this.viewMode === 'aggregated'
                  ? html`
                      <button
                        type="button"
                        class="filter-control pill-toggle"
                        aria-pressed="${this.filterState.debugOnly}"
                        title="Show Debug Statements Only"
                        @click="${this._handleDebugOnlyChange}"
                      >
                        Debug Only
                      </button>
                    `
                  : ''
              }
            </overflow-list>
            ${gridGroupControls({
              grid: this._activeGrid(),
              group:
                this.viewMode === 'bottom-up'
                  ? {
                      id: 'bottomup-groupby',
                      labels: BOTTOM_UP_GROUPS.map(({ label }) => label),
                      value: this.bottomUpGroupBy,
                      onChange: (label) => this._handleBottomUpGroupBy(label),
                    }
                  : undefined,
            })}
            ${gridToolbarActions({
              openColumns: (event) => this._openColumnMenu(event),
              exportToCSV: () => void this._exportCsv(),
              copyToClipboard: () => void this._activeGrid()?.copy(),
            })}
          </datagrid-filter-bar>
        </div>

        <div id="call-tree-table-container">
          ${this._hiddenRows.renderNote()} ${skeleton}
          <div class="table-host ${this.viewMode === 'time-order' ? '' : 'is-hidden'}">
            <div id="call-tree-table"></div>
          </div>
          <div class="table-host ${this.viewMode === 'aggregated' ? '' : 'is-hidden'}">
            <div id="aggregated-tree-table"></div>
          </div>
          <div class="table-host ${this.viewMode === 'bottom-up' ? '' : 'is-hidden'}">
            <div id="bottom-up-tree-table"></div>
          </div>
        </div>
        <context-menu
          @menu-select="${this._handleContextMenuSelect}"
          @menu-close="${this._onColumnMenuClose}"
        ></context-menu>
      </div>
    `;
  }

  _handleShowDetailsChange() {
    this.filterState.showDetails = !this.filterState.showDetails;
    this._typeTurnedDetailsOn = false;
    this.requestUpdate();
    this._updateFiltering();
  }

  _handleDebugOnlyChange() {
    this.filterState.debugOnly = !this.filterState.debugOnly;
    this.requestUpdate();
    this._updateFiltering();
  }

  async _setViewMode(newMode: ViewMode): Promise<void> {
    if (newMode === this.viewMode) {
      return;
    }
    // The bar names a row of the view left behind. Not an invalidate: a go-to switches views mid-flight.
    this._hiddenRows.dismiss();

    const switchEpoch = ++this.viewSwitchEpoch;
    this.viewMode = newMode;
    await this.updateComplete;
    await waitForNextFrame();

    if (switchEpoch !== this.viewSwitchEpoch || !this.rootStore) {
      return;
    }

    await this._renderActiveView();

    if (switchEpoch !== this.viewSwitchEpoch) {
      return;
    }
    void this._finder.rerun();
    // After the rerun starts, so a search still running on a grid left behind ends stale, not dropped.
    [this.timeOrderGrid, this.aggregatedGrid, this.bottomUpGrid]
      .filter((grid) => grid !== this._activeGrid())
      .forEach((grid) => grid?.clearFind());

    // The selection is untouched, but the direction this tab shows is not, and
    // that is what the inspector opens on the other side of.
    eventBus.emit('detail:view', { source: 'calltree', view: directionOf(this.viewMode) });
  }

  /** Build the table for the view on show, if it has none. */
  private async _renderActiveView(): Promise<void> {
    const store = this.rootStore;
    const container = this.renderRoot?.querySelector<HTMLDivElement>(CONTAINER_IDS[this.viewMode]);
    if (!store || !container) {
      return;
    }

    switch (this.viewMode) {
      case 'time-order':
        await this._renderCallTree(container, store);
        break;
      case 'aggregated':
        await this._renderAggregatedTree(container, store);
        break;
      case 'bottom-up':
        await this._renderBottomUpTree(container, store);
        break;
    }
    // A fresh table carries none of the filters on show, so every build applies
    // them — a re-attach rebuilds under the filters the user left in force.
    this._applyFilters();
  }

  private _destroyCurrentTable(): void {
    this._builds.abort();
    this._builds = new AbortController();
    for (const grid of this._grids) {
      grid.remove();
    }
    this.timeOrderGrid = null;
    this.aggregatedGrid = null;
    this.bottomUpGrid = null;
    this._aggregatedTree = null;
    this._bottomUpTree = null;
    this._timeOrderBuild = null;
    this._aggregatedBuild = null;
    this._bottomUpBuild = null;
    this._timeOrderSource = null;
  }

  _handleBottomUpGroupBy(label: string) {
    this.bottomUpGroupBy = label;
    if (this.bottomUpGrid) {
      this.bottomUpGrid.groupBy = bottomUpGroupBy(label);
    }
  }

  private get _grids(): ViewGrid[] {
    return [this.timeOrderGrid, this.aggregatedGrid, this.bottomUpGrid].filter(
      (grid) => grid !== null,
    );
  }

  private get _gridTargets(): ColumnTarget[] {
    const targets: ColumnTarget[] = [];
    if (this.timeOrderGrid) {
      targets.push(gridColumnTarget(this.timeOrderGrid));
    }
    if (this.aggregatedGrid) {
      targets.push(gridColumnTarget(this.aggregatedGrid));
    }
    if (this.bottomUpGrid) {
      targets.push(gridColumnTarget(this.bottomUpGrid));
    }
    return targets;
  }

  /** The grid of the view on show, once built. */
  private _activeGrid(): ViewGrid | null {
    switch (this.viewMode) {
      case 'time-order':
        return this.timeOrderGrid;
      case 'aggregated':
        return this.aggregatedGrid;
      case 'bottom-up':
        return this.bottomUpGrid;
    }
  }

  /** The build that fills the grid of the view on show with the rows of the current log. */
  private _activeBuild(): Promise<void> | null {
    switch (this.viewMode) {
      case 'time-order':
        return this._timeOrderBuild;
      case 'aggregated':
        return this._aggregatedBuild;
      case 'bottom-up':
        return this._bottomUpBuild;
    }
  }

  private async _exportCsv(): Promise<void> {
    const grid = this._activeGrid();
    if (grid) {
      await exportCsv(grid, `call-tree-${this.viewMode}.csv`);
    }
  }

  private _showHeaderContextMenu(
    target: ColumnTarget,
    clientX: number,
    clientY: number,
    column: string | null = null,
  ) {
    if (!this.contextMenu) {
      return;
    }
    this.contextMenuEventIndex = null;
    this.contextMenuTarget = target;
    this.contextMenuColumn = column;
    this.contextMenu.show(this._columns.menuItems(target, column), clientX, clientY);
  }

  private _activeColumnTarget(): ColumnTarget | null {
    switch (this.viewMode) {
      case 'time-order':
        return this.timeOrderGrid && gridColumnTarget(this.timeOrderGrid);
      case 'aggregated':
        return this.aggregatedGrid && gridColumnTarget(this.aggregatedGrid);
      case 'bottom-up':
        return this.bottomUpGrid && gridColumnTarget(this.bottomUpGrid);
    }
  }

  private _openColumnMenu(event: Event) {
    const table = this._activeColumnTarget();
    if (!table) {
      return;
    }
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this._showHeaderContextMenu(table, rect.left, rect.bottom);
  }

  /** Rebuilds the open column menu so checkmarks/reset icons reflect current state. */
  private _refreshColumnMenu() {
    if (!this.contextMenu?.isVisible() || !this.contextMenuTarget) {
      return;
    }
    this.contextMenu.items = this._columns.menuItems(
      this.contextMenuTarget,
      this.contextMenuColumn,
    );
  }

  private _onColumnMenuClose() {
    this.contextMenuTarget = null;
    this.contextMenuColumn = null;
    this.contextMenuEventIndex = null;
  }

  _handleTypeFilter(event: Event) {
    this._setTypeFilter((event.target as HTMLInputElement).value);
    // typeFilter is a plain field (not @state), so the Type select's
    // `.filterActive` binding doesn't repaint until some other reactive
    // update happens to coincide — force it so the active border shows on
    // the very first pick, not a later render.
    this.requestUpdate();
    this._updateFiltering();
  }

  /**
   * Picks `type` in the Type filter, or none for ''. A detail type turns Details on, and a later
   * pick turns it off again unless Details was on already.
   */
  private _setTypeFilter(type: string): void {
    this.typeFilter = type || 'All';
    this.filterState.selectedTypes = new Set(type ? [type] : []);
    // A listed type only: All and text typed in the box would read as a detail.
    const needsDetails = !!this._types.value?.includes(type) && eventKind(type) === 'detail';
    if (needsDetails && !this.filterState.showDetails) {
      this.filterState.showDetails = true;
      this._typeTurnedDetailsOn = true;
    } else if (!needsDetails && this._typeTurnedDetailsOn) {
      this.filterState.showDetails = false;
      this._typeTurnedDetailsOn = false;
    }
  }

  _handleNamespaceFacet(event: CustomEvent<{ selected: string[] }>) {
    this.namespaceSelected = event.detail.selected;
    this._updateFiltering();
  }

  _handleTotalTimeRange(event: CustomEvent<{ range: FilterRange }>) {
    this.totalTimeRange = event.detail.range;
    this._updateFiltering();
  }

  _handleSelfTimeRange(event: CustomEvent<{ range: FilterRange }>) {
    this.selfTimeRange = event.detail.range;
    this._updateFiltering();
  }

  _updateFiltering() {
    // A go-to still running read the old filters, so its note would be stale.
    this._hiddenRows.invalidate();
    this._applyFilters();
  }

  // Not a filter change, so a build leaves the hidden-row note in place.
  private _applyFilters() {
    if (this.timeOrderGrid && this.viewMode === 'time-order') {
      this.timeOrderGrid.filters = this._timeOrderFilters();
      return;
    }
    if (this.aggregatedGrid && this.viewMode === 'aggregated') {
      this.aggregatedGrid.filters = this._aggregatedFilters();
      return;
    }
    if (this.bottomUpGrid && this.viewMode === 'bottom-up') {
      this.bottomUpGrid.filters = this._bottomUpFilters();
    }
  }

  /** The filters of {@link _updateFiltering} for the Aggregated grid: Time Order's, on its rows. */
  private _aggregatedFilters(): RowFilter<AggregatedRow>[] {
    return this._viewFilters<AggregatedRow>('aggregated', {
      namespace: (row) => row.namespace,
      total: (row) => row.totalTime,
      self: (row) => row.totalSelfTime,
      type: { of: (row) => row.type, debugOnly: AGGREGATED_DEBUG_ONLY },
      withoutDetails: AGGREGATED_WITHOUT_DETAILS,
    });
  }

  /** The filters of {@link _updateFiltering} for the Time Order grid. */
  private _timeOrderFilters(): RowFilter<TimeOrderNode>[] {
    return this._viewFilters<TimeOrderNode>('time-order', {
      namespace: (node) => this._timeOrderSource?.namespace(node),
      total: ({ row }) => this._timeOrderSource?.index.total[row] ?? 0,
      self: ({ row }) => this._timeOrderSource?.index.self[row] ?? 0,
      type: {
        of: (node) => this._timeOrderSource?.type(node),
        debugOnly: this._timeOrderDebugOnly,
      },
      withoutDetails: this._timeOrderWithoutDetails,
    });
  }

  /** The filters of {@link _updateFiltering} for the Bottom-Up grid: no type or debug filter. */
  private _bottomUpFilters(): RowFilter<BottomUpRow>[] {
    return this._viewFilters<BottomUpRow>('bottom-up', {
      ...BOTTOM_UP_MEASURES,
      withoutDetails: BOTTOM_UP_WITHOUT_DETAILS,
    });
  }

  private _viewFilters<R>(view: ViewMode, fields: FilterFields<R>): RowFilter<R>[] {
    const filters = measureFilters(
      { namespaces: this.namespaceSelected, total: this.totalTimeRange, self: this.selfTimeRange },
      fields,
      this._filterCache,
      view,
    );
    const { type } = fields;
    if (type && this.filterState.debugOnly) {
      filters.push(type.debugOnly);
      return filters;
    }
    const types = this.filterState.selectedTypes;
    if (type && types.size > 0 && !types.has('All')) {
      filters.push(
        this._filterCache.reuse(`${view}:type`, [...types].join('\n'), () =>
          deep((row) => {
            const of = type.of(row);
            return !!of && types.has(of);
          }),
        ),
      );
    }
    if (!this.filterState.showDetails) {
      filters.push(fields.withoutDetails);
    }
    return filters;
  }

  /**
   * Mark the rows of the view on screen for `eventIndexes`. Time Order stamps the
   * event index itself; a grouped view stamps the bucket path, so a frame is
   * translated into the paths of the rows it belongs to — one in Aggregated, one
   * per caller depth in Bottom-Up.
   */
  private _markLocated(eventIndexes: readonly number[]): void {
    if (this.timeOrderGrid && this.viewMode === 'time-order') {
      this.timeOrderGrid.marked = new Set(eventIndexes);
      return;
    }
    const pathIds = this._locateIds.idsFor(
      this.rootStore,
      eventIndexes,
      directionOf(this.viewMode),
    );
    if (this.aggregatedGrid && this.viewMode === 'aggregated') {
      this.aggregatedGrid.marked = this._aggregatedTree?.marked(pathIds) ?? new Set();
    } else if (this.bottomUpGrid && this.viewMode === 'bottom-up') {
      this.bottomUpGrid.marked = this._bottomUpTree?.marked(pathIds) ?? new Set();
    }
  }

  _appendTableWhenVisible() {
    if (this._activeGrid()) {
      return;
    }

    this.rootStore = this.logStore;
    this._visibilityWait?.abort();
    this._visibilityWait = new AbortController();
    void isVisible(this, undefined, this._visibilityWait.signal).then((visible) => {
      this.isVisible = visible;
      // An abort cannot catch a wait that has already resolved, so the build
      // asks whether the view is still here.
      if (visible && this.isConnected) {
        void this._renderActiveView();
      }
    });
  }

  async _goToRow(eventIndex: number) {
    const store = this.rootStore;
    if (!store) {
      return;
    }
    const latest = this._hiddenRows.begin();
    // A view switch by the user moves the bar and focus off the Time Order grid.
    const current = () => latest() && store === this.rootStore && this.viewMode === 'time-order';
    document.dispatchEvent(new CustomEvent('show-tab', { detail: { tabid: 'tree-tab' } }));

    if (this.viewMode !== 'time-order') {
      // Through the switch, so the inspector hears the direction change too.
      await this._setViewMode('time-order');
    }

    if (!this._callTreeTableWrapper || !current()) {
      return;
    }

    await this._renderCallTree(this._callTreeTableWrapper, store);
    const grid = this.timeOrderGrid;
    const path = this._timeOrderPath(eventIndex);
    if (!grid || !path.length || !current()) {
      return;
    }
    this._showDetailsFor(eventIndex, 'time-order');
    const result = await grid.goTo(path);
    if (result === 'superseded' || !current()) {
      return;
    }
    const hidden = hiddenAfterGoTo({ eventIndex, path, result, selectedKey: grid.selectedKey });
    this._hiddenRows.show(hidden && { ...hidden, revealed: false });
    if (result === 'selected') {
      grid.focus({ preventScroll: true });
    }
  }

  /** Clears the filters that can hide `hidden`'s row, then goes to it again the way it was reached. */
  private async _clearFiltersAndGo(hidden: RevealedRow): Promise<void> {
    const { eventIndex, revealed } = hidden;
    clearGridFilters(this.renderRoot);
    this._setTypeFilter('');
    // Details is left as is: the go-to turns it on when it hides the row.
    this.filterState = { ...this.filterState, debugOnly: false, selectedTypes: new Set() };
    this.requestUpdate();
    this._updateFiltering();
    if (revealed) {
      await this._revealEventIndex(eventIndex, new AbortController().signal);
    } else {
      await this._goToRow(eventIndex);
    }
  }

  /** Details sets how much shows, not what, so it is turned on rather than reported, as Analysis does. */
  private _showDetailsFor(eventIndex: number, mode: ViewMode): void {
    if (this.filterState.showDetails || !this._detailsHide(eventIndex, mode)) {
      return;
    }
    this.filterState = { ...this.filterState, showDetails: true };
    this.requestUpdate();
    // Not `_updateFiltering`: its invalidate would cancel the go-to turning Details on.
    this._applyFilters();
  }

  private _detailsHide(eventIndex: number, mode: ViewMode): boolean {
    switch (mode) {
      case 'time-order': {
        const row = this._timeOrderSource?.index.rowOf(eventIndex) ?? NO_ROW;
        return row !== NO_ROW && !this._timeOrderWithoutDetails.test({ row });
      }
      case 'aggregated': {
        const row = this._aggregatedTree?.rowFor(this._pathIds(eventIndex, mode));
        return !!row && !AGGREGATED_WITHOUT_DETAILS.test(row);
      }
      case 'bottom-up': {
        const row = this._bottomUpTree?.rowFor(this._pathIds(eventIndex, mode));
        return !!row && !BOTTOM_UP_WITHOUT_DETAILS.test(row);
      }
    }
  }

  /**
   * Select the row for `eventIndex` in the view on screen, in place: no tab
   * switch, no view-mode change and no focus steal, unlike {@link _goToRow}.
   * Focus stays where the click was, which is the inspector.
   */
  private async _revealEventIndex(eventIndex: number, signal: AbortSignal): Promise<void> {
    this._hiddenRows.invalidate();
    // A new log reaches `rootStore` in `updated`.
    await this.updateComplete;
    const grid = this._activeGrid();
    const store = this.rootStore;
    if (!grid || signal.aborted) {
      return;
    }
    // A failed build shows its own alert in the grid.
    await this._activeBuild()?.catch(() => undefined);
    if (signal.aborted || store !== this.rootStore || grid !== this._activeGrid()) {
      return;
    }
    // Taken after the build, so a filter changed while it ran does not drop the reveal.
    const latest = this._hiddenRows.begin();
    this._showDetailsFor(eventIndex, this.viewMode);
    const path = this._pathTo(eventIndex);
    const result = await this._echoGuard.runAsync(() =>
      grid.goTo(path, { scrollIfVisible: false }),
    );
    // A view switch moves the bar's grid, so a result for the one left behind is dropped.
    if (signal.aborted || !latest() || store !== this.rootStore || grid !== this._activeGrid()) {
      return;
    }
    const hidden = hiddenAfterGoTo({ eventIndex, path, result, selectedKey: grid.selectedKey });
    this._hiddenRows.show(hidden && { ...hidden, revealed: true });
  }

  /** The keys from a top-level row down to the row of the view on show for `eventIndex`. */
  private _pathTo(eventIndex: number): RowKey[] {
    switch (this.viewMode) {
      case 'time-order':
        return this._timeOrderPath(eventIndex);
      case 'aggregated':
        return this._aggregatedTree?.pathTo(this._pathIds(eventIndex, this.viewMode)) ?? [];
      case 'bottom-up':
        return this._bottomUpTree?.pathTo(this._pathIds(eventIndex, this.viewMode)) ?? [];
    }
  }

  private _pathIds(eventIndex: number, mode: ViewMode): readonly number[] {
    const direction: SelectionView = directionOf(mode);
    return this._locateIds.idsFor(this.rootStore, [eventIndex], direction);
  }

  /** The keys from a top-level row down to the Time Order row for `eventIndex`. */
  private _timeOrderPath(eventIndex: number): RowKey[] {
    return this.rootStore?.pathTo(eventIndex) ?? [];
  }

  private async _renderCallTree(
    callTreeTableContainer: HTMLDivElement,
    store: LogStore,
  ): Promise<void> {
    if (this.timeOrderGrid) {
      // A failed build shows its own alert in the grid.
      await this._timeOrderBuild?.catch(() => undefined);
      await waitForNextFrame();
      return;
    }

    const grid = this._mountGrid<TimeOrderNode>(callTreeTableContainer, 'time-order', (node) => ({
      eventIndex: this._timeOrderSource?.key(node),
    }));
    this.timeOrderGrid = grid;
    grid.filters = this._timeOrderFilters();
    grid.addEventListener('lv-grid-context', (e) => {
      const { row, event } = (e as CustomEvent<GridContextDetail<TimeOrderNode>>).detail;
      if (!row || window.getSelection()?.type === 'Range') {
        return;
      }
      event.preventDefault();
      this._showRowContextMenu(row, event.clientX, event.clientY);
    });
    await this._loadTimeOrder(grid, store);
  }

  private _loadTimeOrder(grid: LvGrid<TimeOrderNode>, store: LogStore): Promise<void> {
    this._timeOrderBuild = this._fillTimeOrder(grid, store);
    return this._timeOrderBuild;
  }

  private async _fillTimeOrder(grid: LvGrid<TimeOrderNode>, store: LogStore): Promise<void> {
    const [reported, index] = await Promise.all([reportedUsageOf(store.log), store.logIndex()]);
    // A newer log can load while this one waits.
    if (this.rootStore !== store) {
      return;
    }
    const source = new TimeOrderSource(index);
    this._timeOrderSource = source;
    // A time-order node holds only its row, so the colour strip asks the source for the category.
    grid.rowClass = (node) => categoryClass({ category: source.category(node) });
    grid.columns = timeOrderColumns(source, { openType, reported });
    this._columns.applyTo(gridColumnTarget(grid));
    grid.source = source;
    return grid.settled();
  }

  private async _renderAggregatedTree(container: HTMLDivElement, store: LogStore): Promise<void> {
    if (this.aggregatedGrid) {
      await this._aggregatedBuild;
      await waitForNextFrame();
      return;
    }

    const grid = this._mountGrid<AggregatedRow>(
      container,
      'aggregated',
      (row) => row,
      (row) => this._aggregatedTree?.parentOf(row),
    );
    this.aggregatedGrid = grid;
    grid.filters = this._aggregatedFilters();
    await this._loadAggregated(grid, store);
  }

  private _loadAggregated(grid: LvGrid<AggregatedRow>, store: LogStore): Promise<void> {
    this._aggregatedBuild = this._fillAggregatedTree(grid, store);
    return this._aggregatedBuild;
  }

  private async _fillAggregatedTree(grid: LvGrid<AggregatedRow>, store: LogStore): Promise<void> {
    const reported = await reportedUsageOf(store.log);
    if (this.rootStore !== store || this.aggregatedGrid !== grid) {
      return;
    }
    grid.columns = aggregatedColumns(store.log, { openType, reported });
    grid.rowLines = mergedLines(store.log);
    this._columns.applyTo(gridColumnTarget(grid));
    const tree = await MergedTree.aggregated(store, { signal: this._builds.signal });
    // A build can finish just before a detach, and a later one owns the container now.
    if (!tree || this.aggregatedGrid !== grid) {
      return;
    }
    this._aggregatedTree = tree;
    grid.source = tree.source;
    await grid.settled();
  }

  private async _renderBottomUpTree(container: HTMLDivElement, store: LogStore): Promise<void> {
    if (this.bottomUpGrid) {
      await this._bottomUpBuild;
      await waitForNextFrame();
      return;
    }

    const grid = this._mountGrid<BottomUpRow>(
      container,
      'bottom-up',
      (row) => row,
      (row) => this._bottomUpTree?.parentOf(row),
    );
    this.bottomUpGrid = grid;
    grid.sort = BOTTOM_UP_SORT;
    grid.groupBy = bottomUpGroupBy(this.bottomUpGroupBy);
    grid.filters = this._bottomUpFilters();
    await this._loadBottomUp(grid, store);
  }

  private _loadBottomUp(grid: LvGrid<BottomUpRow>, store: LogStore): Promise<void> {
    this._bottomUpBuild = this._fillBottomUpTree(grid, store);
    return this._bottomUpBuild;
  }

  private async _fillBottomUpTree(grid: LvGrid<BottomUpRow>, store: LogStore): Promise<void> {
    const reported = await reportedUsageOf(store.log);
    if (this.rootStore !== store || this.bottomUpGrid !== grid) {
      return;
    }
    grid.columns = bottomUpColumns(store.log, { openType, reported });
    grid.rowLines = mergedLines(store.log);
    this._columns.applyTo(gridColumnTarget(grid));
    const tree = await MergedTree.bottomUp(store, { signal: this._builds.signal });
    // A build can finish just before a detach, and a later one owns the container now.
    if (!tree || this.bottomUpGrid !== grid) {
      return;
    }
    this._bottomUpTree = tree;
    grid.source = tree.source;
    await grid.settled();
  }

  /**
   * An lv-grid in `container`, with the header menu, the search reset and both
   * halves of the inspector wired. `data` and `parentOf` give the shape the
   * inspector reads a row by.
   */
  private _mountGrid<R extends object>(
    container: HTMLElement,
    mode: ViewMode,
    data: (row: R) => RowData,
    parentOf: (row: R) => R | undefined = () => undefined,
  ): LvGrid<R> {
    const grid = document.createElement('lv-call-tree-grid') as unknown as LvGrid<R>;
    grid.label = callTreeLabel(mode);
    grid.toggleAttribute('category-colorize', this._colorize);
    const inspector = inspectorRowEvents<R>({
      source: 'calltree',
      store: () => this.rootStore,
      view: () => directionOf(this.viewMode),
      data,
      parentOf,
      echoGuard: this._echoGuard,
      dropPick: () => this._inspector.dropPick(),
    });

    grid.addEventListener('lv-grid-header-context', (e) => {
      const { column, event } = (e as CustomEvent<GridHeaderContextDetail>).detail;
      event.preventDefault();
      this._showHeaderContextMenu(gridColumnTarget(grid), event.clientX, event.clientY, column);
    });
    grid.addEventListener('lv-grid-reshape', () => void this._finder.rerun());
    grid.addEventListener('lv-grid-select', inspector.select);
    grid.addEventListener('lv-grid-locate', inspector.locate);

    container.replaceChildren(grid);
    return grid;
  }

  private _showRowContextMenu(node: TimeOrderNode, clientX: number, clientY: number): void {
    const eventIndex = this._timeOrderSource?.key(node);
    const event = eventIndex === undefined ? null : this.rootStore?.eventByIndex(eventIndex);
    if (!this.contextMenu || !event) {
      return;
    }

    this.contextMenuEventIndex = event.id;

    const items: { id: string; label: string; separator?: boolean; shortcut?: string }[] = [];

    items.push({ id: 'show-in-timeline', label: 'Show in Timeline' });

    if (event.isApexCall) {
      items.push({ id: 'go-to-source', label: 'Go to Source' });
    }

    if (event.startTimestamp) {
      items.push({ id: 'show-in-log', label: 'Show in Log File' });
    }

    items.push(
      { id: 'separator-1', label: '', separator: true },
      { id: 'copy-name', label: 'Copy Name' },
    );

    this.contextMenu.show(items, clientX, clientY);
  }

  private _handleContextMenuSelect(e: CustomEvent<{ itemId: string }>): void {
    const { itemId } = e.detail;

    // Column-header menu actions (see _showHeaderContextMenu). These keep the menu
    // open (keepOpen), so refresh its items live and leave contextMenuTarget set —
    // it's cleared on menu-close.
    if (itemId.startsWith('view:')) {
      this._columns.choose(itemId.slice('view:'.length));
      this._refreshColumnMenu();
      return;
    }
    if (itemId.startsWith('col:')) {
      if (this.contextMenuTarget) {
        this._columns.toggle(this.contextMenuTarget, itemId.slice('col:'.length));
        this._refreshColumnMenu();
      }
      return;
    }
    if (itemId.startsWith('reset:')) {
      this._columns.reset(itemId.slice('reset:'.length));
      this._refreshColumnMenu();
      return;
    }
    if (selectColumnWidthItem(this.contextMenuTarget?.grid?.() ?? null, itemId)) {
      return;
    }

    const event =
      this.contextMenuEventIndex === null
        ? null
        : this.rootStore?.eventByIndex(this.contextMenuEventIndex);
    if (!event) {
      return;
    }
    const text = event.text ?? event.type;

    switch (e.detail.itemId) {
      case 'show-in-log':
        vscodeMessenger.send('goToLogLine', { timestamp: event.startTimestamp });
        break;

      case 'show-in-timeline':
        goToTimelineEvent({ eventIndex: event.id });
        break;

      case 'go-to-source':
        openType(text);
        break;

      case 'copy-name':
        void navigator.clipboard.writeText(text);
        break;
    }

    this.contextMenuEventIndex = null;
  }
}
