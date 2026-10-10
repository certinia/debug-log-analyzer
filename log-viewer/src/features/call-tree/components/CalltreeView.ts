/*
 * Copyright (c) 2022 Certinia Inc. All rights reserved.
 */
import '#vscode-elements/vscode-button.js';
import '#vscode-elements/vscode-option.js';
import '#vscode-elements/vscode-toolbar-button.js';
import '../../../components/VsSelect.js';
import { initialState, Task } from '@lit/task';
import { css, html, LitElement, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';

import type { ApexLog, LogEvent } from '@apexdevtools/apex-log-parser';
import { DomListenerController } from '../../../core/events/DomListenerController.js';
import { eventBus, type SelectionView } from '../../../core/events/EventBus.js';
import { SelectionEchoGuard } from '../../../core/events/SelectionEchoGuard.js';
import { SubscriptionController } from '../../../core/events/SubscriptionController.js';
import { vscodeMessenger } from '../../../core/messaging/VSCodeExtensionMessenger.js';
import type { LogIndex } from '../../../core/log/LogIndex.js';
import { logStoreFor } from '../../../core/log/LogStore.js';
import { eventByEventIndex } from '../../../core/utility/EventSearch.js';
import { isVisible } from '../../../core/utility/Util.js';
import { CALLTREE_GO_TO_ROW, type CalltreeNavigationEventMap } from '../navigation.js';
import {
  buildAggregatedTree,
  buildBottomUpTree,
  type AggregatedRow,
  type BottomUpRow,
} from '../utils/Aggregation.js';
import { wireCategoryColoring } from '../utils/CategoryColoring.js';
import { waitForNextFrame } from '../../../core/utility/FrameBudget.js';
import type {
  GridContextDetail,
  GridHeaderContextDetail,
  LvGrid,
  RowFilter,
  RowKey,
} from '../../../grid/index.js';
import '../grid/CallTreeGrid.js';
import { eventCategoryClass } from '../grid/CallTreeGrid.js';
import {
  aggregatedColumns,
  BOTTOM_UP_DETAILS,
  BOTTOM_UP_SORT,
  bottomUpColumns,
  bottomUpGroupBy,
  mergedLines,
  TIME_ORDER_DETAILS,
  timeOrderColumns,
  timeOrderSource,
} from '../grid/columns.js';
import { inspectorRowEvents } from '../grid/inspectorRowEvents.js';
import {
  linkRows,
  markedIds,
  mergedPath,
  rowStandIn,
  type MergedLinks,
} from '../grid/mergedRows.js';

import { inMsRange, type FilterRange } from '../../../tabulator/filters/MinMax.js';

// styles
import { globalStyles } from '../../../styles/global.styles.js';

// web components
import '../../../components/ContextMenu.js';
import type { ContextMenu } from '../../../components/ContextMenu.js';
import '../../../components/GridSkeleton.js';
import '../../../components/ViewModeSwitch.js';
import { VIEW_MODES, directionOf, type ViewMode } from '../../../components/callTreeViewModes.js';
import '../../../components/datagrid-facet-filter.js';
import '../../../components/datagrid-filter-bar.js';
import '../../../components/datagrid-range-filter.js';
import '../../../components/OverflowList.js';

import {
  ColumnSettingsController,
  gridColumnTarget,
  type ColumnTarget,
} from '../../../components/ColumnSettingsController.js';
import { CALL_TREE_VIEWS } from '../../../tabulator/ColumnViews.js';
import { LocatedRowIds } from '../../../components/locatedRow.js';
import { InspectorTabController } from '../../../components/InspectorTabController.js';
import { LvGridFindController } from '../../../components/grid/LvGridFindController.js';
import { revealFirstOf } from '../../../components/inspectorTab.js';

/** The Name column is always shown in the call-tree tables. */
const ALWAYS_VISIBLE = ['text'];

const AGGREGATED_DETAILS: RowFilter<AggregatedRow> = { test: (row) => row._hasDetailsDeep };
const AGGREGATED_DEBUG_ONLY: RowFilter<AggregatedRow> = {
  test: (row) => !!row.originalData.type && DEBUG_VALUE_TYPES.has(row.originalData.type),
  keepAncestors: true,
};

const openType = (text: string): void => vscodeMessenger.send<string>('openType', text);

/** Where each view builds its table. */
const CONTAINER_IDS: Record<ViewMode, string> = {
  'time-order': '#call-tree-table',
  aggregated: '#aggregated-tree-table',
  'bottom-up': '#bottom-up-tree-table',
};

function typeNamesIn(index: LogIndex): string[] {
  const types = new Set<string>();
  for (let row = 0; row < index.rowCount; row++) {
    const type = index.event(row).type;
    if (type) {
      types.add(type);
    }
  }
  return [...types].sort();
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

const DEBUG_ONLY: RowFilter<LogEvent> = {
  test: (event) => !!event.type && DEBUG_VALUE_TYPES.has(event.type),
  keepAncestors: true,
};

/** A filter that keeps a matching row's ancestors, as Tabulator's `deepFilter` does. */
const deep = <R>(test: (row: R) => boolean): RowFilter<R> => ({ test, keepAncestors: true });

const hasRange = (range: FilterRange): boolean => range.start !== null || range.end !== null;
const rangeKey = (range: FilterRange): string => `${range.start}:${range.end}`;

type ViewGrid = LvGrid<LogEvent> | LvGrid<AggregatedRow> | LvGrid<BottomUpRow>;

@customElement('call-tree-view')
export class CalltreeView extends LitElement {
  @property()
  timelineRoot: ApexLog | null = null;

  @state()
  isVisible = false;

  @state()
  viewMode: ViewMode = 'time-order';

  // The view is mounted hidden, so a log whose call tree is never opened costs nothing.
  private readonly _types = new Task(this, {
    task: ([store]) => store?.derive(typeNamesIn) ?? initialState,
    args: () => [this.isVisible && this.timelineRoot ? logStoreFor(this.timelineRoot) : null],
  });

  timeOrderGrid: LvGrid<LogEvent> | null = null;
  aggregatedGrid: LvGrid<AggregatedRow> | null = null;
  bottomUpGrid: LvGrid<BottomUpRow> | null = null;
  private _aggregatedLinks: MergedLinks<AggregatedRow> | null = null;
  private _bottomUpLinks: MergedLinks<BottomUpRow> | null = null;

  filterState: { showDetails: boolean; debugOnly: boolean; selectedTypes: Set<string> } = {
    showDetails: false,
    debugOnly: false,
    selectedTypes: new Set<string>(),
  };
  bottomUpGroupBy = 'None';
  typeFilter = 'All';
  namespaceSelected: string[] = [];
  totalTimeRange: FilterRange = { start: null, end: null };
  private readonly _filterSlots = new Map<string, { input: string; filter: RowFilter<unknown> }>();
  selfTimeRange: FilterRange = { start: null, end: null };

  tableContainer: HTMLDivElement | null = null;
  rootMethod: ApexLog | null = null;

  private readonly _columns = new ColumnSettingsController(this, {
    section: 'callTree',
    read: (settings) => settings.callTree,
    views: CALL_TREE_VIEWS,
    alwaysVisible: ALWAYS_VISIBLE,
    // All three, so a mode the user has not switched back to is already right.
    tables: () => this._gridTargets,
  });

  private contextMenu: ContextMenu | null = null;
  private contextMenuRow: LogEvent | null = null;
  /** The grid whose header was right-clicked (for column-toggle actions). */
  private contextMenuTable: ColumnTarget | null = null;
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

  private readonly _finder = new LvGridFindController(this, {
    grids: () => {
      const grid = this._activeGrid();
      return grid ? [grid] : [];
    },
  });

  private readonly _subscriptions = new SubscriptionController(this, () => [
    wireCategoryColoring(this, (on) => {
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
    if (this.rootMethod) {
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
    if (
      this.timelineRoot &&
      changedProperties.has('timelineRoot') &&
      !changedProperties.get('timelineRoot')
    ) {
      this._appendTableWhenVisible();
    }
  }

  firstUpdated(): void {
    this.contextMenu = this.renderRoot.querySelector('context-menu');
  }

  static styles = [
    globalStyles,
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

      .filter-container {
        display: flex;
        gap: 4px;
        align-items: flex-end;
      }

      .filter-container vscode-button {
        height: var(--filter-control-height);
      }

      .filter-container vscode-button::part(base) {
        padding: var(--filter-control-padding);
        font-size: var(--filter-control-font-size);
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
    const skeleton = !this.timelineRoot ? html`<grid-skeleton></grid-skeleton>` : '';
    const isTimeOrder = this.viewMode === 'time-order';

    return html`
      <div id="call-tree-container">
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

            <div slot="table-actions" class="filter-container">
              <vscode-button secondary @click="${this._expandButtonClick}">Expand</vscode-button>
              <vscode-button secondary @click="${this._collapseButtonClick}"
                >Collapse</vscode-button
              >

              <vs-select
                dense
                id="column-view"
                prefix="Columns"
                label="Column view"
                @change="${this._handleColumnViewChange}"
                @vs-reset-option="${this._onResetOption}"
                .value="${this._columns.view}"
                .resettableValues="${this._columns.editedViews}"
              >
                ${repeat(
                  CALL_TREE_VIEWS,
                  (view) => view.id,
                  (view) =>
                    html`<vscode-option
                      value="${view.id}"
                      ?selected="${this._columns.view === view.id}"
                      >${view.id}</vscode-option
                    >`,
                )}
              </vs-select>
            </div>

            <overflow-list slot="filters" menu-heading="Filters" icon="filter">
              <datagrid-facet-filter
                label="Namespace"
                .values="${this.rootMethod?.namespaces ?? []}"
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
                        @click="${this._handleDebugOnlyChange}"
                      >
                        Debug Only
                      </button>
                    `
                  : ''
              }
            </overflow-list>

            ${
              this.viewMode === 'bottom-up'
                ? html`
                    <vs-select
                      dense
                      slot="group"
                      id="bottomup-groupby"
                      prefix="Group"
                      label="Group by"
                      @change="${this._handleBottomUpGroupBy}"
                      .value="${this.bottomUpGroupBy}"
                    >
                      <vscode-option>None</vscode-option>
                      <vscode-option>Namespace</vscode-option>
                      <vscode-option>Caller Namespace</vscode-option>
                      <vscode-option>Type</vscode-option>
                    </vs-select>
                  `
                : ''
            }

            <div slot="actions">
              <vscode-toolbar-button
                icon="list-selection"
                label="Columns"
                title="Columns"
                @click="${this._openColumnMenu}"
              ></vscode-toolbar-button>
            </div>
          </datagrid-filter-bar>
        </div>

        <div id="call-tree-table-container">
          ${skeleton}
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

    this._finder.dropOnReshape();

    const switchEpoch = ++this.viewSwitchEpoch;
    this.viewMode = newMode;
    await this.updateComplete;
    await waitForNextFrame();

    if (switchEpoch !== this.viewSwitchEpoch || !this.rootMethod) {
      return;
    }

    await this._renderActiveView();

    if (switchEpoch !== this.viewSwitchEpoch) {
      return;
    }

    // The selection is untouched, but the direction this tab shows is not, and
    // that is what the inspector opens on the other side of.
    eventBus.emit('detail:view', { source: 'calltree', view: directionOf(this.viewMode) });
  }

  /** Build the table for the view on show, if it has none. */
  private async _renderActiveView(): Promise<void> {
    const rootMethod = this.rootMethod;
    const container = this.renderRoot?.querySelector<HTMLDivElement>(CONTAINER_IDS[this.viewMode]);
    if (!rootMethod || !container) {
      return;
    }

    switch (this.viewMode) {
      case 'time-order':
        await this._renderCallTree(container, rootMethod);
        break;
      case 'aggregated':
        await this._renderAggregatedTree(container, rootMethod);
        break;
      case 'bottom-up':
        await this._renderBottomUpTree(container, rootMethod);
        break;
    }
    // A fresh table carries none of the filters on show, so every build applies
    // them — a re-attach rebuilds under the filters the user left in force.
    this._updateFiltering();
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
    this._aggregatedLinks = null;
    this._bottomUpLinks = null;
  }

  _handleBottomUpGroupBy(event: Event) {
    const target = event.target as HTMLInputElement;
    this.bottomUpGroupBy = target.value;
    if (this.bottomUpGrid) {
      this.bottomUpGrid.groupBy = bottomUpGroupBy(target.value);
    }
  }

  private _handleColumnViewChange(event: Event) {
    this._columns.choose((event.target as HTMLInputElement).value || 'General');
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

  private _showHeaderContextMenu(table: ColumnTarget, clientX: number, clientY: number) {
    if (!this.contextMenu) {
      return;
    }
    this.contextMenuRow = null;
    this.contextMenuTable = table;
    this.contextMenu.show(this._columns.menuItems(table), clientX, clientY);
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
    if (!this.contextMenu?.isVisible() || !this.contextMenuTable) {
      return;
    }
    this.contextMenu.items = this._columns.menuItems(this.contextMenuTable);
  }

  private _onColumnMenuClose() {
    this.contextMenuTable = null;
    this.contextMenuRow = null;
  }

  private _onResetOption(event: CustomEvent<{ value: string }>) {
    this._columns.reset(event.detail.value);
  }

  _handleTypeFilter(event: Event) {
    const target = event.target as HTMLInputElement;
    this.typeFilter = target.value || 'All';
    this.filterState.selectedTypes = new Set(target.value ? [target.value] : []);
    // typeFilter is a plain field (not @state), so the Type select's
    // `.filterActive` binding doesn't repaint until some other reactive
    // update happens to coincide — force it so the active border shows on
    // the very first pick, not a later render.
    this.requestUpdate();
    this._updateFiltering();
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

  // The grid keeps its work per filter object, so an unchanged filter must keep its object.
  private _filter<R>(slot: string, input: string, make: () => RowFilter<R>): RowFilter<R> {
    const held = this._filterSlots.get(slot);
    if (held?.input === input) {
      return held.filter as RowFilter<R>;
    }
    const filter = make();
    this._filterSlots.set(slot, { input, filter: filter as RowFilter<unknown> });
    return filter;
  }

  /** The filters of {@link _updateFiltering} for the Aggregated grid: Time Order's, on its rows. */
  private _aggregatedFilters(): RowFilter<AggregatedRow>[] {
    const namespaces = this.namespaceSelected;
    const filters: RowFilter<AggregatedRow>[] = [];
    if (namespaces.length) {
      filters.push(
        this._filter('aggregated:namespace', namespaces.join('\n'), () =>
          deep((row) => namespaces.includes(row.namespace || '')),
        ),
      );
    }
    if (hasRange(this.totalTimeRange)) {
      const range = this.totalTimeRange;
      filters.push(
        this._filter('aggregated:total', rangeKey(range), () =>
          deep((row) => inMsRange(range, row.totalTime)),
        ),
      );
    }
    if (hasRange(this.selfTimeRange)) {
      const range = this.selfTimeRange;
      filters.push(
        this._filter('aggregated:self', rangeKey(range), () =>
          deep((row) => inMsRange(range, row.totalSelfTime)),
        ),
      );
    }
    const types = this.filterState.selectedTypes;
    if (this.filterState.debugOnly) {
      filters.push(AGGREGATED_DEBUG_ONLY);
    } else {
      if (types.size > 0 && !types.has('All')) {
        filters.push(
          this._filter('aggregated:type', [...types].join('\n'), () =>
            deep((row) => !!row.originalData.type && types.has(row.originalData.type)),
          ),
        );
      }
      if (!this.filterState.showDetails) {
        filters.push(AGGREGATED_DETAILS);
      }
    }
    return filters;
  }

  /** The filters of {@link _updateFiltering} for the Time Order grid. */
  private _timeOrderFilters(): RowFilter<LogEvent>[] {
    const namespaces = this.namespaceSelected;
    const filters: RowFilter<LogEvent>[] = [];
    if (namespaces.length) {
      filters.push(
        this._filter('time-order:namespace', namespaces.join('\n'), () =>
          deep((e) => namespaces.includes(e.namespace || '')),
        ),
      );
    }
    if (hasRange(this.totalTimeRange)) {
      const range = this.totalTimeRange;
      filters.push(
        this._filter('time-order:total', rangeKey(range), () =>
          deep((e) => inMsRange(range, e.duration.total)),
        ),
      );
    }
    if (hasRange(this.selfTimeRange)) {
      const range = this.selfTimeRange;
      filters.push(
        this._filter('time-order:self', rangeKey(range), () =>
          deep((e) => inMsRange(range, e.duration.self)),
        ),
      );
    }
    const types = this.filterState.selectedTypes;
    if (this.filterState.debugOnly) {
      filters.push(DEBUG_ONLY);
    } else {
      if (types.size > 0 && !types.has('All')) {
        filters.push(
          this._filter('time-order:type', [...types].join('\n'), () =>
            deep((e) => !!e.type && types.has(e.type)),
          ),
        );
      }
      if (!this.filterState.showDetails) {
        filters.push(TIME_ORDER_DETAILS);
      }
    }
    return filters;
  }

  /** The filters of {@link _updateFiltering} for the Bottom-Up grid: no type or debug filter. */
  private _bottomUpFilters(): RowFilter<BottomUpRow>[] {
    const namespaces = this.namespaceSelected;
    const filters: RowFilter<BottomUpRow>[] = [];
    if (namespaces.length) {
      filters.push(
        this._filter('bottom-up:namespace', namespaces.join('\n'), () =>
          deep((row) => namespaces.includes(row.namespace || '')),
        ),
      );
    }
    if (hasRange(this.totalTimeRange)) {
      const range = this.totalTimeRange;
      filters.push(
        this._filter('bottom-up:total', rangeKey(range), () =>
          deep((row) => inMsRange(range, row.totalTime)),
        ),
      );
    }
    if (hasRange(this.selfTimeRange)) {
      const range = this.selfTimeRange;
      filters.push(
        this._filter('bottom-up:self', rangeKey(range), () =>
          deep((row) => inMsRange(range, row.totalSelfTime)),
        ),
      );
    }
    if (!this.filterState.showDetails) {
      filters.push(BOTTOM_UP_DETAILS);
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
      this.rootMethod,
      eventIndexes,
      directionOf(this.viewMode),
    );
    if (this.aggregatedGrid && this.viewMode === 'aggregated') {
      this.aggregatedGrid.marked = markedIds(this._aggregatedLinks, pathIds);
    } else if (this.bottomUpGrid && this.viewMode === 'bottom-up') {
      this.bottomUpGrid.marked = markedIds(this._bottomUpLinks, pathIds);
    }
  }

  _expandButtonClick() {
    void this._activeGrid()?.expandAll();
  }

  _collapseButtonClick() {
    void this._activeGrid()?.collapseAll();
  }

  _appendTableWhenVisible() {
    if (this._activeGrid()) {
      return;
    }

    this.rootMethod = this.timelineRoot;
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
    if (!this.rootMethod) {
      return;
    }
    document.dispatchEvent(new CustomEvent('show-tab', { detail: { tabid: 'tree-tab' } }));

    if (this.viewMode !== 'time-order') {
      // Through the switch, so the inspector hears the direction change too.
      await this._setViewMode('time-order');
    }

    if (!this._callTreeTableWrapper) {
      return;
    }

    await this._renderCallTree(this._callTreeTableWrapper, this.rootMethod);
    const grid = this.timeOrderGrid;
    if (grid && (await grid.goTo(this._timeOrderPath(eventIndex)))) {
      grid.focus({ preventScroll: true });
    }
  }

  /**
   * Select the row for `eventIndex` in the view on screen, in place: no tab
   * switch, no view-mode change and no focus steal, unlike {@link _goToRow}.
   * Focus stays where the click was, which is the inspector.
   */
  private async _revealEventIndex(eventIndex: number, signal: AbortSignal): Promise<void> {
    const grid = this._activeGrid();
    if (!grid || signal.aborted) {
      return;
    }
    const path = this._pathTo(eventIndex);
    await this._echoGuard.runAsync(() => grid.goTo(path, { scrollIfVisible: false }));
  }

  /** The keys from a top-level row down to the row of the view on show for `eventIndex`. */
  private _pathTo(eventIndex: number): RowKey[] {
    const direction: SelectionView = directionOf(this.viewMode);
    const pathIds = (): readonly number[] =>
      this._locateIds.idsFor(this.rootMethod, [eventIndex], direction);
    switch (this.viewMode) {
      case 'time-order':
        return this._timeOrderPath(eventIndex);
      case 'aggregated':
        return mergedPath(this._aggregatedLinks, pathIds());
      case 'bottom-up':
        return mergedPath(this._bottomUpLinks, pathIds());
    }
  }

  /** The keys from a top-level row down to the Time Order row for `eventIndex`. */
  private _timeOrderPath(eventIndex: number): RowKey[] {
    const path: RowKey[] = [];
    const root = this.rootMethod;
    // The log itself is the one event with no parent, and it has no row.
    for (
      let event = root ? eventByEventIndex(root, eventIndex) : null;
      event?.parent;
      event = event.parent
    ) {
      path.unshift(event.eventIndex);
    }
    return path;
  }

  private async _renderCallTree(
    callTreeTableContainer: HTMLDivElement,
    rootMethod: ApexLog,
  ): Promise<void> {
    if (this.timeOrderGrid) {
      await waitForNextFrame();
      return;
    }

    const grid = this._mountGrid<LogEvent>(callTreeTableContainer, (event) => ({
      originalData: event,
      text: event.text,
    }));
    this.timeOrderGrid = grid;
    grid.columns = timeOrderColumns(rootMethod, { openType });
    grid.rowClass = eventCategoryClass;
    grid.filters = this._timeOrderFilters();
    grid.addEventListener('lv-grid-context', (e) => {
      const { row, event } = (e as CustomEvent<GridContextDetail<LogEvent>>).detail;
      if (!row || window.getSelection()?.type === 'Range') {
        return;
      }
      event.preventDefault();
      this._showRowContextMenu(row, event.clientX, event.clientY);
    });
    this._columns.applyTo(gridColumnTarget(grid));
    grid.source = timeOrderSource(rootMethod);
    await grid.settled();
  }

  private async _renderAggregatedTree(
    container: HTMLDivElement,
    rootMethod: ApexLog,
  ): Promise<void> {
    if (this.aggregatedGrid) {
      await waitForNextFrame();
      return;
    }

    const grid = this._mountGrid<AggregatedRow>(
      container,
      (row) => row,
      (row) => this._aggregatedLinks?.parents.get(row),
    );
    this.aggregatedGrid = grid;
    grid.columns = aggregatedColumns(rootMethod, { openType });
    grid.rowLines = mergedLines;
    grid.filters = this._aggregatedFilters();
    this._columns.applyTo(gridColumnTarget(grid));
    const roots = await buildAggregatedTree(
      rootMethod.children,
      logStoreFor(rootMethod).keyPathIds(),
      rootMethod.governorLimits,
      { signal: this._builds.signal },
    );
    // A build can finish just before a detach, and a later one owns the container now.
    if (!roots || this.aggregatedGrid !== grid) {
      return;
    }
    this._aggregatedLinks = linkRows(roots);
    grid.source = { roots, children: (row) => row._children, key: (row) => row.id };
    await grid.settled();
  }

  private async _renderBottomUpTree(container: HTMLDivElement, rootMethod: ApexLog): Promise<void> {
    if (this.bottomUpGrid) {
      await waitForNextFrame();
      return;
    }

    const grid = this._mountGrid<BottomUpRow>(
      container,
      (row) => row,
      (row) => this._bottomUpLinks?.parents.get(row),
    );
    this.bottomUpGrid = grid;
    grid.columns = bottomUpColumns(rootMethod, { openType });
    grid.sort = BOTTOM_UP_SORT;
    grid.rowLines = mergedLines;
    grid.groupBy = bottomUpGroupBy(this.bottomUpGroupBy);
    grid.filters = this._bottomUpFilters();
    this._columns.applyTo(gridColumnTarget(grid));
    const roots = await buildBottomUpTree(
      rootMethod.children,
      logStoreFor(rootMethod).keyPathIds(),
      rootMethod.governorLimits,
      { signal: this._builds.signal },
    );
    // A build can finish just before a detach, and a later one owns the container now.
    if (!roots || this.bottomUpGrid !== grid) {
      return;
    }
    this._bottomUpLinks = linkRows(roots);
    grid.source = { roots, children: (row) => row._children, key: (row) => row.id };
    await grid.settled();
  }

  /**
   * An lv-grid in `container`, with the header menu, the search reset and both
   * halves of the inspector wired. `data` and `parentOf` give the shape the
   * inspector reads a row by.
   */
  private _mountGrid<R extends object>(
    container: HTMLElement,
    data: (row: R) => object,
    parentOf: (row: R) => R | undefined = () => undefined,
  ): LvGrid<R> {
    const grid = document.createElement('lv-call-tree-grid') as unknown as LvGrid<R>;
    grid.toggleAttribute('category-colorize', this.classList.contains('category-colorize'));
    const inspector = inspectorRowEvents<R>({
      source: 'calltree',
      root: () => this.rootMethod,
      view: () => directionOf(this.viewMode),
      standIn: (row) => rowStandIn(row, data, parentOf),
      echoGuard: this._echoGuard,
      dropPick: () => this._inspector.dropPick(),
    });

    grid.addEventListener('lv-grid-header-context', (e) => {
      const { event } = (e as CustomEvent<GridHeaderContextDetail>).detail;
      event.preventDefault();
      this._showHeaderContextMenu(gridColumnTarget(grid), event.clientX, event.clientY);
    });
    grid.addEventListener('lv-grid-reshape', () => this._finder.dropOnReshape());
    grid.addEventListener('lv-grid-select', inspector.select);
    grid.addEventListener('lv-grid-locate', inspector.locate);

    container.replaceChildren(grid);
    return grid;
  }

  private _showRowContextMenu(event: LogEvent, clientX: number, clientY: number): void {
    if (!this.contextMenu) {
      return;
    }

    this.contextMenuRow = event;

    const items: { id: string; label: string; separator?: boolean; shortcut?: string }[] = [];

    items.push({ id: 'show-in-timeline', label: 'Show in Timeline' });

    if (event.hasValidSymbols) {
      items.push({ id: 'go-to-source', label: 'Go to Source' });
    }

    if (event.timestamp) {
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
    // open (keepOpen), so refresh its items live and leave contextMenuTable set —
    // it's cleared on menu-close.
    if (itemId.startsWith('view:')) {
      this._columns.choose(itemId.slice('view:'.length));
      this._refreshColumnMenu();
      return;
    }
    if (itemId.startsWith('col:')) {
      if (this.contextMenuTable) {
        this._columns.toggle(this.contextMenuTable, itemId.slice('col:'.length));
        this._refreshColumnMenu();
      }
      return;
    }
    if (itemId.startsWith('reset:')) {
      this._columns.reset(itemId.slice('reset:'.length));
      this._refreshColumnMenu();
      return;
    }

    if (!this.contextMenuRow) {
      return;
    }

    const event = this.contextMenuRow;

    switch (e.detail.itemId) {
      case 'show-in-log':
        vscodeMessenger.send('goToLogLine', { timestamp: event.timestamp });
        break;

      case 'show-in-timeline':
        document.dispatchEvent(new CustomEvent('show-tab', { detail: { tabid: 'timeline-tab' } }));
        eventBus.emit('timeline:navigate-to', {
          eventIndex: event.eventIndex,
        });
        break;

      case 'go-to-source':
        openType(event.text);
        break;

      case 'copy-name':
        void navigator.clipboard.writeText(event.text);
        break;
    }

    this.contextMenuRow = null;
  }
}
