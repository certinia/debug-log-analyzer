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
import { Tabulator, type GlobalTooltipOption, type RowComponent } from 'tabulator-tables';

import type { ApexLog } from 'apex-log-parser';
import { vscodeMessenger } from '../../../core/messaging/VSCodeExtensionMessenger.js';
import { formatDuration, isVisible } from '../../../core/utility/Util.js';
import { sumRootNodesOnly } from '../services/CallStackSum.js';
import { group } from '../services/RowGrouper.js';

// Tabulator custom modules, imports + styles
import NumberAccessor from '../../../tabulator/dataaccessor/Number.js';
import { progressFormatterMS } from '../../../tabulator/format/ProgressMS.js';
import { GroupCalcs } from '../../../tabulator/groups/GroupCalcs.js';
import { GroupSort } from '../../../tabulator/groups/GroupSort.js';
import * as CommonModules from '../../../tabulator/module/CommonModules.js';
import { Find, formatter } from '../../../tabulator/module/Find.js';
import { RowKeyboardNavigation } from '../../../tabulator/module/RowKeyboardNavigation.js';
import { RowNavigation } from '../../../tabulator/module/RowNavigation.js';
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
          color: var(--vscode-foreground);
          cursor: pointer;
          font-size: var(--vscode-font-size);
          line-height: normal;
          margin-bottom: 2px;
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
            <label for="groupby-dropdown"><strong>Group by</strong></label>
            <vscode-dropdown id="groupby-dropdown" @change="${this._groupBy}">
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

      if (!clearHighlights) {
        document.dispatchEvent(
          new CustomEvent('lv-find-results', { detail: { totalMatches: result.totalMatches } }),
        );
      }
    }

    if (this.totalMatches <= 0) {
      return;
    }
    this.blockClearHighlights = true;
    this.analysisTable?.blockRedraw();
    const currentRow = this.findMap[this.findArgs.count];
    const rows = [
      currentRow,
      this.findMap[this.findArgs.count + 1],
      this.findMap[this.findArgs.count - 1],
    ];
    rows.forEach((row) => {
      row?.reformat();
    });
    //@ts-expect-error This is a custom function added in by RowNavigation custom module
    this.analysisTable.goToRow(currentRow, { scrollIfVisible: false, focusRow: false });
    this.analysisTable?.restoreRedraw();
    this.blockClearHighlights = false;
  }

  async _renderAnalysis(rootMethod: ApexLog) {
    if (!this._tableWrapper) {
      return;
    }

    Tabulator.registerModule(Object.values(CommonModules));
    Tabulator.registerModule([RowKeyboardNavigation, RowNavigation, Find, GroupCalcs, GroupSort]);

    const durationFormatterParams = { totalValue: rootMethod.duration.total };
    const tooltipContent: GlobalTooltipOption = (_event, cell, _onRender) => {
      return formatDuration(cell.getValue());
    };

    this.analysisTable = new Tabulator(this._tableWrapper, {
      rowKeyboardNavigation: true,
      selectableRows: 'highlight',
      data: group(rootMethod),
      layout: 'fitColumns',
      placeholder: 'No Analysis Available',
      columnCalcs: 'table',
      clipboard: true,
      downloadEncoder: function (fileContents: string, mimeType) {
        const vscodeHost = vscodeMessenger.getVsCodeAPI();
        if (vscodeHost) {
          vscodeMessenger.send<VSCodeSaveFile>('saveFile', {
            fileContent: fileContents,
            options: {
              defaultFileName: 'analysis.csv',
            },
          });
          return false;
        }

        return new Blob([fileContents], { type: mimeType });
      },
      dataTree: true, // temporary: fixes a disappearing table issue when scroll is dragged (needs fix in Tabulator)
      downloadRowRange: 'all',
      downloadConfig: {
        columnHeaders: true,
        columnGroups: true,
        rowGroups: true,
        columnCalcs: false,
        dataTree: true,
      },
      //@ts-expect-error types need update array is valid
      keybindings: { copyToClipboard: ['ctrl + 67', 'meta + 67'] },
      clipboardCopyRowRange: 'all',
      height: '100%',
      maxHeight: '100%',
      groupCalcs: true,
      groupSort: true,
      groupClosedShowCalcs: true,
      groupStartOpen: false,
      groupToggleElement: 'header',
      rowFormatter: (row: RowComponent) => {
        formatter(row, this.findArgs);
      },
      columnDefaults: {
        title: 'default',
        resizable: true,
        headerSortStartingDir: 'desc',
        headerTooltip: true,
        headerWordWrap: true,
      },
      tooltipDelay: 100,
      initialSort: [{ column: 'selfTime', dir: 'desc' }],
      headerSortElement: function (column, dir) {
        switch (dir) {
          case 'asc':
            return "<div class='sort-by--top'></div>";
            break;
          case 'desc':
            return "<div class='sort-by--bottom'></div>";
            break;
          default:
            return "<div class='sort-by'><div class='sort-by--top'></div><div class='sort-by--bottom'></div></div>";
        }
      },
      columns: [
        {
          title: 'Name',
          field: 'name',
          formatter: 'textarea',
          headerSortStartingDir: 'asc',
          sorter: 'string',
          headerSortTristate: true,
          cssClass: 'datagrid-code-text',
          bottomCalc: () => {
            return 'Total';
          },
          widthGrow: 5,
        },
        {
          title: 'Namespace',
          field: 'namespace',
          headerSortStartingDir: 'desc',
          width: 150,
          sorter: 'string',
          tooltip: true,
          headerFilter: 'list',
          headerFilterFunc: 'in',
          headerFilterParams: {
            valuesLookup: 'all',
            clearable: true,
            multiselect: true,
          },
          headerFilterLiveFilter: false,
        },
        {
          title: 'Type',
          field: 'type',
          headerSortStartingDir: 'asc',
          width: 150,
          sorter: 'string',
          tooltip: true,
        },
        {
          title: 'Count',
          field: 'count',
          sorter: 'number',
          cssClass: 'number-cell',
          width: 65,
          hozAlign: 'right',
          headerHozAlign: 'right',
          bottomCalc: 'sum',
        },
        {
          title: 'Total Time (ms)',
          field: 'totalTime',
          sorter: 'number',
          width: 165,
          hozAlign: 'right',
          headerHozAlign: 'right',
          bottomCalc: sumRootNodesOnly,
          bottomCalcFormatter: progressFormatterMS,
          bottomCalcFormatterParams: durationFormatterParams,
          formatter: progressFormatterMS,
          formatterParams: durationFormatterParams,
          accessorDownload: NumberAccessor,
          tooltip: tooltipContent,
        },
        {
          title: 'Self Time (ms)',
          field: 'selfTime',
          sorter: 'number',
          width: 165,
          hozAlign: 'right',
          headerHozAlign: 'right',
          bottomCalc: 'sum',
          bottomCalcFormatter: progressFormatterMS,
          bottomCalcFormatterParams: durationFormatterParams,
          formatter: progressFormatterMS,
          formatterParams: durationFormatterParams,
          accessorDownload: NumberAccessor,
          tooltip: tooltipContent,
        },
      ],
    });

    this.analysisTable.on('renderStarted', () => {
      if (!this.blockClearHighlights && this.totalMatches > 0) {
        this._resetFindWidget();
        this._clearSearchHighlights();
      }
    });
  }

  _resetFindWidget() {
    document.dispatchEvent(new CustomEvent('lv-find-results', { detail: { totalMatches: 0 } }));
  }

  _clearSearchHighlights() {
    this.findArgs.text = '';
    this.findArgs.count = 0;
    //@ts-expect-error This is a custom function added in by Find custom module
    this.analysisTable.clearFindHighlights(Object.values(this.findMap));
    this.findMap = {};
    this.totalMatches = 0;
  }
}

type VSCodeSaveFile = {
  fileContent: string;
  options: {
    defaultFileName: string;
  };
};

type FindEvt = CustomEvent<{ text: string; count: number; options: { matchCase: boolean } }>;
