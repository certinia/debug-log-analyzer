/*
 * Copyright (c) 2022 Certinia Inc. All rights reserved.
 */
import '#vscode-elements/vscode-button.js';
import '#vscode-elements/vscode-checkbox.js';
import '#vscode-elements/vscode-option.js';
import '../../../components/VsSelect.js';
import { css, html, LitElement, unsafeCSS, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import type { RowComponent, Tabulator } from 'tabulator-tables';

import type { ApexLog, LogEvent } from 'apex-log-parser';
import { eventBus } from '../../../core/events/EventBus.js';
import { vscodeMessenger } from '../../../core/messaging/VSCodeExtensionMessenger.js';
import { findEventByEventIndex } from '../../../core/utility/EventSearch.js';
import { isVisible } from '../../../core/utility/Util.js';
import { getSettings, updateSetting } from '../../settings/Settings.js';
import type { AggregatedRow, BottomUpRow } from '../utils/Aggregation.js';
import {
  categoryColoringStyles,
  categoryRowFormatter,
  wireCategoryColoring,
} from '../utils/CategoryColoring.js';
import { deepFilter } from '../utils/DetailsFilter.js';
import { expandCollapseAll } from '../utils/ExpandCollapse.js';
import type { TimeOrderRow } from '../utils/TimeOrderTree.js';

import dataGridStyles from '../../../tabulator/style/DataGrid.scss';

// styles
import { globalStyles } from '../../../styles/global.styles.js';
import { soqlSyntaxStyles } from '../../soql/styles/soql-syntax.css.js';

// web components
import '../../../components/ContextMenu.js';
import type { ContextMenu } from '../../../components/ContextMenu.js';
import '../../../components/GridSkeleton.js';

// Table creation functions
import { createAggregatedTable } from './AggregatedTable.js';
import { createBottomUpTable } from './BottomUpTable.js';
import {
  applyColumnView,
  buildColumnMenuItems,
  CALL_TREE_VIEWS,
  getColumnView,
  getTableFields,
  toggleField,
} from '../../../tabulator/ColumnViews.js';
import { createTimeOrderTable } from './TimeOrderTable.js';

type ViewMode = 'time-order' | 'aggregated' | 'bottom-up';

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
  debugOnlyFilterCache = new Map<number, boolean>();
  typeFilterCache = new Map<number, boolean>();

  findMap: { [key: number]: RowComponent } = {};
  totalMatches = 0;

  blockClearHighlights = true;
  searchString = '';
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

  get _callTreeTableWrapper(): HTMLDivElement | null {
    return (this.tableContainer = this.renderRoot?.querySelector('#call-tree-table') ?? null);
  }

  private _goToRowEvt = ((e: CustomEvent<{ eventIndex: number }>) => {
    this._goToRow(e.detail.eventIndex);
  }) as EventListener;

  constructor() {
    super();

    document.addEventListener('calltree-go-to-row', this._goToRowEvt);
    document.addEventListener('lv-find', this._findEvt);
    document.addEventListener('lv-find-match', this._findEvt);
    document.addEventListener('lv-find-close', this._findEvt);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    wireCategoryColoring(this);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener('calltree-go-to-row', this._goToRowEvt);
    document.removeEventListener('lv-find', this._findEvt);
    document.removeEventListener('lv-find-match', this._findEvt);
    document.removeEventListener('lv-find-close', this._findEvt);
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
    this._setColumnView(settings.callTree?.columnView ?? 'General');
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

      .header-bar {
        display: flex;
        gap: 10px;
        align-items: flex-end;
      }

      .filter-container {
        display: flex;
        gap: 4px;
        align-items: flex-end;
      }

      .filter-section {
        display: block;
      }

      /* push the grouping control to the right edge of the header bar */
      .group-end {
        margin-left: auto;
      }

      .view-mode-buttons {
        display: flex;
        gap: 0;
      }

      .view-mode-buttons vscode-button {
        height: 26px;
      }

      .view-mode-buttons vscode-button::part(base) {
        padding: 0 8px;
      }

      .view-mode-buttons vscode-button:first-child {
        --vsc-border-left-radius: 2px;
        --vsc-border-right-radius: 0;
      }

      .view-mode-buttons vscode-button:not(:first-child):not(:last-child) {
        --vsc-border-left-radius: 0;
        --vsc-border-right-radius: 0;
      }

      .view-mode-buttons vscode-button:last-child {
        --vsc-border-left-radius: 0;
        --vsc-border-right-radius: 2px;
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
    categoryColoringStyles,
  ];

  render() {
    const skeleton = !this.timelineRoot ? html`<grid-skeleton></grid-skeleton>` : '';
    const isTimeOrder = this.viewMode === 'time-order';

    return html`
      <div id="call-tree-container">
        <div>
          <div class="header-bar">
            <div class="view-mode-buttons" role="radiogroup" aria-label="View mode">
              <vscode-button
                ?secondary="${this.viewMode !== 'time-order'}"
                @click="${() => this._setViewMode('time-order')}"
                >Time Order</vscode-button
              >
              <vscode-button
                ?secondary="${this.viewMode !== 'aggregated'}"
                @click="${() => this._setViewMode('aggregated')}"
                >Aggregated</vscode-button
              >
              <vscode-button
                ?secondary="${this.viewMode !== 'bottom-up'}"
                @click="${() => this._setViewMode('bottom-up')}"
                >Bottom-Up</vscode-button
              >
            </div>

            <div class="filter-container">
              <vs-select
                id="column-view"
                prefix="Columns"
                label="Column view"
                @change="${this._handleColumnViewChange}"
                .value="${this.columnView}"
              >
                ${repeat(
                  CALL_TREE_VIEWS,
                  (view) => view.id,
                  (view) =>
                    html`<vscode-option
                      value="${view.id}"
                      ?selected="${this.columnView === view.id}"
                      >${this.columnOverrides[view.id] ? `${view.id} •` : view.id}</vscode-option
                    >`,
                )}
              </vs-select>
            </div>

            <div class="filter-container">
              <vscode-button secondary @click="${this._expandButtonClick}">Expand</vscode-button>
              <vscode-button secondary @click="${this._collapseButtonClick}"
                >Collapse</vscode-button
              >
            </div>

            <div class="filter-container">
              <vscode-checkbox @change="${this._handleShowDetailsChange}">Details</vscode-checkbox>

              ${
                isTimeOrder || this.viewMode === 'aggregated'
                  ? html`
                      <vscode-checkbox @change="${this._handleDebugOnlyChange}"
                        >Debug Only</vscode-checkbox
                      >

                      <vs-select
                        prefix="Type"
                        label="Type"
                        emptyValue=""
                        combobox
                        filter="fuzzy"
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
            </div>

            ${
              this.viewMode === 'bottom-up'
                ? html`
                    <vs-select
                      class="group-end"
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
          </div>
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
        <context-menu @menu-select="${this._handleContextMenuSelect}"></context-menu>
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

  _handleShowDetailsChange(event: Event) {
    const target = event.target as HTMLInputElement;
    this.filterState.showDetails = target.checked;
    this._updateFiltering();
  }

  _handleDebugOnlyChange(event: Event) {
    const target = event.target as HTMLInputElement;
    this.filterState.debugOnly = target.checked;
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
    await this._waitForNextFrame();

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
      }
    }

    if (switchEpoch !== this.viewSwitchEpoch) {
      return;
    }
  }

  private _destroyCurrentTable(): void {
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
    const hasOverride = !!this.columnOverrides[this.columnView];
    this.contextMenu.show(
      buildColumnMenuItems(table, this.columnView, CALL_TREE_VIEWS, ALWAYS_VISIBLE, hasOverride),
      clientX,
      clientY,
    );
  }

  /** Toggles a column in the active view's override, shared across all tables. */
  private _toggleColumn(field: string) {
    const table = this.contextMenuTable;
    this.contextMenuTable = null;
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

  /** Clears the active view's override, restoring its built-in columns. */
  private _resetColumns() {
    if (!this.columnOverrides[this.columnView]) {
      return;
    }
    const { [this.columnView]: _removed, ...rest } = this.columnOverrides;
    this.columnOverrides = rest;
    for (const table of this._tables) {
      applyColumnView(table, this._columnViewFields(this.columnView), ALWAYS_VISIBLE);
    }
    updateSetting('callTree.columnOverrides', this.columnOverrides);
  }

  _handleTypeFilter(event: Event) {
    const target = event.target as HTMLInputElement;
    this.typeFilter = target.value || 'All';
    this.filterState.selectedTypes = new Set(target.value ? [target.value] : []);
    this._updateFiltering();
  }

  _updateFiltering() {
    const activeTable = this._getActiveTable();
    if (!activeTable) {
      return;
    }

    this.debugOnlyFilterCache.clear();
    this.typeFilterCache.clear();

    const filtersToAdd = [];

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
      this.viewMode = 'time-order';
      await this.updateComplete;
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

  _namespaceFilter = (
    selectedNamespaces: string[],
    _namespace: string,
    data: TimeOrderRow | AggregatedRow | BottomUpRow,
    filterParams: { filterCache: Map<number, boolean> },
  ): boolean => {
    if (selectedNamespaces.length === 0) {
      return true;
    }
    return deepFilter<TimeOrderRow | AggregatedRow | BottomUpRow>(
      data,
      (row) => selectedNamespaces.includes(row.namespace || ''),
      filterParams.filterCache,
    );
  };

  private async _renderCallTree(
    callTreeTableContainer: HTMLDivElement,
    rootMethod: ApexLog,
  ): Promise<void> {
    if (this.calltreeTable) {
      await this._waitForNextFrame();
      return;
    }

    const { table, tableBuilt } = createTimeOrderTable(callTreeTableContainer, rootMethod, {
      showDetailsFilter: this._showDetailsFilter,
      namespaceFilter: this._namespaceFilter,
      onFilterCacheClear: () => {
        this.debugOnlyFilterCache.clear();
        this.typeFilterCache.clear();
      },
      onRenderStarted: () => {
        if (!this.blockClearHighlights && this.totalMatches > 0) {
          this._resetFindWidget();
          this._clearSearchHighlights();
        }
      },
      onContextMenu: (e, row) => {
        if (window.getSelection()?.type === 'Range') {
          return;
        }
        e.preventDefault();
        const mouseEvent = e as MouseEvent;
        this._showRowContextMenu(row, mouseEvent.clientX, mouseEvent.clientY);
      },
      rowFormatter: categoryRowFormatter,
    });
    this.calltreeTable = table;
    await tableBuilt;
    this._initTableColumns(table);
  }

  private async _renderAggregatedTree(
    container: HTMLDivElement,
    rootMethod: ApexLog,
  ): Promise<void> {
    if (this.aggregatedTreeTable) {
      await this._waitForNextFrame();
      return;
    }

    const { table, tableBuilt } = createAggregatedTable(container, rootMethod, {
      namespaceFilter: this._namespaceFilter,
      showDetailsFilter: this._showDetailsFilter,
      onFilterCacheClear: () => {
        this.debugOnlyFilterCache.clear();
        this.typeFilterCache.clear();
      },
      onRenderStarted: () => {
        if (!this.blockClearHighlights && this.totalMatches > 0) {
          this._resetFindWidget();
          this._clearSearchHighlights();
        }
      },
      rowFormatter: categoryRowFormatter,
    });
    this.aggregatedTreeTable = table;
    await tableBuilt;
    this._initTableColumns(table);
  }

  private async _renderBottomUpTree(container: HTMLDivElement, rootMethod: ApexLog): Promise<void> {
    if (this.bottomUpTreeTable) {
      await this._waitForNextFrame();
      return;
    }

    const { table, tableBuilt } = createBottomUpTable(
      container,
      rootMethod,
      {
        namespaceFilter: this._namespaceFilter,
        showDetailsFilter: this._showDetailsFilter,
        onRenderStarted: () => {
          if (!this.blockClearHighlights && this.totalMatches > 0) {
            this._resetFindWidget();
            this._clearSearchHighlights();
          }
        },
        rowFormatter: categoryRowFormatter,
      },
      {
        selectableRows: 'highlight',
        enableClipboardAndDownload: true,
        exportFileName: 'bottom-up.csv',
      },
    );
    this.bottomUpTreeTable = table;
    await tableBuilt;
    this._initTableColumns(table);
  }

  private _waitForNextFrame(): Promise<void> {
    return new Promise((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  }

  // Resolve once Tabulator has rendered (e.g. after a treeExpand puts new rows
  // in the DOM), with a two-frame fallback in case the expand triggers no
  // redraw. A single rAF can race the virtual renderer and leave getTreeChildren
  // empty mid-descent.
  private _waitForTableRender(): Promise<void> {
    const table = this.calltreeTable;
    if (!table) {
      return this._waitForNextFrame();
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

    // Column-header menu actions (see _showHeaderContextMenu).
    if (itemId.startsWith('view:')) {
      this._setColumnView(itemId.slice('view:'.length));
      this.contextMenuTable = null;
      return;
    }
    if (itemId.startsWith('col:')) {
      this._toggleColumn(itemId.slice('col:'.length));
      return;
    }
    if (itemId === 'reset') {
      this._resetColumns();
      this.contextMenuTable = null;
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

    const result = findEventByEventIndex(this.rootMethod, eventIndex);
    if (!result) {
      return null;
    }

    return this._materializeRowPath(rows, result.event);
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
        matchedRow.treeExpand();
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

export async function goToRow(target: { eventIndex: number }) {
  document.dispatchEvent(
    new CustomEvent('calltree-go-to-row', {
      detail: target,
    }),
  );
}

type FindEvt = CustomEvent<{ text: string; count: number; options: { matchCase: boolean } }>;
