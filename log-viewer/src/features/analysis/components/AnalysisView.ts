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
import { LitElement, css, html, unsafeCSS, type PropertyValues } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { Tabulator, type RowComponent } from 'tabulator-tables';

import type { ApexLog } from 'apex-log-parser';
import { isVisible } from '../../../core/utility/Util.js';
import { createBottomUpTable } from '../../call-tree/components/BottomUpTable.js';

import dataGridStyles from '../../../tabulator/style/DataGrid.scss';

// styles
import codiconStyles from '../../../styles/codicon.css';
import { globalStyles } from '../../../styles/global.styles.js';

// Components
import '../../../components/GridSkeleton.js';
import '../../../components/datagrid-filter-bar.js';

provideVSCodeDesignSystem().register(
  vsCodeButton(),
  vsCodeCheckbox(),
  vsCodeDropdown(),
  vsCodeOption(),
);

@customElement('analysis-view')
export class AnalysisView extends LitElement {
  static styles = [
    unsafeCSS(dataGridStyles),
    unsafeCSS(codiconStyles),
    globalStyles,
    css`
      :host {
        --button-icon-hover-background: var(--vscode-toolbar-hoverBackground);

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

      .filter-container {
        display: flex;
        gap: 4px;
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

  constructor() {
    super();

    document.addEventListener('lv-find', this._findEvt);
    document.addEventListener('lv-find-match', this._findEvt);
    document.addEventListener('lv-find-close', this._findEvt);
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
          <div slot="filters" class="dropdown-container">
            <label id="groupby-dropdown-label" for="groupby-dropdown">Group by</label>
            <vscode-dropdown
              id="groupby-dropdown"
              aria-label="Group by"
              aria-labelledby="groupby-dropdown-label"
              @change="${this._groupBy}"
            >
              <vscode-option>None</vscode-option>
              <vscode-option>Namespace</vscode-option>
              <vscode-option>Type</vscode-option>
            </vscode-dropdown>
          </div>

          <div slot="actions">
            <vscode-button
              appearance="icon"
              aria-label="Export to CSV"
              title="Export to CSV"
              @click=${this._exportToCSV}
            >
              <span class="codicon codicon-desktop-download"></span>
            </vscode-button>
            <vscode-button
              appearance="icon"
              aria-label="Copy to clipboard"
              title="Copy to clipboard"
              @click=${this._copyToClipboard}
            >
              <span class="codicon codicon-copy"></span>
            </vscode-button>
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
    const fieldName = target.value.toLowerCase();
    if (this.analysisTable) {
      //@ts-expect-error This is a custom function added in the GroupSort custom module
      this.analysisTable?.setSortedGroupBy(fieldName !== 'none' ? fieldName : '');
    }
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
