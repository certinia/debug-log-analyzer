/*
 * Copyright (c) 2022 Certinia Inc. All rights reserved.
 */
import '#vscode-elements/vscode-button.js';
import '#vscode-elements/vscode-option.js';
import '../../../components/VsSelect.js';
import '#vscode-elements/vscode-toolbar-button.js';
import { LitElement, css, html, unsafeCSS, type PropertyValues } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import type { RowComponent, Tabulator } from 'tabulator-tables';

import type { ApexLog } from 'apex-log-parser';
import '../../../components/ContextMenu.js';
import type { ContextMenu } from '../../../components/ContextMenu.js';
import { DomListenerController } from '../../../core/events/DomListenerController.js';
import { eventBus } from '../../../core/events/EventBus.js';
import type { FindEventDetail, FindEventMap } from '../../find/findEvents.js';
import {
  LocatedRowIds,
  LocatedRowMarker,
  rowDetailSelection,
  rowFrames,
} from '../../../components/locatedRow.js';
import { InspectorEmphasis } from '../../../components/inspectorEmphasis.js';
import { revealFirstOf, wireInspectorTab } from '../../../components/inspectorTab.js';
import { SelectionEchoGuard } from '../../../core/events/SelectionEchoGuard.js';
import { eventByEventIndex } from '../../../core/utility/EventSearch.js';
import { isVisible } from '../../../core/utility/Util.js';
import { createBottomUpTable } from '../../call-tree/components/BottomUpTable.js';
import { ColumnSettingsController } from '../../../components/ColumnSettingsController.js';
import { CALL_TREE_VIEWS } from '../../../tabulator/ColumnViews.js';
import type { BottomUpRow } from '../../call-tree/utils/Aggregation.js';
import { findRootBucket } from '../../call-tree/utils/bucketRows.js';
import {
  categoryColoringStyles,
  groupedRowFormatter,
  wireCategoryColoring,
} from '../../call-tree/utils/CategoryColoring.js';
import { expandCollapseAll } from '../../call-tree/utils/ExpandCollapse.js';

import { onTableReshaped } from '../../../tabulator/module/tableReshape.js';
import { tableHolder } from '../../../tabulator/module/tableHolder.js';

import dataGridStyles from '../../../tabulator/style/DataGrid.scss';

// styles
import { globalStyles } from '../../../styles/global.styles.js';
import { soqlSyntaxStyles } from '../../soql/styles/soql-syntax.css.js';

// Components
import '../../../components/datagrid-filter-bar.js';
import '../../../components/GridSkeleton.js';

/** The Name column is always shown in the analysis table. */
const ALWAYS_VISIBLE = ['text'];

@customElement('analysis-view')
export class AnalysisView extends LitElement {
  static styles = [
    unsafeCSS(dataGridStyles),
    unsafeCSS(soqlSyntaxStyles),
    globalStyles,
    css`
      :host {
        height: 100%;
        width: 100%;
        display: flex;
        gap: 1rem;
        /* inset previously provided by the tab panel's padding */
        padding: 10px 6px;
        box-sizing: border-box;
      }

      .analysis-view {
        display: flex;
        flex-direction: column;
        height: 100%;
        width: 100%;
      }

      #analysis-table-container {
        height: 100%;
        width: 100%;
        min-height: 0;
        min-width: 0;
      }

      #analysis-table {
        display: inline-block;
        height: 100%;
        width: 100%;
      }

      .header-bar {
        display: flex;
        gap: 10px;
        margin-bottom: 4px;
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
    `,
    categoryColoringStyles,
  ];

  @property()
  timelineRoot: ApexLog | null = null;

  analysisTable: Tabulator | null = null;

  private readonly _columns = new ColumnSettingsController(this, {
    section: 'callTree',
    read: (settings) => settings.callTree,
    views: CALL_TREE_VIEWS,
    alwaysVisible: ALWAYS_VISIBLE,
    tables: () => (this.analysisTable ? [this.analysisTable] : []),
  });
  private contextMenu: ContextMenu | null = null;
  tableContainer: HTMLDivElement | null = null;
  findMap: { [key: number]: RowComponent } = {};
  findArgs: { text: string; count: number; options: { matchCase: boolean } } = {
    text: '',
    count: 0,
    options: { matchCase: false },
  };
  totalMatches = 0;
  blockClearHighlights = true;

  filterState = { showDetails: false };

  // Precomputed at tree-build time on each BottomUpRow; the filter is a
  // single boolean read with no walk and no cache.
  _showDetailsFilter = (data: BottomUpRow): boolean => data._hasDetailsDeep;

  /** Releases the category-colouring settings subscription; set while connected. */
  private _categoryColoringOff: (() => void) | null = null;

  /** Guards the programmatic select made on the inspector's behalf. */
  private _echoGuard = new SelectionEchoGuard();
  private _inspectorUnsubscribe: (() => void) | null = null;
  private _locatedRow = new LocatedRowMarker();
  private _locateIds = new LocatedRowIds();
  private _emphasis = new InspectorEmphasis();

  private readonly _findBus = new DomListenerController<FindEventMap>(this, document, {
    'lv-find': (e) => void this._find(e),
    'lv-find-match': (e) => void this._find(e),
    'lv-find-close': (e) => void this._find(e),
  });

  override connectedCallback(): void {
    super.connectedCallback();
    this._categoryColoringOff = wireCategoryColoring(this);
    this._inspectorUnsubscribe = wireInspectorTab('analysis', this._emphasis, {
      // A row is a method bucket rather than one event, so a frame is translated
      // into the paths of the rows it heads.
      mark: (eventIndexes) => this._markLocated(eventIndexes),
      // An inspector finding names one event; the grid holds it in the bucket for
      // its method, so that bucket is what gets revealed.
      reveal: (eventIndex, signal) => this._revealEventIndex(eventIndex, signal),
      clear: () => {
        // The table reports the clear itself, which is what reaches the inspector.
        this.analysisTable?.deselectRow();
      },
      // A row buckets calls, so a merged pick moves to the first of them.
      revealMerged: revealFirstOf((eventIndex, signal) =>
        this._revealEventIndex(eventIndex, signal),
      ),
    });
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._categoryColoringOff?.();
    this._categoryColoringOff = null;
    this._inspectorUnsubscribe?.();
    this._inspectorUnsubscribe = null;
    this._locatedRow.clear();
  }

  /**
   * Mark the buckets that hold `eventIndexes`. The grid ranks methods and expands
   * to their callers, so one frame heads a row at every caller depth it sits in.
   */
  private _markLocated(eventIndexes: readonly number[]): void {
    this._locatedRow.mark(
      this.analysisTable?.element ?? null,
      this._locateIds.idsFor(this.timelineRoot, eventIndexes, 'callers'),
    );
  }

  /**
   * Select the bucket holding `eventIndex` and scroll it into view. Guarded, so the
   * inspector keeps the findings it was clicked in rather than being rebuilt around
   * the row it just asked for.
   */
  private async _revealEventIndex(eventIndex: number, signal: AbortSignal): Promise<void> {
    const table = this.analysisTable;
    const root = this.timelineRoot;
    if (!table || !root) {
      return;
    }
    const event = eventByEventIndex(root, eventIndex);
    if (!event) {
      return;
    }
    // The grid is bottom-up, so the frame heads a top-level bucket its own key
    // finds, without reading what any bucket holds.
    const match = findRootBucket(table.getRows(), event);
    if (!match) {
      return;
    }

    // Show Details keeps only rows with a duration, so the buckets for debug
    // lines, thrown exceptions and query plans are filtered out — exactly the
    // events a finding points at. Turn the filter off rather than reveal nothing.
    if (!this.filterState.showDetails && !this._showDetailsFilter(match.getData() as BottomUpRow)) {
      this._handleShowDetailsChange();
      await this.updateComplete;
    }

    if (signal.aborted) {
      return;
    }

    await this._echoGuard.runAsync(() =>
      //@ts-expect-error This is a custom function added in by RowNavigation custom module
      table.goToRow(match, { scrollIfVisible: false, focusRow: false }),
    );
  }

  firstUpdated(): void {
    this.contextMenu = this.renderRoot.querySelector('context-menu');
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

  render() {
    const skeleton = !this.timelineRoot ? html`<grid-skeleton></grid-skeleton>` : '';

    return html`
      <div class="analysis-view">
        <datagrid-filter-bar>
          <div slot="table-actions" class="filter-container">
            <vscode-button
              secondary
              aria-label="Expand all"
              title="Expand all"
              @click=${this._expandButtonClick}
              >Expand</vscode-button
            >
            <vscode-button
              secondary
              aria-label="Collapse all"
              title="Collapse all"
              @click=${this._collapseButtonClick}
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

          <div slot="filters" class="filter-container">
            <button
              type="button"
              class="filter-control pill-toggle"
              aria-pressed="${this.filterState.showDetails}"
              @click="${this._handleShowDetailsChange}"
            >
              Details
            </button>
          </div>

          <vs-select
            dense
            slot="group"
            id="groupby-dropdown"
            prefix="Group"
            label="Group by"
            @change="${this._groupBy}"
          >
            <vscode-option>None</vscode-option>
            <vscode-option>Namespace</vscode-option>
            <vscode-option>Caller Namespace</vscode-option>
            <vscode-option>Type</vscode-option>
          </vs-select>

          <div slot="actions">
            <vscode-toolbar-button
              icon="list-selection"
              label="Columns"
              title="Columns"
              @click=${this._openColumnMenu}
            ></vscode-toolbar-button>
            <vscode-toolbar-button
              icon="desktop-download"
              label="Export to CSV"
              title="Export to CSV"
              @click=${this._exportToCSV}
            ></vscode-toolbar-button>
            <vscode-toolbar-button
              icon="copy"
              label="Copy to clipboard"
              title="Copy to clipboard"
              @click=${this._copyToClipboard}
            ></vscode-toolbar-button>
          </div>
        </datagrid-filter-bar>

        <div id="analysis-table-container">
          ${skeleton}
          <div id="analysis-table"></div>
        </div>
        <context-menu @menu-select="${this._handleColumnMenuSelect}"></context-menu>
      </div>
    `;
  }

  private _handleColumnViewChange(event: Event) {
    this._columns.choose((event.target as HTMLInputElement).value || 'General');
  }

  /** Applies the active view and wires the header menu once the table is built. */
  private _initTableColumns(table: Tabulator) {
    this._columns.applyTo(table);
    const header = table.element.querySelector<HTMLElement>('.tabulator-header');
    header?.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      this._showColumnMenu(event.clientX, event.clientY);
    });
  }

  private _showColumnMenu(x: number, y: number) {
    if (!this.contextMenu || !this.analysisTable) {
      return;
    }
    this.contextMenu.show(this._columns.menuItems(this.analysisTable), x, y);
  }

  private _openColumnMenu(event: Event) {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this._showColumnMenu(rect.left, rect.bottom);
  }

  /** Rebuilds the open column menu so checkmarks/reset icons reflect current state. */
  private _refreshColumnMenu() {
    if (!this.contextMenu?.isVisible() || !this.analysisTable) {
      return;
    }
    this.contextMenu.items = this._columns.menuItems(this.analysisTable);
  }

  private _handleColumnMenuSelect(e: CustomEvent<{ itemId: string }>) {
    const { itemId } = e.detail;
    const table = this.analysisTable;
    if (!table) {
      return;
    }
    if (itemId.startsWith('view:')) {
      this._columns.choose(itemId.slice('view:'.length));
      this._refreshColumnMenu();
      return;
    }
    if (itemId.startsWith('col:')) {
      this._columns.toggle(table, itemId.slice('col:'.length));
      this._refreshColumnMenu();
      return;
    }
    if (itemId.startsWith('reset:')) {
      this._columns.reset(itemId.slice('reset:'.length));
      this._refreshColumnMenu();
    }
  }

  private _onResetOption(event: CustomEvent<{ value: string }>) {
    this._columns.reset(event.detail.value);
  }

  _copyToClipboard() {
    this.analysisTable?.copyToClipboard('all');
  }

  _exportToCSV() {
    this.analysisTable?.download('csv', 'analysis.csv', { bom: true, delimiter: ',' });
  }

  get _tableWrapper(): HTMLDivElement | null | undefined {
    return (this.tableContainer ??= this.renderRoot?.querySelector('#analysis-table'));
  }

  _groupBy(event: Event) {
    const target = event.target as HTMLInputElement;
    // Grouping renumbers the matches both ways round, and `dataGrouped` reports
    // only the way that leaves the table grouped.
    this._dropSearch();
    const fieldName =
      target.value === 'Caller Namespace' ? 'callerNamespace' : target.value.toLowerCase();
    if (this.analysisTable) {
      //@ts-expect-error This is a custom function added in the GroupSort custom module
      this.analysisTable?.setSortedGroupBy(fieldName !== 'none' ? fieldName : '');
    }
  }

  _handleShowDetailsChange() {
    this.filterState.showDetails = !this.filterState.showDetails;
    this.requestUpdate();
    this._updateFiltering();
  }

  _updateFiltering() {
    const table = this.analysisTable;
    if (!table) {
      return;
    }
    this._dropSearch();
    table.blockRedraw();
    table.clearFilter(false);
    if (!this.filterState.showDetails) {
      table.addFilter(this._showDetailsFilter);
    }
    table.restoreRedraw();
  }

  _expandButtonClick() {
    this._expandCollapseAll(true);
  }

  _collapseButtonClick() {
    this._expandCollapseAll(false);
  }

  _expandCollapseAll(expand: boolean) {
    const table = this.analysisTable;
    if (!table?.modules?.dataTree) {
      return;
    }
    table.blockRedraw();
    expandCollapseAll(table.getRows(), expand);
    tableHolder(table.element)?.focus();
    table.restoreRedraw();
  }

  _appendTableWhenVisible() {
    if (this.analysisTable) {
      return;
    }

    void isVisible(this).then((isVisible) => {
      if (this.timelineRoot && isVisible) {
        void this._renderAnalysis(this.timelineRoot);
      }
    });
  }

  async _find(e: CustomEvent<FindEventDetail>) {
    const isTableVisible = !!this.analysisTable?.element?.clientHeight;
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
      // @ts-expect-error This is a custom function added in by Find custom module
      const result = await this.analysisTable?.find(this.findArgs);
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
    await this.analysisTable.setCurrentMatch(this.findArgs.count, currentRow, {
      scrollIfVisible: false,
      focusRow: false,
    });
    this.blockClearHighlights = false;
  }

  async _renderAnalysis(rootMethod: ApexLog) {
    if (!this._tableWrapper) {
      return;
    }

    const { table, tableBuilt } = createBottomUpTable(
      this._tableWrapper,
      rootMethod,
      {
        showDetailsFilter: this._showDetailsFilter,
        rowFormatter: groupedRowFormatter,
      },
      {
        placeholder: 'No Analysis Available',
        selectableRows: 'highlight',
        enableClipboardAndDownload: true,
        exportFileName: 'analysis.csv',
      },
    );
    this.analysisTable = table;

    onTableReshaped(this.analysisTable, () => this._dropSearch());

    // Feed the inspector. Analysis rows merge many calls, so they
    // scope to every call they count.
    this.analysisTable.on('rowSelectionChanged', (_data, rows) => {
      if (this._echoGuard.suppressed) {
        return;
      }
      eventBus.emit('detail:select', {
        source: 'analysis',
        selection: rowDetailSelection(rows[0], this.timelineRoot, 'callers'),
        // The grid ranks methods by self time and expands to their callers, so
        // the inspector opens on the forward view instead.
        view: 'callers',
      });
    });

    // Tell the inspector which frames the pointer is over, so it can mark the
    // rows that stand for them. A row under a bucket is one of its callers, so it
    // names that caller rather than the calls it conducted.
    this.analysisTable.on('rowMouseEnter', (_e, row) => {
      eventBus.emit('detail:locate', {
        source: 'analysis',
        eventIndexes: rowFrames(row, this.timelineRoot, 'callers'),
      });
    });
    this.analysisTable.on('rowMouseLeave', () => {
      eventBus.emit('detail:locate', { source: 'analysis', eventIndexes: [] });
    });

    await tableBuilt;
    this._initTableColumns(this.analysisTable);
  }

  _resetFindWidget() {
    document.dispatchEvent(new CustomEvent('lv-find-results', { detail: { totalMatches: 0 } }));
  }

  /** Drop the search where its match numbering no longer describes the table. */
  _dropSearch() {
    if (!this.blockClearHighlights && this.totalMatches > 0) {
      this._resetFindWidget();
      this._clearSearchHighlights();
    }
  }

  _clearSearchHighlights() {
    this.findArgs.text = '';
    this.findArgs.count = 0;
    //@ts-expect-error This is a custom function added in by Find custom module
    this.analysisTable.clearFindHighlights();
    this.findMap = {};
    this.totalMatches = 0;
  }
}
