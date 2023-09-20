/*
 * Copyright (c) 2022 Certinia Inc. All rights reserved.
 */
import { LitElement, PropertyValues, css, html, unsafeCSS } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { ColumnComponent, TabulatorFull as Tabulator } from 'tabulator-tables';

import NumberAccessor from '../datagrid/dataaccessor/Number';
import Number from '../datagrid/format/Number';
import { RowKeyboardNavigation } from '../datagrid/module/RowKeyboardNavigation';
import dataGridStyles from '../datagrid/style/DataGrid.scss';
import { globalStyles } from '../global.styles';
import { RootNode, TimedNode } from '../parsers/TreeParser';
import { hostService } from '../services/VSCodeService';
import './AnalysisView.scss';

let analysisTable: Tabulator;
let tableContainer: HTMLDivElement;
@customElement('analysis-view')
export class AnalysisView extends LitElement {
  @property()
  timelineRoot: RootNode | null = null;

  constructor() {
    super();
  }

  updated(changedProperties: PropertyValues): void {
    const timlineRoot = changedProperties.has('timelineRoot');
    if (this.timelineRoot && timlineRoot) {
      tableContainer = this.shadowRoot?.getElementById('analysis-table') as HTMLDivElement;
      if (tableContainer) {
        initAnalysisRender(tableContainer, this.timelineRoot);
      }
    }
  }

  static styles = [
    unsafeCSS(dataGridStyles),
    globalStyles,
    css`
      :host {
        height: 100%;
        width: 100%;
        display: flex;
        flex-direction: column;
        flex: 1;
      }

      #analysis-table-container {
        display: contents;
        height: 100%;
      }
    `,
  ];

  render() {
    return html`
      <div>
        <strong>Group by</strong>
        <div>
          <input id="analysis-groupby-checkbox" type="checkbox" @change="${this._groupBy}" />
          <label for="analysis-groupby-checkbox">Type</label>
        </div>
      </div>
      <div id="analysis-table-container">
        <div id="analysis-table"></div>
      </div>
    `;
  }

  _groupBy(event: Event) {
    const checkBox = event.target as HTMLInputElement;
    analysisTable.setGroupBy(checkBox.checked ? 'type' : '');
  }
}

export function initAnalysisRender(analysisRoot: HTMLElement, rootMethod: RootNode) {
  if (analysisRoot) {
    const analysisObserver = new IntersectionObserver((entries, observer) => {
      const visible = entries[0].isIntersecting;
      if (visible) {
        renderAnalysis(rootMethod);
        observer.disconnect();
      }
    });
    analysisObserver.observe(analysisRoot);
  }
}

async function renderAnalysis(rootMethod: RootNode) {
  const methodMap: Map<string, Metric> = new Map();

  addNodeToMap(methodMap, rootMethod);
  const metricList = [...methodMap.values()];

  const headerMenu = [
    {
      label: 'Export to CSV',
      action: function (_e: PointerEvent, column: ColumnComponent) {
        column.getTable().download('csv', 'analysis.csv', { bom: true, delimiter: ',' });
      },
    },
  ];

  Tabulator.registerModule(RowKeyboardNavigation);
  analysisTable = new Tabulator(tableContainer, {
    rowKeyboardNavigation: true,
    selectable: 1,
    data: metricList,
    layout: 'fitColumns',
    placeholder: 'No Analysis Available',
    columnCalcs: 'both',
    clipboard: true,
    downloadEncoder: function (fileContents: string, mimeType) {
      const vscodeHost = hostService();
      if (vscodeHost) {
        vscodeHost.saveFile({ fileContent: fileContents, defaultFilename: 'analysis.csv' });
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
    groupClosedShowCalcs: true,
    groupStartOpen: false,
    groupToggleElement: 'header',
    columnDefaults: {
      title: 'default',
      resizable: true,
      headerSortStartingDir: 'desc',
      headerTooltip: true,
      headerMenu: headerMenu,
    },
    initialSort: [{ column: 'selfTime', dir: 'desc' }],
    columns: [
      {
        title: 'Name',
        field: 'name',
        headerSortStartingDir: 'asc',
        sorter: 'string',
        tooltip: true,
        cssClass: 'datagrid-code-text',
        bottomCalc: () => {
          return 'Total';
        },
        widthGrow: 5,
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
        width: 100,
        hozAlign: 'right',
        headerHozAlign: 'right',
        formatter: Number,
        formatterParams: {
          thousand: false,
          precision: 3,
        },
        accessorDownload: NumberAccessor,
        bottomCalcFormatter: Number,
        bottomCalc: 'sum',
        bottomCalcFormatterParams: { precision: 3 },
      },
      {
        title: 'Self Time (ms)',
        field: 'selfTime',
        sorter: 'number',
        width: 100,
        hozAlign: 'right',
        headerHozAlign: 'right',
        bottomCalc: 'sum',
        bottomCalcFormatterParams: { precision: 3 },
        formatter: Number,
        formatterParams: {
          thousand: false,
          precision: 3,
        },
        accessorDownload: NumberAccessor,
        bottomCalcFormatter: Number,
      },
    ],
  });
}

export class Metric {
  name: string;
  type: string;
  count = 0;
  totalTime = 0;
  selfTime = 0;

  constructor(name: string, node: TimedNode) {
    this.name = name;
    this.type = node.type;
  }
}

function addNodeToMap(map: Map<string, Metric>, node: TimedNode, key?: string) {
  const children = node.children;

  if (key) {
    const totalTime = node.duration;
    const selfTime = node.selfTime;
    let metric = map.get(key);
    if (!metric) {
      metric = new Metric(key, node);
      map.set(key, metric);
    }

    ++metric.count;
    metric.totalTime += totalTime;
    metric.selfTime += selfTime;
  }

  children.forEach(function (child) {
    if (child instanceof TimedNode) {
      addNodeToMap(map, child, child.text);
    }
  });
}
