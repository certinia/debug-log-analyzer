/*
 * Copyright (c) 2022 Certinia Inc. All rights reserved.
 */
// todo: add breadcrumbs back? - I will do this but in a later PR + better
// todo: improve scroll rows performance
//
//todo: ** future **
//todo: show total and self as percentage of total? + do the same on the analysis view?
//todo: add class to locate current tree for current log
//todo: add filter on line type
//todo: add filter on log level (fine, finer etc)
import { provideVSCodeDesignSystem, vsCodeCheckbox } from '@vscode/webview-ui-toolkit';
import { LitElement, type PropertyValues, css, html, unsafeCSS } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { type RowComponent, TabulatorFull as Tabulator } from 'tabulator-tables';

import '../components/skeleton/GridSkeleton';
import MinMaxEditor from '../datagrid/editors/MinMax';
import MinMaxFilter from '../datagrid/filters/MinMax';
import NumberFormat from '../datagrid/format/Number';
import { RowKeyboardNavigation } from '../datagrid/module/RowKeyboardNavigation';
import { RowNavigation } from '../datagrid/module/RowNavigation';
import { globalStyles } from '../global.styles';
import { LogLine, RootNode, TimedNode } from '../parsers/TreeParser';
import { hostService } from '../services/VSCodeService';
import treeViewStyles from './TreeView.scss';

provideVSCodeDesignSystem().register(vsCodeCheckbox());

let calltreeTable: Tabulator;
let tableContainer: HTMLDivElement | null;
let rootMethod: RootNode | null;

@customElement('call-tree-view')
export class CalltreeView extends LitElement {
  @property()
  timelineRoot: RootNode | null = null;

  get _callTreeTableWrapper(): HTMLDivElement | null {
    return (tableContainer = this.renderRoot?.querySelector('#call-tree-table') ?? null);
  }

  constructor() {
    super();
  }

  updated(changedProperties: PropertyValues): void {
    if (this.timelineRoot && changedProperties.has('timelineRoot')) {
      this._appendTableWhenVisible();
    }
  }

  static styles = [
    unsafeCSS(treeViewStyles),
    globalStyles,
    css`
      :host {
        height: 100%;
        width: 100%;
        display: flex;
        flex: 1;
      }

      #call-tree-container {
        display: flex;
        flex-direction: column;
        height: 100%;
        width: 100%;
        min-height: 0%;
        min-width: 0%;
        flex: 1;
      }

      #call-tree-table-container {
        min-height: 0px;
      }

      .checkbox__middle {
        vertical-align: bottom;
      }

      .filter-container {
        display: flex;
        gap: 10px;
      }
    `,
  ];

  render() {
    const skeleton = !this.timelineRoot ? html`<grid-skeleton></grid-skeleton>` : '';

    return html`
      <div id="call-tree-container">
        <div>
          <strong>Filter</strong>
          <div class="filter-container">
            <vscode-button appearance="secondary" @click="${this._expandButtonClick}"
              >Expand</vscode-button
            >
            <vscode-button appearance="secondary" @click="${this._collapseButtonClick}"
              >Collapse</vscode-button
            >
            <vscode-checkbox class="checkbox__middle" @change="${this._handleShowDetailsChange}"
              >Show Details</vscode-checkbox
            >
          </div>
        </div>
        <div id="call-tree-table-container">
          ${skeleton}
          <div id="call-tree-table"></div>
        </div>
      </div>
    `;
  }

  _handleShowDetailsChange(event: any) {
    calltreeTable.setFilter((data, _filterParams) => {
      return event.target.checked || data.originalData.duration || data.originalData.discontinuity;
    });
  }

  _expandButtonClick() {
    calltreeTable.blockRedraw();
    expandAll(calltreeTable.getRows());
    calltreeTable.restoreRedraw();
  }

  _collapseButtonClick() {
    calltreeTable.blockRedraw();
    collapseAll(calltreeTable.getRows());
    calltreeTable.restoreRedraw();
  }

  _appendTableWhenVisible() {
    const callTreeWrapper = this._callTreeTableWrapper;
    rootMethod = this.timelineRoot;
    if (callTreeWrapper && rootMethod) {
      const analysisObserver = new IntersectionObserver((entries, observer) => {
        const visible = entries[0]?.isIntersecting;
        if (rootMethod && visible) {
          renderCallTree(callTreeWrapper, rootMethod);
          observer.disconnect();
        }
      });
      analysisObserver.observe(callTreeWrapper);
    }
  }
}

export async function renderCallTree(
  callTreeTableContainer: HTMLDivElement,
  rootMethod: RootNode
): Promise<void> {
  if (calltreeTable) {
    // Ensure the table is fully visible before attempting to do things e.g go to rows.
    // Otherwise there are visible rendering issues.
    await new Promise((resolve, reject) => {
      const visibilityObserver = new IntersectionObserver((entries, observer) => {
        const entry = entries[0];
        const visible = entry?.isIntersecting && entry?.intersectionRatio > 0;
        if (visible) {
          resolve(true);
          observer.disconnect();
        } else {
          reject();
        }
      });

      visibilityObserver.observe(callTreeTableContainer);
    });
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    Tabulator.registerModule([RowKeyboardNavigation, RowNavigation]);

    const selfTimeFilterCache = new Map<string, boolean>();
    const totalTimeFilterCache = new Map<string, boolean>();
    calltreeTable = new Tabulator(callTreeTableContainer, {
      data: toCallTree(rootMethod.children),
      layout: 'fitColumns',
      placeholder: 'No Call Tree Available',
      columnCalcs: 'both',
      height: '100%',
      maxHeight: '100%',
      dataTree: true,
      // @ts-expect-error: needs to be added to type definition.
      dataTreeChildColumnCalcs: true,
      dataTreeBranchElement: '<span/>',
      selectable: 1,
      rowKeyboardNavigation: true,
      columnDefaults: {
        title: 'default',
        resizable: true,
        headerSortStartingDir: 'desc',
        headerTooltip: true,
      },
      columns: [
        {
          title: 'Name',
          field: 'text',
          headerSortTristate: true,
          bottomCalc: () => {
            return 'Total';
          },
          cssClass: 'datagrid-textarea datagrid-code-text',
          formatter: (cell, _formatterParams, _onRendered) => {
            const cellElem = cell.getElement();
            const row = cell.getRow();
            // @ts-expect-error: _row is private. This is temporary and I will patch the text wrap behaviour in the library.
            const treeLevel = row._row.modules.dataTree.index;
            const indent = row.getTable().options.dataTreeChildIndent || 0;
            const levelIndent = treeLevel * indent;
            cellElem.style.paddingLeft = `${levelIndent + 4}px`;
            cellElem.style.textIndent = `-${levelIndent}px`;

            const node = (cell.getData() as CalltreeRow).originalData;
            const text = node.text + (node.lineNumber ? `:${node.lineNumber}` : '');
            if (node.hasValidSymbols) {
              const logLineBody = document.createElement('a');
              logLineBody.href = '#';
              logLineBody.textContent = text;
              return logLineBody;
            }

            const textWrapper = document.createElement('span');
            textWrapper.appendChild(document.createTextNode(text));
            return textWrapper;
          },
          variableHeight: true,
          cellClick: (e, cell) => {
            if (!(e.target as HTMLElement).matches('a')) {
              return;
            }
            const node = (cell.getData() as CalltreeRow).originalData;
            if (node.hasValidSymbols) {
              const text = node.text;
              const lineNumber = node.lineNumber ? '-' + node.lineNumber : '';
              const bracketIndex = text.indexOf('(');
              const qname = bracketIndex > -1 ? text.substring(0, bracketIndex) : text;

              let typeName;
              if (node.type === 'METHOD_ENTRY') {
                const lastDot = qname.lastIndexOf('.');
                typeName = text.substring(0, lastDot) + lineNumber;
              } else {
                typeName = qname + lineNumber;
              }
              const fileOpenInfo = {
                typeName: typeName,
                text: text,
              };
              hostService().openType(fileOpenInfo);
            }
          },
          widthGrow: 5,
        },
        {
          title: 'DML Count',
          field: 'totalDmlCount',
          sorter: 'number',
          width: 60,
          hozAlign: 'right',
          headerHozAlign: 'right',
          bottomCalc: 'sum',
        },
        {
          title: 'SOQL Count',
          field: 'totalSoqlCount',
          sorter: 'number',
          width: 60,
          hozAlign: 'right',
          headerHozAlign: 'right',
          bottomCalc: 'sum',
        },
        {
          title: 'Throws Count',
          field: 'totalThrownCount',
          sorter: 'number',
          width: 60,
          hozAlign: 'right',
          headerHozAlign: 'right',
          bottomCalc: 'sum',
        },
        {
          title: 'Rows',
          field: 'rows',
          sorter: 'number',
          width: 60,
          hozAlign: 'right',
          headerHozAlign: 'right',
          bottomCalc: 'sum',
        },
        {
          title: 'Total Time (ms)',
          field: 'duration',
          sorter: 'number',
          headerSortTristate: true,
          width: 100,
          hozAlign: 'right',
          headerHozAlign: 'right',
          formatter: NumberFormat,
          formatterParams: {
            thousand: false,
            precision: 3,
          },
          bottomCalcFormatter: NumberFormat,
          bottomCalc: 'sum',
          bottomCalcParams: { precision: 3 },
          headerFilter: MinMaxEditor,
          headerFilterFunc: MinMaxFilter,
          headerFilterFuncParams: { columnName: 'duration', filterCache: totalTimeFilterCache },
          headerFilterLiveFilter: false,
        },
        {
          title: 'Self Time (ms)',
          field: 'selfTime',
          sorter: 'number',
          headerSortTristate: true,
          width: 100,
          hozAlign: 'right',
          headerHozAlign: 'right',
          bottomCalc: 'sum',
          bottomCalcParams: { precision: 3 },
          bottomCalcFormatter: NumberFormat,
          formatter: NumberFormat,
          formatterParams: {
            thousand: false,
            precision: 3,
          },
          headerFilter: MinMaxEditor,
          headerFilterFunc: MinMaxFilter,
          headerFilterFuncParams: { columnName: 'selfTime', filterCache: selfTimeFilterCache },
          headerFilterLiveFilter: false,
        },
      ],
    });

    calltreeTable.on('dataFiltered', () => {
      totalTimeFilterCache.clear();
      selfTimeFilterCache.clear();
    });

    calltreeTable.on('tableBuilt', () => {
      resolve();
      calltreeTable.setFilter((data, _filterParams) => {
        return data.originalData.duration || data.originalData.discontinuity;
      });
    });
  });
}

function expandAll(rows: RowComponent[]) {
  const len = rows.length;
  for (let i = 0; i < len; i++) {
    const row = rows[i];
    if (row) {
      row.treeExpand();

      expandAll(row.getTreeChildren());
    }
  }
}

function collapseAll(rows: RowComponent[]) {
  const len = rows.length;
  for (let i = 0; i < len; i++) {
    const row = rows[i];
    if (row) {
      row.treeCollapse();

      collapseAll(row.getTreeChildren());
    }
  }
}

function toCallTree(nodes: LogLine[]): CalltreeRow[] | undefined {
  const len = nodes.length;
  if (!len) {
    return undefined;
  }

  const results: CalltreeRow[] = [];
  for (let i = 0; i < len; i++) {
    const node = nodes[i];
    if (node) {
      const isTimedNode = node instanceof TimedNode;
      const children = isTimedNode ? toCallTree(node.children) : null;
      const data: CalltreeRow = {
        id: node.timestamp,
        text: node.text,
        duration: node.duration,
        selfTime: node.selfTime,
        _children: children,
        totalDmlCount: node.totalDmlCount,
        totalSoqlCount: node.totalSoqlCount,
        totalThrownCount: node.totalThrownCount,
        rows: node.totalRowCount || 0,
        originalData: node,
      };
      results.push(data);
    }
  }
  return results;
}

export async function goToRow(timestamp: number) {
  if (!tableContainer || !rootMethod) {
    return;
  }

  document.dispatchEvent(new CustomEvent('show-tab', { detail: { tabid: 'tree-tab' } }));
  await renderCallTree(tableContainer, rootMethod);

  let treeRow: RowComponent | null = null;
  const rows = calltreeTable.getRows();
  const len = rows.length;
  for (let i = 0; i < len; i++) {
    const row = rows[i];
    treeRow = row ? findByTime(row, timestamp) : null;
    if (treeRow) {
      break;
    }
  }
  //@ts-expect-error This is a custom function added in by RowNavigation custom module
  calltreeTable.goToRow(treeRow);
}

function findByTime(row: RowComponent, timeStamp: number): RowComponent | null {
  if (timeStamp) {
    const node = (row.getData() as CalltreeRow).originalData;
    if (node.timestamp === timeStamp) {
      return row;
    }
    if (node instanceof TimedNode) {
      // do not search children is the timestamp is outside of the parents timeframe
      if (node.exitStamp && !(timeStamp >= node.timestamp && timeStamp <= node.exitStamp)) {
        return null;
      }

      const treeChildren = row.getTreeChildren();
      const len = treeChildren.length;
      for (let i = 0; i < len; ++i) {
        const child = treeChildren[i];

        const target = child ? findByTime(child, timeStamp) : null;
        if (target) {
          return target;
        }
      }
    }
  }
  return null;
}

interface CalltreeRow {
  id: number;
  originalData: LogLine;
  text: string;
  duration: number;
  selfTime: number;
  _children: CalltreeRow[] | undefined | null;
  totalDmlCount: number;
  totalSoqlCount: number;
  totalThrownCount: number;
  rows: number;
}
