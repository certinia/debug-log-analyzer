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
import { ApexLog, LogLine } from '../../parsers/ApexLogParser.js';
import { vscodeMessenger } from '../../services/VSCodeExtensionMessenger.js';
import { globalStyles } from '../../styles/global.styles.js';

// Tabulator custom modules, imports + styles
import { Tabulator, type ColumnComponent, type RowComponent } from 'tabulator-tables';
import { isVisible } from '../../Util.js';
import NumberAccessor from '../../datagrid/dataaccessor/Number.js';
import { progressFormatter } from '../../datagrid/format/Progress.js';
import { GroupCalcs } from '../../datagrid/group-calcs/GroupCalcs.js';
import * as CommonModules from '../../datagrid/module/CommonModules.js';
import { RowKeyboardNavigation } from '../../datagrid/module/RowKeyboardNavigation.js';
import { RowNavigation } from '../../datagrid/module/RowNavigation.js';
import dataGridStyles from '../../datagrid/style/DataGrid.scss';
import codiconStyles from '../../styles/codicon.css';
import { Find, formatter } from '../calltree-view/module/Find.js';
import { callStackSum } from './column-calcs/CallStackSum.js';

// Components
import '../datagrid/datagrid-filter-bar.js';
import '../skeleton/GridSkeleton.js';

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
        height: 100%;
        width: 100%;
        display: flex;
        flex-direction: column;
        flex: 1;
        gap: 1rem;
      }

      #analysis-table-container {
        display: contents;
        height: 100%;
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

  _findEvt = ((event: FindEvt) => this._find(event)) as EventListener;

  _groupBy(event: Event) {
    const target = event.target as HTMLInputElement;
    const fieldName = target.value.toLowerCase();

    this.analysisTable?.setGroupBy(fieldName !== 'none' ? fieldName : '');
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

  _find(e: CustomEvent<{ text: string; count: number; options: { matchCase: boolean } }>) {
    const isTableVisible = !!this.analysisTable?.element?.clientHeight;
    if (!isTableVisible && !this.totalMatches) {
      return;
    }

    const newFindArgs = JSON.parse(JSON.stringify(e.detail));
    const newSearch =
      newFindArgs.text !== this.findArgs.text ||
      newFindArgs.options.matchCase !== this.findArgs.options?.matchCase;
    this.findArgs = newFindArgs;

    const clearHighlights =
      e.type === 'lv-find-close' || (!isTableVisible && newFindArgs.count === 0);
    if (clearHighlights) {
      newFindArgs.text = '';
    }
    if (newSearch || clearHighlights) {
      //@ts-expect-error This is a custom function added in by Find custom module
      const result = this.analysisTable.find(this.findArgs);
      this.totalMatches = result.totalMatches;
      this.findMap = result.matchIndexes;

      if (!clearHighlights) {
        document.dispatchEvent(
          new CustomEvent('lv-find-results', { detail: { totalMatches: result.totalMatches } }),
        );
      }
    }

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
  }

  async _renderAnalysis(rootMethod: ApexLog) {
    if (!this._tableWrapper) {
      return;
    }
    const metricList = groupMetrics(rootMethod);

    const headerMenu = [
      {
        label: 'Export to CSV',
        action: function (_e: PointerEvent, column: ColumnComponent) {
          column.getTable().download('csv', 'analysis.csv', { bom: true, delimiter: ',' });
        },
      },
    ];

    Tabulator.registerModule(Object.values(CommonModules));
    Tabulator.registerModule([RowKeyboardNavigation, RowNavigation, Find, GroupCalcs]);
    this.analysisTable = new Tabulator(this._tableWrapper, {
      rowKeyboardNavigation: true,
      selectableRows: 'highlight',
      data: metricList,
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
      groupCalcs: true,
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
        headerMenu: headerMenu,
        headerWordWrap: true,
      },
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
          cssClass: 'datagrid-code-text',
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
          cssClass: 'datagrid-code-text',
        },
        {
          title: 'Count',
          field: 'count',
          sorter: 'number',
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
          formatter: progressFormatter,
          formatterParams: {
            thousand: false,
            precision: 3,
            totalValue: rootMethod.duration.total,
          },
          accessorDownload: NumberAccessor,
          bottomCalcFormatter: progressFormatter,
          bottomCalc: callStackSum,
          bottomCalcFormatterParams: { precision: 3, totalValue: rootMethod.duration.total },
        },
        {
          title: 'Self Time (ms)',
          field: 'selfTime',
          sorter: 'number',
          width: 165,
          hozAlign: 'right',
          headerHozAlign: 'right',
          bottomCalc: 'sum',
          bottomCalcFormatterParams: { precision: 3, totalValue: rootMethod.duration.total },
          formatter: progressFormatter,
          formatterParams: {
            thousand: false,
            precision: 3,
            totalValue: rootMethod.duration.total,
          },
          accessorDownload: NumberAccessor,
          bottomCalcFormatter: progressFormatter,
        },
      ],
    });

    this.analysisTable.on('dataFiltering', () => {
      this._resetFindWidget();
      this._clearSearchHighlights();
    });
  }

  _resetFindWidget() {
    document.dispatchEvent(new CustomEvent('lv-find-results', { detail: { totalMatches: 0 } }));
  }

  _clearSearchHighlights() {
    this._find(
      new CustomEvent('lv-find', {
        detail: { text: '', count: 0, options: { matchCase: false } },
      }),
    );
  }
}
export class Metric {
  name: string;
  type;
  count = 0;
  totalTime = 0;
  selfTime = 0;
  namespace;
  nodes: LogLine[] = [];

  constructor(node: LogLine) {
    this.name = node.text;
    this.type = node.type;
    this.namespace = node.namespace;
  }
}

function groupMetrics(root: LogLine) {
  const methodMap: Map<string, Metric> = new Map();

  for (const child of root.children) {
    if (child.duration.total) {
      addNodeToMap(methodMap, child);
    }
  }
  return Array.from(methodMap.values());
}

function addNodeToMap(map: Map<string, Metric>, node: LogLine) {
  if (node.duration.total) {
    const key = node.namespace + node.text;
    let metric = map.get(key);
    if (!metric) {
      metric = new Metric(node);
      map.set(key, metric);
    }

    ++metric.count;
    metric.totalTime += node.duration.total;
    metric.selfTime += node.duration.self;
    metric.nodes.push(node);
  }

  for (const child of node.children) {
    if (child.duration.total) {
      addNodeToMap(map, child);
    }
  }
}

type VSCodeSaveFile = {
  fileContent: string;
  options: {
    defaultFileName: string;
  };
};

type FindEvt = CustomEvent<{ text: string; count: number; options: { matchCase: boolean } }>;
