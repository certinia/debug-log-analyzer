/*
 * Copyright (c) 2022 Certinia Inc. All rights reserved.
 */
import {
  provideVSCodeDesignSystem,
  vsCodeButton,
  vsCodeCheckbox,
  vsCodeDropdown,
  vsCodeOption,
} from '@vscode/webview-ui-toolkit';
import { css, html, LitElement, unsafeCSS, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import type { RowComponent, Tabulator } from 'tabulator-tables';

import type { ApexLog, LogEvent } from 'apex-log-parser';
import { eventBus } from '../../../core/events/EventBus.js';
import { vscodeMessenger } from '../../../core/messaging/VSCodeExtensionMessenger.js';
import { findEventByTimestamp } from '../../../core/utility/EventSearch.js';
import { isVisible } from '../../../core/utility/Util.js';
import type { AggregatedRow, BottomUpRow } from '../utils/Aggregation.js';
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
import { createTimeOrderTable } from './TimeOrderTable.js';

import codiconStyles from '@vscode/codicons/dist/codicon.css';

provideVSCodeDesignSystem().register(
  vsCodeButton(),
  vsCodeCheckbox(),
  vsCodeDropdown(),
  vsCodeOption(),
);

type ViewMode = 'time-order' | 'aggregated' | 'bottom-up';

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
  debugOnlyFilterCache = new Map<string, boolean>();
  typeFilterCache = new Map<string, boolean>();

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

  private contextMenu: ContextMenu | null = null;
  private contextMenuRow: TimeOrderRow | null = null;
  private viewSwitchEpoch = 0;

  get _callTreeTableWrapper(): HTMLDivElement | null {
    return (this.tableContainer = this.renderRoot?.querySelector('#call-tree-table') ?? null);
  }

  private _goToRowEvt = ((e: CustomEvent) => {
    this._goToRow(e.detail.timestamp);
  }) as EventListener;

  constructor() {
    super();

    document.addEventListener('calltree-go-to-row', this._goToRowEvt);
    document.addEventListener('lv-find', this._findEvt);
    document.addEventListener('lv-find-match', this._findEvt);
    document.addEventListener('lv-find-close', this._findEvt);
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
  }

  static styles = [
    unsafeCSS(dataGridStyles),
    unsafeCSS(codiconStyles),
    unsafeCSS(soqlSyntaxStyles),
    globalStyles,
    css`
      :host {
        --button-icon-hover-background: var(--vscode-toolbar-hoverBackground);

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
      }

      .filter-container {
        display: flex;
        gap: 4px;
      }

      .filter-section {
        display: block;
      }

      .dropdown-container {
        box-sizing: border-box;
        display: flex;
        flex-flow: column nowrap;
        align-items: flex-start;
        justify-content: flex-start;

        label {
          display: block;
          color: var(--vscode-descriptionForeground);
          cursor: pointer;
          font-size: calc(var(--vscode-font-size) * 0.9);
          font-weight: 400;
          line-height: 1.4;
          margin-bottom: 4px;
          user-select: none;
        }
      }

      vscode-dropdown::part(listbox) {
        width: auto;
      }

      .align__end {
        align-items: end;
      }

      .view-mode-buttons {
        display: flex;
        gap: 0;
        align-self: flex-end;
      }

      .view-mode-buttons vscode-button {
        height: 26px;
      }

      .view-mode-buttons vscode-button::part(control) {
        border-radius: 0;
        min-width: auto;
        padding: 0 8px;
        height: 100%;
      }

      .view-mode-buttons vscode-button:first-child::part(control) {
        border-radius: 2px 0 0 2px;
      }

      .view-mode-buttons vscode-button:last-child::part(control) {
        border-radius: 0 2px 2px 0;
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
          <div class="header-bar">
            <div class="view-mode-buttons" role="radiogroup" aria-label="View mode">
              <vscode-button
                appearance="${this.viewMode === 'time-order' ? '' : 'secondary'}"
                @click="${() => this._setViewMode('time-order')}"
                >Time Order</vscode-button
              >
              <vscode-button
                appearance="${this.viewMode === 'aggregated' ? '' : 'secondary'}"
                @click="${() => this._setViewMode('aggregated')}"
                >Aggregated</vscode-button
              >
              <vscode-button
                appearance="${this.viewMode === 'bottom-up' ? '' : 'secondary'}"
                @click="${() => this._setViewMode('bottom-up')}"
                >Bottom-Up</vscode-button
              >
            </div>

            <div class="filter-container align__end">
              <vscode-button appearance="secondary" @click="${this._expandButtonClick}"
                >Expand</vscode-button
              >
              <vscode-button appearance="secondary" @click="${this._collapseButtonClick}"
                >Collapse</vscode-button
              >
            </div>

            <div class="filter-container align__end">
              <vscode-checkbox class="align__end" @change="${this._handleShowDetailsChange}"
                >Details</vscode-checkbox
              >

              ${isTimeOrder || this.viewMode === 'aggregated'
                ? html`
                    <vscode-checkbox class="align__end" @change="${this._handleDebugOnlyChange}"
                      >Debug Only</vscode-checkbox
                    >

                    <div class="dropdown-container">
                      <label for="types">Type:</label>
                      <vscode-dropdown @change="${this._handleTypeFilter}">
                        <vscode-option>None</vscode-option>
                        ${this.isVisible
                          ? repeat(
                              this._getAllTypes(this.timelineRoot?.children ?? []),
                              (type, _index) => html`<vscode-option>${type}</vscode-option>`,
                            )
                          : ''}
                      </vscode-dropdown>
                    </div>
                  `
                : ''}
            </div>

            ${this.viewMode === 'bottom-up'
              ? html`
                  <div class="dropdown-container">
                    <label for="bottomup-groupby">Group by:</label>
                    <vscode-dropdown
                      id="bottomup-groupby"
                      @change="${this._handleBottomUpGroupBy}"
                      current-value="${this.bottomUpGroupBy}"
                    >
                      <vscode-option>None</vscode-option>
                      <vscode-option>Namespace</vscode-option>
                      <vscode-option>Caller Namespace</vscode-option>
                      <vscode-option>Type</vscode-option>
                    </vscode-dropdown>
                  </div>
                `
              : ''}
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

  _handleTypeFilter(event: CustomEvent<{ selectedOptions: [{ value: string }] }>) {
    this.filterState.selectedTypes = new Set(event.detail.selectedOptions.map((e) => e.value));
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
        !this.filterState.selectedTypes.has('None')
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

  async _goToRow(timestamp: number) {
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

    const treeRow = this._findByTime(this.calltreeTable.getRows(), timestamp);
    //@ts-expect-error This is a custom function added in by RowNavigation custom module
    this.calltreeTable.goToRow(treeRow, { scrollIfVisible: true, focusRow: true });
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
    filterParams: { filterCache: Map<string, boolean> },
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
    });
    this.calltreeTable = table;
    await tableBuilt;
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
    });
    this.aggregatedTreeTable = table;
    await tableBuilt;
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
      },
      {
        selectableRows: 'highlight',
        enableClipboardAndDownload: true,
        exportFileName: 'bottom-up.csv',
      },
    );
    this.bottomUpTreeTable = table;
    await tableBuilt;
  }

  private _waitForNextFrame(): Promise<void> {
    return new Promise((resolve) => {
      requestAnimationFrame(() => resolve());
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
          timestamp: rowData.originalData.timestamp,
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

  private _findByTime(rows: RowComponent[], timestamp: number): RowComponent | null {
    if (!rows?.length || !this.rootMethod?.children) {
      return null;
    }

    const result = findEventByTimestamp(this.rootMethod.children, timestamp);
    if (!result) {
      return null;
    }

    return this._findRowByEvent(rows, result.event);
  }

  private _findRowByEvent(rows: RowComponent[], targetEvent: LogEvent): RowComponent | null {
    let start = 0;
    let end = rows.length - 1;

    while (start <= end) {
      const mid = Math.floor((start + end) / 2);
      const row = rows[mid];
      if (!row) {
        break;
      }

      const rowEvent = (row.getData() as TimeOrderRow).originalData as LogEvent;
      const endTime = rowEvent.exitStamp ?? rowEvent.timestamp;

      if (rowEvent.timestamp === targetEvent.timestamp) {
        return row;
      }

      if (targetEvent.timestamp >= rowEvent.timestamp && targetEvent.timestamp <= endTime) {
        const childResult = this._findRowByEvent(row.getTreeChildren() ?? [], targetEvent);
        return childResult ?? row;
      }

      if (targetEvent.timestamp > endTime) {
        start = mid + 1;
      } else {
        end = mid - 1;
      }
    }

    return null;
  }
}

export async function goToRow(timestamp: number) {
  document.dispatchEvent(
    new CustomEvent('calltree-go-to-row', { detail: { timestamp: timestamp } }),
  );
}

type FindEvt = CustomEvent<{ text: string; count: number; options: { matchCase: boolean } }>;
