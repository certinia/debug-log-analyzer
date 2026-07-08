/*
 * Copyright (c) 2022 Certinia Inc. All rights reserved.
 */
import '#vscode-elements/vscode-button.js';
import '#vscode-elements/vscode-checkbox.js';
import '#vscode-elements/vscode-option.js';
import '../../../components/VsSelect.js';
import '#vscode-elements/vscode-toolbar-button.js';
import { LitElement, css, html, unsafeCSS, type PropertyValues } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { RowComponent, Tabulator } from 'tabulator-tables';

import type { ApexLog } from 'apex-log-parser';
import { isVisible } from '../../../core/utility/Util.js';
import { createBottomUpTable } from '../../call-tree/components/BottomUpTable.js';
import type { BottomUpRow } from '../../call-tree/utils/Aggregation.js';
import {
  categoryColoringStyles,
  categoryRowFormatter,
  wireCategoryColoring,
} from '../../call-tree/utils/CategoryColoring.js';
import { expandCollapseAll } from '../../call-tree/utils/ExpandCollapse.js';

import dataGridStyles from '../../../tabulator/style/DataGrid.scss';

// styles
import { globalStyles } from '../../../styles/global.styles.js';
import { soqlSyntaxStyles } from '../../soql/styles/soql-syntax.css.js';

// Components
import '../../../components/GridSkeleton.js';
import '../../../components/datagrid-filter-bar.js';

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
      }

      .align__end {
        align-items: end;
      }

      /* cancel the checkbox's built-in 4px vertical margins so it bottom-aligns
         like the previous 18px-tall toolkit checkbox */
      vscode-checkbox {
        margin: -4px 0;
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
    `,
    categoryColoringStyles,
  ];

  @property()
  timelineRoot: ApexLog | null = null;

  analysisTable: Tabulator | null = null;
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

  constructor() {
    super();

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
    document.removeEventListener('lv-find', this._findEvt);
    document.removeEventListener('lv-find-match', this._findEvt);
    document.removeEventListener('lv-find-close', this._findEvt);
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
          <div slot="filters" class="filter-container align__end">
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

            <vscode-checkbox class="align__end" @change="${this._handleShowDetailsChange}"
              >Details</vscode-checkbox
            >

            <div class="dropdown-container">
              <label id="groupby-dropdown-label" for="groupby-dropdown">Group by</label>
              <vs-select id="groupby-dropdown" label="Group by" @change="${this._groupBy}">
                <vscode-option>None</vscode-option>
                <vscode-option>Namespace</vscode-option>
                <vscode-option>Caller Namespace</vscode-option>
                <vscode-option>Type</vscode-option>
              </vs-select>
            </div>
          </div>

          <div slot="actions">
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
      </div>
    `;
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

  _findEvt = ((event: FindEvt) => {
    this._find(event);
  }) as EventListener;

  _groupBy(event: Event) {
    const target = event.target as HTMLInputElement;
    const fieldName =
      target.value === 'Caller Namespace' ? 'callerNamespace' : target.value.toLowerCase();
    if (this.analysisTable) {
      //@ts-expect-error This is a custom function added in the GroupSort custom module
      this.analysisTable?.setSortedGroupBy(fieldName !== 'none' ? fieldName : '');
    }
  }

  _handleShowDetailsChange(event: Event) {
    const target = event.target as HTMLInputElement;
    this.filterState.showDetails = target.checked;
    this._updateFiltering();
  }

  _updateFiltering() {
    const table = this.analysisTable;
    if (!table) {
      return;
    }
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
    table.element?.querySelector<HTMLElement>('.tabulator-tableholder')?.focus();
    table.restoreRedraw();
  }

  _appendTableWhenVisible() {
    if (this.analysisTable) {
      return;
    }

    isVisible(this).then((isVisible) => {
      if (this.timelineRoot && isVisible) {
        this._renderAnalysis(this.timelineRoot);
      }
    });
  }

  async _find(e: CustomEvent<{ text: string; count: number; options: { matchCase: boolean } }>) {
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
        namespaceFilter: () => true,
        showDetailsFilter: this._showDetailsFilter,
        onFilterCacheClear: () => {
          if (!this.blockClearHighlights && this.totalMatches > 0) {
            this._resetFindWidget();
            this._clearSearchHighlights();
          }
        },
        onRenderStarted: () => {
          if (!this.blockClearHighlights && this.totalMatches > 0) {
            this._resetFindWidget();
            this._clearSearchHighlights();
          }
        },
        rowFormatter: categoryRowFormatter,
      },
      {
        placeholder: 'No Analysis Available',
        selectableRows: 'highlight',
        enableClipboardAndDownload: true,
        exportFileName: 'analysis.csv',
      },
    );
    this.analysisTable = table;

    this.analysisTable.on('dataSorted', () => {
      if (!this.blockClearHighlights && this.totalMatches > 0) {
        this._resetFindWidget();
        this._clearSearchHighlights();
      }
    });

    this.analysisTable.on('dataGrouped', () => {
      if (!this.blockClearHighlights && this.totalMatches > 0) {
        this._resetFindWidget();
        this._clearSearchHighlights();
      }
    });

    await tableBuilt;
  }

  _resetFindWidget() {
    document.dispatchEvent(new CustomEvent('lv-find-results', { detail: { totalMatches: 0 } }));
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

type FindEvt = CustomEvent<{ text: string; count: number; options: { matchCase: boolean } }>;
