/*
 * Copyright (c) 2022 Certinia Inc. All rights reserved.
 */
import '#vscode-elements/vscode-button.js';
import '#vscode-elements/vscode-option.js';
import '#vscode-elements/vscode-toolbar-button.js';
import '../../../components/VsSelect.js';
import { css, html, LitElement, unsafeCSS, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import type { RowComponent, Tabulator } from 'tabulator-tables';

import type { ApexLog, LogEvent } from 'apex-log-parser';
import { eventBus, type DetailSource } from '../../../core/events/EventBus.js';
import { SelectionEchoGuard } from '../../../core/events/SelectionEchoGuard.js';
import { vscodeMessenger } from '../../../core/messaging/VSCodeExtensionMessenger.js';
import { eventByEventIndex } from '../../../core/utility/EventSearch.js';
import { isVisible } from '../../../core/utility/Util.js';
import { getSettings, updateSetting } from '../../settings/Settings.js';
import { CALLTREE_GO_TO_ROW } from '../navigation.js';
import type { AggregatedRow, BottomUpRow } from '../utils/Aggregation.js';
import { findBucketRow } from '../utils/bucketRows.js';
import {
  categoryColoringStyles,
  categoryRowFormatter,
  groupedRowFormatter,
  wireCategoryColoring,
} from '../utils/CategoryColoring.js';
import { deepFilter } from '../utils/DetailsFilter.js';
import { expandCollapseAll } from '../utils/ExpandCollapse.js';
import type { TimeOrderRow } from '../utils/TimeOrderTree.js';
import { waitForNextFrame } from '../../../core/utility/FrameBudget.js';

import { inMsRange, type FilterRange } from '../../../tabulator/filters/MinMax.js';
import { withCodeDrivenExpand } from '../../../tabulator/module/expandOrigin.js';
import { onTableReshaped } from '../../../tabulator/module/tableReshape.js';

import dataGridStyles from '../../../tabulator/style/DataGrid.scss';

// styles
import { globalStyles } from '../../../styles/global.styles.js';
import { soqlSyntaxStyles } from '../../soql/styles/soql-syntax.css.js';

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

// Table creation functions
import { createAggregatedTable } from './AggregatedTable.js';
import { createBottomUpTable } from './BottomUpTable.js';
import {
  applyColumnView,
  buildColumnMenuItems,
  CALL_TREE_VIEWS,
  getColumnView,
  getTableFields,
  resolveColumnView,
  toggleField,
} from '../../../tabulator/ColumnViews.js';
import {
  LOCATED_ROW_CLASS,
  LocatedRowIds,
  LocatedRowMarker,
  rowDetailSelection,
  rowIndexStamper,
  rowFrames,
} from '../../../components/locatedRow.js';
import { InspectorEmphasis } from '../../../components/inspectorEmphasis.js';
import { wireInspectorTab } from '../../../components/inspectorTab.js';
import { createTimeOrderTable } from './TimeOrderTable.js';

/** Time Order keys its rows by event index; the grouped views key theirs by the
 *  path of buckets that reaches them, since one method holds a row under every
 *  caller it has. Either way the inspector can mark them. */
const stampTimeOrderIndex = rowIndexStamper('id');
const timeOrderRowFormatter = (row: RowComponent): void => {
  categoryRowFormatter(row);
  stampTimeOrderIndex(row);
};

/** The Name column is always shown in the call-tree tables. */
const ALWAYS_VISIBLE = ['text'];

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

@customElement('call-tree-view')
export class CalltreeView extends LitElement {
  @property()
  timelineRoot: ApexLog | null = null;

  @state()
  isVisible = false;

  @state()
  viewMode: ViewMode = 'time-order';

  aggregatedTreeTable: Tabulator | null = null;
  bottomUpTreeTable: Tabulator | null = null;

  filterState: { showDetails: boolean; debugOnly: boolean; selectedTypes: Set<string> } = {
    showDetails: false,
    debugOnly: false,
    selectedTypes: new Set<string>(),
  };
  bottomUpGroupBy = 'None';
  typeFilter = 'All';
  namespaceSelected: string[] = [];
  totalTimeRange: FilterRange = { start: null, end: null };
  selfTimeRange: FilterRange = { start: null, end: null };
  debugOnlyFilterCache = new Map<number, boolean>();
  typeFilterCache = new Map<number, boolean>();
  namespaceFilterCache = new Map<number, boolean>();
  totalTimeFilterCache = new Map<number, boolean>();
  selfTimeFilterCache = new Map<number, boolean>();

  findMap: { [key: number]: RowComponent } = {};
  totalMatches = 0;

  blockClearHighlights = true;
  findArgs: { text: string; count: number; options: { matchCase: boolean } } = {
    text: '',
    count: 0,
    options: { matchCase: false },
  };

  calltreeTable: Tabulator | null = null;
  tableContainer: HTMLDivElement | null = null;
  rootMethod: ApexLog | null = null;

  @state()
  columnView = 'General';

  /** Per-view column overrides (view id → visible fields); empty until edited. */
  @state()
  private columnOverrides: Record<string, string[]> = {};

  private contextMenu: ContextMenu | null = null;
  private contextMenuRow: TimeOrderRow | null = null;
  /** The table whose header was right-clicked (for column-toggle actions). */
  private contextMenuTable: Tabulator | null = null;
  private viewSwitchEpoch = 0;
  /** Releases the category-colouring settings subscription; set while connected. */
  private _categoryColoringOff: (() => void) | null = null;

  get _callTreeTableWrapper(): HTMLDivElement | null {
    return (this.tableContainer = this.renderRoot?.querySelector('#call-tree-table') ?? null);
  }

  private _goToRowEvt = ((e: CustomEvent<{ eventIndex: number }>) => {
    this._goToRow(e.detail.eventIndex);
  }) as EventListener;

  /** Guards the programmatic select made on the inspector's behalf. */
  private _echoGuard = new SelectionEchoGuard();
  private _inspectorUnsubscribe: (() => void) | null = null;
  private _locatedRow = new LocatedRowMarker();
  private _locateIds = new LocatedRowIds();
  /** Which of the inspector's reports the mark follows. */
  private _emphasis = new InspectorEmphasis();

  constructor() {
    super();

    this._inspectorUnsubscribe = wireInspectorTab('calltree', this._emphasis, {
      mark: (eventIndexes) => this._markLocated(eventIndexes),
      reveal: (eventIndex, signal) => this._revealEventIndex(eventIndex, signal),
      clear: () => {
        // The table reports the clear itself, which is what reaches the inspector.
        for (const table of this._tables) {
          table.deselectRow();
        }
      },
      // A picked row merges calls, so the mark shows all of them while the view
      // moves to the first, as a pick of one frame does.
      movesToMergedPick: true,
    });
    document.addEventListener(CALLTREE_GO_TO_ROW, this._goToRowEvt);
    document.addEventListener('lv-find', this._findEvt);
    document.addEventListener('lv-find-match', this._findEvt);
    document.addEventListener('lv-find-close', this._findEvt);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this._categoryColoringOff = wireCategoryColoring(this);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._categoryColoringOff?.();
    this._categoryColoringOff = null;
    document.removeEventListener(CALLTREE_GO_TO_ROW, this._goToRowEvt);
    document.removeEventListener('lv-find', this._findEvt);
    document.removeEventListener('lv-find-match', this._findEvt);
    document.removeEventListener('lv-find-close', this._findEvt);
    this._inspectorUnsubscribe?.();
    this._inspectorUnsubscribe = null;
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
    void this._loadColumnSettings();
  }

  private async _loadColumnSettings(): Promise<void> {
    const settings = await getSettings();
    this.columnOverrides = settings.callTree?.columnOverrides ?? {};
    this._setColumnView(resolveColumnView(CALL_TREE_VIEWS, settings.callTree?.columnView));
  }

  static styles = [
    unsafeCSS(dataGridStyles),
    unsafeCSS(soqlSyntaxStyles),
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

      /* The frame under the pointer in the inspector. */
      .tabulator-row.${unsafeCSS(LOCATED_ROW_CLASS)} {
        background-color: var(--lana-row-hover-bg);
      }
    `,
    categoryColoringStyles,
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
                .value="${this.columnView}"
                .resettableValues="${Object.keys(this.columnOverrides)}"
              >
                ${repeat(
                  CALL_TREE_VIEWS,
                  (view) => view.id,
                  (view) =>
                    html`<vscode-option
                      value="${view.id}"
                      ?selected="${this.columnView === view.id}"
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
                        ${
                          this.isVisible
                            ? repeat(
                                this._getAllTypes(this.timelineRoot?.children ?? []),
                                (type, _index) =>
                                  html`<vscode-option ?selected="${this.typeFilter === type}"
                                    >${type}</vscode-option
                                  >`,
                              )
                            : ''
                        }
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

  _findEvt = ((event: FindEvt) => {
    this._find(event);
  }) as EventListener;

  _getAllTypes(data: LogEvent[]): string[] {
    const flattened = this._flatten(data);
    const types = new Set<string>();
    for (const line of flattened) {
      types.add(line.type?.toString() ?? '');
    }
    return Array.from(types).sort();
  }

  _flat(arr: LogEvent[], target: LogEvent[]) {
    for (const evt of arr) {
      target.push(evt);
      if (evt.children.length > 0) {
        this._flat(evt.children, target);
      }
    }
  }

  _flatten(arr: LogEvent[]) {
    const flattened: LogEvent[] = [];
    this._flat(arr, flattened);
    return flattened;
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

    // Reset search when switching views
    if (this.totalMatches > 0 || this.findArgs.text !== '') {
      const oldTable = this._getActiveTable();
      this._resetFindWidget();
      if (oldTable) {
        //@ts-expect-error This is a custom function added in by Find custom module
        oldTable.clearFindHighlights();
      }
      this.findArgs.text = '';
      this.findArgs.count = 0;
      this.findMap = {};
      this.totalMatches = 0;
    }

    const switchEpoch = ++this.viewSwitchEpoch;
    this.viewMode = newMode;
    await this.updateComplete;
    await waitForNextFrame();

    if (switchEpoch !== this.viewSwitchEpoch || !this.rootMethod) {
      return;
    }

    if (this.viewMode === 'time-order') {
      const container = this.renderRoot?.querySelector<HTMLDivElement>('#call-tree-table');
      if (container) {
        await this._renderCallTree(container, this.rootMethod);
        this._updateFiltering();
      }
    } else if (this.viewMode === 'aggregated') {
      const container = this.renderRoot?.querySelector<HTMLDivElement>('#aggregated-tree-table');
      if (container) {
        await this._renderAggregatedTree(container, this.rootMethod);
        this._updateFiltering();
      }
    } else if (this.viewMode === 'bottom-up') {
      const container = this.renderRoot?.querySelector<HTMLDivElement>('#bottom-up-tree-table');
      if (container) {
        await this._renderBottomUpTree(container, this.rootMethod);
        this._updateFiltering();
      }
    }

    if (switchEpoch !== this.viewSwitchEpoch) {
      return;
    }

    // The selection is untouched, but the direction this tab shows is not, and
    // that is what the inspector opens on the other side of.
    eventBus.emit('detail:view', { source: 'calltree', view: directionOf(this.viewMode) });
  }

  private _destroyCurrentTable(): void {
    // The marker holds row elements that go with the table.
    this._locatedRow.clear();
    if (this.calltreeTable) {
      this.calltreeTable.destroy();
      this.calltreeTable = null;
    }
    if (this.aggregatedTreeTable) {
      this.aggregatedTreeTable.destroy();
      this.aggregatedTreeTable = null;
    }
    if (this.bottomUpTreeTable) {
      this.bottomUpTreeTable.destroy();
      this.bottomUpTreeTable = null;
    }
  }

  _handleBottomUpGroupBy(event: Event) {
    const target = event.target as HTMLInputElement;
    this.bottomUpGroupBy = target.value;
    // Grouping renumbers the matches both ways round, and `dataGrouped` reports
    // only the way that leaves the table grouped.
    this._dropSearch();
    const fieldName =
      target.value === 'Caller Namespace' ? 'callerNamespace' : target.value.toLowerCase();
    if (this.bottomUpTreeTable) {
      // @ts-expect-error setSortedGroupBy is added by the GroupSort custom module
      this.bottomUpTreeTable.setSortedGroupBy(fieldName !== 'none' ? fieldName : '');
    }
  }

  private _handleColumnViewChange(event: Event) {
    const target = event.target as HTMLInputElement;
    const id = target.value || 'General';
    this._setColumnView(id);
    updateSetting('callTree.columnView', id);
  }

  /** Effective fields for a view id: the user override, else the built-in preset. */
  private _columnViewFields(id: string): string[] | null {
    return this.columnOverrides[id] ?? getColumnView(CALL_TREE_VIEWS, id)?.fields ?? null;
  }

  private get _tables(): Tabulator[] {
    return [this.calltreeTable, this.aggregatedTreeTable, this.bottomUpTreeTable].filter(
      (table): table is Tabulator => !!table,
    );
  }

  private _setColumnView(id: string) {
    this.columnView = id;
    const fields = this._columnViewFields(id);
    for (const table of this._tables) {
      applyColumnView(table, fields, ALWAYS_VISIBLE);
    }
  }

  /** Applies the active view and wires the header menu once a table is built. */
  private _initTableColumns(table: Tabulator) {
    applyColumnView(table, this._columnViewFields(this.columnView), ALWAYS_VISIBLE);
    const header = table.element.querySelector<HTMLElement>('.tabulator-header');
    header?.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      this._showHeaderContextMenu(table, event.clientX, event.clientY);
    });
  }

  private _showHeaderContextMenu(table: Tabulator, clientX: number, clientY: number) {
    if (!this.contextMenu) {
      return;
    }
    this.contextMenuRow = null;
    this.contextMenuTable = table;
    this.contextMenu.show(
      buildColumnMenuItems(
        table,
        this.columnView,
        CALL_TREE_VIEWS,
        ALWAYS_VISIBLE,
        Object.keys(this.columnOverrides),
      ),
      clientX,
      clientY,
    );
  }

  private _openColumnMenu(event: Event) {
    const table = this._getActiveTable();
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
    this.contextMenu.items = buildColumnMenuItems(
      this.contextMenuTable,
      this.columnView,
      CALL_TREE_VIEWS,
      ALWAYS_VISIBLE,
      Object.keys(this.columnOverrides),
    );
  }

  private _onColumnMenuClose() {
    this.contextMenuTable = null;
    this.contextMenuRow = null;
  }

  /** Toggles a column in the active view's override, shared across all tables. */
  private _toggleColumn(field: string) {
    const table = this.contextMenuTable;
    if (!table) {
      return;
    }
    const fields = toggleField(
      this._columnViewFields(this.columnView),
      field,
      getTableFields(table),
    );
    this.columnOverrides = { ...this.columnOverrides, [this.columnView]: fields };
    for (const t of this._tables) {
      applyColumnView(t, fields, ALWAYS_VISIBLE);
    }
    updateSetting('callTree.columnOverrides', this.columnOverrides);
  }

  private _onResetOption(event: CustomEvent<{ value: string }>) {
    this._resetColumns(event.detail.value);
  }

  /** Clears a view's override, restoring its built-in columns (defaults to the active view). */
  private _resetColumns(id: string = this.columnView) {
    if (!this.columnOverrides[id]) {
      return;
    }
    const { [id]: _removed, ...rest } = this.columnOverrides;
    this.columnOverrides = rest;
    if (id === this.columnView) {
      // Resolve the restored fields once (identical for every table).
      const fields = this._columnViewFields(id);
      for (const table of this._tables) {
        applyColumnView(table, fields, ALWAYS_VISIBLE);
      }
    }
    updateSetting('callTree.columnOverrides', this.columnOverrides);
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
    const activeTable = this._getActiveTable();
    if (!activeTable) {
      return;
    }

    this._dropSearch();
    this._clearFilterCaches();

    const filtersToAdd = [];

    if (this.namespaceSelected.length > 0) {
      filtersToAdd.push(this._namespaceBarFilter);
    }

    if (this.totalTimeRange.start !== null || this.totalTimeRange.end !== null) {
      filtersToAdd.push(this._totalTimeBarFilter);
    }

    if (this.selfTimeRange.start !== null || this.selfTimeRange.end !== null) {
      filtersToAdd.push(this._selfTimeBarFilter);
    }

    const isBottomUp = this.viewMode === 'bottom-up';

    if (!isBottomUp && this.filterState.debugOnly) {
      filtersToAdd.push(this._debugFilter);
    } else {
      if (
        !isBottomUp &&
        this.filterState.selectedTypes.size > 0 &&
        !this.filterState.selectedTypes.has('All')
      ) {
        filtersToAdd.push(this._typeFilter);
      }

      if (!this.filterState.showDetails) {
        filtersToAdd.push(this._showDetailsFilter);
      }
    }

    activeTable.blockRedraw();
    activeTable.clearFilter(false);
    filtersToAdd.forEach((filter) => {
      activeTable.addFilter(filter);
    });
    activeTable.restoreRedraw();
  }

  /**
   * Mark the rows of the view on screen for `eventIndexes`. Time Order stamps the
   * event index itself; a grouped view stamps the bucket path, so a frame is
   * translated into the paths of the rows it belongs to — one in Aggregated, one
   * per caller depth in Bottom-Up.
   */
  private _markLocated(eventIndexes: readonly number[]): void {
    const direction = this.viewMode === 'time-order' ? undefined : directionOf(this.viewMode);
    this._locatedRow.mark(
      this._getActiveTable()?.element ?? null,
      this._locateIds.idsFor(this.rootMethod, eventIndexes, direction),
    );
  }

  private _getActiveTable(): Tabulator | null {
    switch (this.viewMode) {
      case 'time-order':
        return this.calltreeTable;
      case 'aggregated':
        return this.aggregatedTreeTable;
      case 'bottom-up':
        return this.bottomUpTreeTable;
    }
  }

  _expandButtonClick() {
    const table = this._getActiveTable();
    if (!table?.modules?.dataTree) {
      return;
    }
    table.blockRedraw();
    expandCollapseAll(table.getRows(), true);
    table.element?.querySelector<HTMLElement>('.tabulator-tableholder')?.focus();
    table.restoreRedraw();
  }

  _collapseButtonClick() {
    const table = this._getActiveTable();
    if (!table?.modules?.dataTree) {
      return;
    }
    table.blockRedraw();
    expandCollapseAll(table.getRows(), false);
    table.element?.querySelector<HTMLElement>('.tabulator-tableholder')?.focus();
    table.restoreRedraw();
  }

  _appendTableWhenVisible() {
    if (this.calltreeTable) {
      return;
    }

    this.rootMethod = this.timelineRoot;
    isVisible(this).then((isVisible) => {
      this.isVisible = isVisible;
      if (this.rootMethod && this._callTreeTableWrapper) {
        void this._renderCallTree(this._callTreeTableWrapper, this.rootMethod);
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
    if (!this.calltreeTable) {
      return;
    }

    const treeRow = await this._findByEventIndex(this.calltreeTable.getRows(), eventIndex);

    if (!treeRow) {
      return;
    }
    //@ts-expect-error This is a custom function added in by RowNavigation custom module
    await this.calltreeTable.goToRow(treeRow, { scrollIfVisible: true, focusRow: true });
  }

  /**
   * Select the row for `eventIndex` in the view on screen, in place: no tab
   * switch, no view-mode change and no focus steal, unlike {@link _goToRow}.
   * Focus stays where the click was, which is the inspector.
   */
  private async _revealEventIndex(eventIndex: number, signal: AbortSignal): Promise<void> {
    const table = this._getActiveTable();
    if (!table) {
      return;
    }

    const treeRow = await this._findRowFor(table, eventIndex);
    if (!treeRow || signal.aborted) {
      return;
    }

    await this._echoGuard.runAsync(() =>
      //@ts-expect-error This is a custom function added in by RowNavigation custom module
      table.goToRow(treeRow, { scrollIfVisible: false, focusRow: false }),
    );
  }

  /**
   * The row holding `eventIndex` in the view on screen, with the path to it
   * materialised. Time Order has a row per event; the grouped views find the
   * bucket instead.
   */
  private async _findRowFor(table: Tabulator, eventIndex: number): Promise<RowComponent | null> {
    if (this.viewMode === 'time-order') {
      return this._findByEventIndex(table.getRows(), eventIndex);
    }
    if (!this.rootMethod) {
      return null;
    }
    const event = eventByEventIndex(this.rootMethod, eventIndex);
    if (!event) {
      return null;
    }
    return findBucketRow(table.getRows(), event, directionOf(this.viewMode), () =>
      this._waitForTableRender(),
    );
  }

  async _find(e: CustomEvent<{ text: string; count: number; options: { matchCase: boolean } }>) {
    const activeTable = this._getActiveTable();
    const isTableVisible = !!activeTable?.element?.clientHeight;
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
      const result = await activeTable.find(this.findArgs);
      this.blockClearHighlights = false;
      this.totalMatches = result.totalMatches;
      this.findMap = result.matchIndexes;

      if (!clearHighlights && isTableVisible) {
        document.dispatchEvent(
          new CustomEvent('lv-find-results', { detail: { totalMatches: result.totalMatches } }),
        );
      }
    }

    if (this.totalMatches <= 0 || !isTableVisible) {
      return;
    }
    this.blockClearHighlights = true;
    const currentRow = this.findMap[this.findArgs.count];
    //@ts-expect-error This is a custom function added in by Find custom module
    await activeTable.setCurrentMatch(this.findArgs.count, currentRow, {
      scrollIfVisible: false,
      focusRow: false,
    });
    this.blockClearHighlights = false;
  }

  // Show-Details predicate is precomputed at tree-build time (see
  // `_hasDetailsDeep` in TimeOrderTree/Aggregation), so the Tabulator filter
  // is a single boolean read — no per-toggle tree walk, no cache.
  _showDetailsFilter = (data: TimeOrderRow | AggregatedRow | BottomUpRow): boolean =>
    data._hasDetailsDeep;

  _debugFilter = (data: TimeOrderRow | AggregatedRow | BottomUpRow): boolean =>
    deepFilter<TimeOrderRow | AggregatedRow | BottomUpRow>(
      data,
      (row) => !!(row.originalData.type && DEBUG_VALUE_TYPES.has(row.originalData.type)),
      this.debugOnlyFilterCache,
    );

  _typeFilter = (data: TimeOrderRow | AggregatedRow | BottomUpRow): boolean =>
    deepFilter<TimeOrderRow | AggregatedRow | BottomUpRow>(
      data,
      (row) => {
        const type = row.originalData.type;
        if (!type) {
          return false;
        }
        return this.filterState.selectedTypes.has(type);
      },
      this.typeFilterCache,
    );

  _namespaceBarFilter = (data: TimeOrderRow | AggregatedRow | BottomUpRow): boolean =>
    deepFilter<TimeOrderRow | AggregatedRow | BottomUpRow>(
      data,
      (row) => this.namespaceSelected.includes(row.namespace || ''),
      this.namespaceFilterCache,
    );

  _totalTimeBarFilter = (data: TimeOrderRow | AggregatedRow | BottomUpRow): boolean =>
    deepFilter<TimeOrderRow | AggregatedRow | BottomUpRow>(
      data,
      (row) =>
        inMsRange(this.totalTimeRange, 'totalTime' in row ? row.totalTime : row.duration.total),
      this.totalTimeFilterCache,
    );

  _selfTimeBarFilter = (data: TimeOrderRow | AggregatedRow | BottomUpRow): boolean =>
    deepFilter<TimeOrderRow | AggregatedRow | BottomUpRow>(
      data,
      (row) =>
        inMsRange(
          this.selfTimeRange,
          'totalSelfTime' in row ? row.totalSelfTime : row.duration.self,
        ),
      this.selfTimeFilterCache,
    );

  private async _renderCallTree(
    callTreeTableContainer: HTMLDivElement,
    rootMethod: ApexLog,
  ): Promise<void> {
    if (this.calltreeTable) {
      await waitForNextFrame();
      return;
    }

    const { table, tableBuilt } = createTimeOrderTable(callTreeTableContainer, rootMethod, {
      showDetailsFilter: this._showDetailsFilter,
      onContextMenu: (e, row) => {
        if (window.getSelection()?.type === 'Range') {
          return;
        }
        e.preventDefault();
        const mouseEvent = e as MouseEvent;
        this._showRowContextMenu(row, mouseEvent.clientX, mouseEvent.clientY);
      },
      rowFormatter: timeOrderRowFormatter,
    });
    this.calltreeTable = table;
    this._watchTable(table, true);
    await tableBuilt;
    this._initTableColumns(table);
    this._emitDetailSelection(table);
    this._emitDetailLocate(table);
  }

  private async _renderAggregatedTree(
    container: HTMLDivElement,
    rootMethod: ApexLog,
  ): Promise<void> {
    if (this.aggregatedTreeTable) {
      await waitForNextFrame();
      return;
    }

    const { table, tableBuilt } = createAggregatedTable(container, rootMethod, {
      showDetailsFilter: this._showDetailsFilter,
      rowFormatter: groupedRowFormatter,
    });
    this.aggregatedTreeTable = table;
    this._watchTable(table, true);
    await tableBuilt;
    this._initTableColumns(table);
    this._emitDetailSelection(table);
    this._emitDetailLocate(table);
  }

  private async _renderBottomUpTree(container: HTMLDivElement, rootMethod: ApexLog): Promise<void> {
    if (this.bottomUpTreeTable) {
      await waitForNextFrame();
      return;
    }

    const { table, tableBuilt } = createBottomUpTable(
      container,
      rootMethod,
      {
        showDetailsFilter: this._showDetailsFilter,
        rowFormatter: groupedRowFormatter,
      },
      {
        selectableRows: 'highlight',
        enableClipboardAndDownload: true,
        exportFileName: 'bottom-up.csv',
      },
    );
    this.bottomUpTreeTable = table;
    this._watchTable(table, false);
    await tableBuilt;
    this._initTableColumns(table);
    this._emitDetailSelection(table);
    this._emitDetailLocate(table);
  }

  /**
   * Feed the inspector off row selection. A Time Order row is a
   * single event; an Aggregated/Bottom-Up row merges many calls, so it scopes to
   * every call it counts.
   */
  private _emitDetailSelection(table: Tabulator, source: DetailSource = 'calltree'): void {
    table.on('rowSelectionChanged', (_data, rows) => {
      if (this._echoGuard.suppressed) {
        return;
      }
      const selection = rowDetailSelection(rows[0], this.rootMethod);
      if (!selection) {
        // The selection went with it, and so does a mark a picked inspector row
        // left here — it was never a selection of this table.
        this._markLocated(this._emphasis.pick([]));
      }
      eventBus.emit('detail:select', {
        source,
        selection,
        view: directionOf(this.viewMode),
      });
    });
  }

  /**
   * Tell the inspector which frames the pointer is over, so it can mark the rows
   * that stand for them. Nothing is picked and nothing moves.
   *
   * The direction is read as the pointer arrives: which way the table reads is
   * what decides whether a merged row names its own frames or the calls they
   * conducted.
   */
  private _emitDetailLocate(table: Tabulator, source: DetailSource = 'calltree'): void {
    table.on('rowMouseEnter', (_e, row) => {
      eventBus.emit('detail:locate', {
        source,
        eventIndexes: rowFrames(row, this.rootMethod, directionOf(this.viewMode)),
      });
    });
    table.on('rowMouseLeave', () => {
      eventBus.emit('detail:locate', { source, eventIndexes: [] });
    });
  }

  // Resolve once Tabulator has rendered (e.g. after a treeExpand puts new rows
  // in the DOM), with a two-frame fallback in case the expand triggers no
  // redraw. A single rAF can race the virtual renderer and leave getTreeChildren
  // empty mid-descent.
  // A pending-render flag is no use here: Tabulator dispatches `renderStarted`
  // and `renderComplete` in one synchronous call, so the flag always reads false
  // by the time this is awaited.
  private _waitForTableRender(): Promise<void> {
    const table = this._getActiveTable();
    if (!table) {
      return waitForNextFrame();
    }

    return new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) {
          return;
        }
        settled = true;
        table.off('renderComplete', finish);
        resolve();
      };
      table.on('renderComplete', finish);
      requestAnimationFrame(() => requestAnimationFrame(finish));
    });
  }

  private _resetFindWidget() {
    document.dispatchEvent(new CustomEvent('lv-find-results', { detail: { totalMatches: 0 } }));
  }

  /** Drop the search where its match numbering no longer describes the table. */
  private _dropSearch() {
    if (!this.blockClearHighlights && this.totalMatches > 0) {
      this._resetFindWidget();
      this._clearSearchHighlights();
    }
  }

  /**
   * Watch `table` for what a view has to answer per render.
   *
   * The filter caches are cleared once per render rather than on `dataFiltered`:
   * row ids are unique within a build, so a cached `deepFilter` result stays
   * valid across the cascaded filter passes Tabulator runs for each expanded
   * subtree, which would otherwise fire `dataFiltered` several times per user
   * action and defeat the cache.
   *
   * @param clearsFilterCaches - Bottom Up reads the caches but has never cleared
   * them per render, so it keeps that behaviour here.
   */
  private _watchTable(table: Tabulator, clearsFilterCaches: boolean) {
    onTableReshaped(table, () => this._dropSearch());
    if (clearsFilterCaches) {
      table.on('renderStarted', () => this._clearFilterCaches());
    }
  }

  private _clearFilterCaches() {
    this.debugOnlyFilterCache.clear();
    this.typeFilterCache.clear();
    this.namespaceFilterCache.clear();
    this.totalTimeFilterCache.clear();
    this.selfTimeFilterCache.clear();
  }

  private _clearSearchHighlights() {
    this.findArgs.text = '';
    this.findArgs.count = 0;
    const activeTable = this._getActiveTable();
    //@ts-expect-error This is a custom function added in by Find custom module
    activeTable?.clearFindHighlights();
    this.findMap = {};
    this.totalMatches = 0;
  }

  private _showRowContextMenu(row: RowComponent, clientX: number, clientY: number): void {
    if (!this.contextMenu) {
      return;
    }

    const rowData = row.getData() as TimeOrderRow;
    this.contextMenuRow = rowData;

    const items: { id: string; label: string; separator?: boolean; shortcut?: string }[] = [];

    items.push({ id: 'show-in-timeline', label: 'Show in Timeline' });

    if (rowData.originalData.hasValidSymbols) {
      items.push({ id: 'go-to-source', label: 'Go to Source' });
    }

    if (rowData.originalData.timestamp) {
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
      const id = itemId.slice('view:'.length);
      this._setColumnView(id);
      updateSetting('callTree.columnView', id);
      this._refreshColumnMenu();
      return;
    }
    if (itemId.startsWith('col:')) {
      this._toggleColumn(itemId.slice('col:'.length));
      this._refreshColumnMenu();
      return;
    }
    if (itemId.startsWith('reset:')) {
      this._resetColumns(itemId.slice('reset:'.length));
      this._refreshColumnMenu();
      return;
    }

    if (!this.contextMenuRow) {
      return;
    }

    const rowData = this.contextMenuRow;

    switch (e.detail.itemId) {
      case 'show-in-log':
        vscodeMessenger.send('goToLogLine', { timestamp: rowData.originalData.timestamp });
        break;

      case 'show-in-timeline':
        document.dispatchEvent(new CustomEvent('show-tab', { detail: { tabid: 'timeline-tab' } }));
        eventBus.emit('timeline:navigate-to', {
          eventIndex: rowData.originalData.eventIndex,
        });
        break;

      case 'go-to-source':
        vscodeMessenger.send<string>('openType', rowData.originalData.text);
        break;

      case 'copy-name':
        navigator.clipboard.writeText(rowData.text);
        break;
    }

    this.contextMenuRow = null;
  }

  private async _findByEventIndex(
    rows: RowComponent[],
    eventIndex: number,
  ): Promise<RowComponent | null> {
    if (!rows?.length || !this.rootMethod) {
      return null;
    }

    const event = eventByEventIndex(this.rootMethod, eventIndex);
    if (!event) {
      return null;
    }

    return this._materializeRowPath(rows, event);
  }

  private async _materializeRowPath(
    rows: RowComponent[],
    targetEvent: LogEvent,
  ): Promise<RowComponent | null> {
    const eventPath: LogEvent[] = [];
    let currentEvent: LogEvent | null = targetEvent;

    while (currentEvent && currentEvent.parent) {
      eventPath.push(currentEvent);
      currentEvent = currentEvent.parent;
    }

    eventPath.reverse();

    let currentRows = rows;
    let matchedRow: RowComponent | null = null;

    for (let i = 0; i < eventPath.length; i++) {
      const event = eventPath[i];
      if (!event) {
        break;
      }

      const nextRow = this._indexRowsByEventIndex(currentRows).get(event.eventIndex);
      if (!nextRow) {
        // Ancestor not present (e.g. hidden by an active filter). Fall back to
        // the deepest row we did resolve so navigation lands on the nearest
        // visible ancestor instead of silently doing nothing.
        break;
      }

      matchedRow = nextRow;
      if (i === eventPath.length - 1) {
        break;
      }

      let children = matchedRow.getTreeChildren() ?? [];
      const rowData = matchedRow.getData() as TimeOrderRow;
      if (!children.length && rowData._children?.length && !matchedRow.isTreeExpanded()) {
        const rowToExpand = matchedRow;
        withCodeDrivenExpand(() => rowToExpand.treeExpand());
        await this._waitForTableRender();
        children = matchedRow.getTreeChildren() ?? [];
      }

      currentRows = children;
    }

    return matchedRow;
  }

  private _indexRowsByEventIndex(rows: RowComponent[]): Map<number, RowComponent> {
    const indexByEventIndex = new Map<number, RowComponent>();
    for (const row of rows) {
      const rowData = row.getData() as TimeOrderRow;
      indexByEventIndex.set(rowData.originalData.eventIndex, row);
    }

    return indexByEventIndex;
  }
}

type FindEvt = CustomEvent<{ text: string; count: number; options: { matchCase: boolean } }>;
