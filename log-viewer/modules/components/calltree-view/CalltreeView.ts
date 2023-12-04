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

import MinMaxEditor from '../../datagrid/editors/MinMax.js';
import MinMaxFilter from '../../datagrid/filters/MinMax.js';
import { progressFormatter } from '../../datagrid/format/Progress.js';
import { RowKeyboardNavigation } from '../../datagrid/module/RowKeyboardNavigation.js';
import { RowNavigation } from '../../datagrid/module/RowNavigation.js';
import dataGridStyles from '../../datagrid/style/DataGrid.scss';
import { ApexLog, type LogEventType, LogLine, TimedNode } from '../../parsers/ApexLogParser.js';
import { hostService } from '../../services/VSCodeService.js';
import { globalStyles } from '../../styles/global.styles.js';
import '../skeleton/GridSkeleton.js';
import treeViewStyles from './TreeView.scss';

provideVSCodeDesignSystem().register(vsCodeCheckbox());

let calltreeTable: Tabulator;
let tableContainer: HTMLDivElement | null;
let rootMethod: ApexLog | null;
const debugOnlyFilterCache = new Map<number, boolean>();
const showDetailsFilterCache = new Map<number, boolean>();

@customElement('call-tree-view')
export class CalltreeView extends LitElement {
  @property()
  timelineRoot: ApexLog | null = null;

  filterState = { showDetails: false, debugOnly: false };

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
    unsafeCSS(dataGridStyles),
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

      .header-bar {
        display: flex;
        gap: 10px;
      }

      .filter-container {
        display: flex;
        gap: 5px;
        align-items: end;
      }

      .filter-section {
        display: block;
      }
    `,
  ];

  render() {
    const skeleton = !this.timelineRoot ? html`<grid-skeleton></grid-skeleton>` : '';

    return html`
      <div id="call-tree-container">
        <div>
          <div class="header-bar">
            <div class="filter-container">
              <vscode-button appearance="secondary" @click="${this._expandButtonClick}"
                >Expand</vscode-button
              >
              <vscode-button appearance="secondary" @click="${this._collapseButtonClick}"
                >Collapse</vscode-button
              >
            </div>

            <div class="filter-section">
              <strong>Filter</strong>
              <div class="filter-container">
                <vscode-checkbox class="checkbox__middle" @change="${this._handleShowDetailsChange}"
                  >Details</vscode-checkbox
                >
                <vscode-checkbox class="checkbox__middle" @change="${this._handleDebugOnlyChange}"
                  >Debug Only</vscode-checkbox
                >
              </div>
            </div>
          </div>
        </div>
        <div id="call-tree-table-container">
          ${skeleton}
          <div id="call-tree-table"></div>
        </div>
      </div>
    `;
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

  _updateFiltering() {
    calltreeTable.blockRedraw();
    if (this.filterState.showDetails) {
      // @ts-expect-error valid
      calltreeTable.removeFilter(showDetailsFilter);
    } else if (!this.filterState.showDetails) {
      // @ts-expect-error valid
      calltreeTable.addFilter(showDetailsFilter);
    }

    if (this.filterState.debugOnly) {
      calltreeTable.clearFilter(false);
      // @ts-expect-error valid
      calltreeTable.addFilter(debugFilter);
    } else if (!this.filterState.debugOnly) {
      // @ts-expect-error valid
      calltreeTable.removeFilter(debugFilter);
    }

    calltreeTable.restoreRedraw();
  }

  _expandButtonClick() {
    calltreeTable.blockRedraw();
    expandCollapseAll(calltreeTable.getRows(), true);
    calltreeTable.restoreRedraw();
  }

  _collapseButtonClick() {
    calltreeTable.blockRedraw();
    expandCollapseAll(calltreeTable.getRows(), false);
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

function deepFilter(
  rowData: CalltreeRow,
  filterFunction: (rowData: CalltreeRow) => boolean,
  filterParams: { filterCache: Map<number, boolean> },
): boolean {
  const cachedMatch = filterParams.filterCache.get(rowData.id);
  if (cachedMatch !== null && cachedMatch !== undefined) {
    return cachedMatch;
  }

  let childMatch = false;
  const children = rowData._children || [];
  let len = children.length;
  while (len-- > 0) {
    const childRow = children[len];
    if (childRow) {
      const match = deepFilter(childRow, filterFunction, filterParams);

      if (match) {
        childMatch = true;
        break;
      }
    }
  }

  filterParams.filterCache.set(rowData.id, childMatch);
  if (childMatch) {
    return true;
  }

  return filterFunction(rowData);
}

export async function renderCallTree(
  callTreeTableContainer: HTMLDivElement,
  rootMethod: ApexLog,
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
    let childIndent;
    calltreeTable = new Tabulator(callTreeTableContainer, {
      data: toCallTree(rootMethod.children),
      layout: 'fitColumns',
      placeholder: 'No Call Tree Available',
      columnCalcs: 'both',
      height: '100%',
      maxHeight: '100%',
      dataTree: true,
      dataTreeChildColumnCalcs: true,
      dataTreeBranchElement: '<span/>',
      selectable: 1,
      // @ts-expect-error custom property for datagrid/module/RowKeyboardNavigation
      rowKeyboardNavigation: true,
      columnDefaults: {
        title: 'default',
        resizable: true,
        headerSortStartingDir: 'desc',
        headerTooltip: true,
        headerWordWrap: true,
      },
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
            childIndent ??= row.getTable().options.dataTreeChildIndent || 0;
            const levelIndent = treeLevel * childIndent;
            cellElem.style.paddingLeft = `${levelIndent + 4}px`;
            cellElem.style.textIndent = `-${levelIndent}px`;

            const node = (cell.getData() as CalltreeRow).originalData;
            let text = node.text;
            if (node.hasValidSymbols) {
              text += node.lineNumber ? `:${node.lineNumber}` : '';
              return `<a href="#!">${text}</a>`;
            }

            const excludedTypes: LogEventType[] = ['SOQL_EXECUTE_BEGIN', 'DML_BEGIN'];
            text =
              (node.type &&
                (!excludedTypes.includes(node.type) && node.type !== text ? node.type + ': ' : '') +
                  text) ||
              '';
            return text;
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
          bottomCalc: 'max',
        },
        {
          title: 'SOQL Count',
          field: 'totalSoqlCount',
          sorter: 'number',
          width: 60,
          hozAlign: 'right',
          headerHozAlign: 'right',
          bottomCalc: 'max',
        },
        {
          title: 'Throws Count',
          field: 'totalThrownCount',
          sorter: 'number',
          width: 60,
          hozAlign: 'right',
          headerHozAlign: 'right',
          bottomCalc: 'max',
        },
        {
          title: 'Rows',
          field: 'rows',
          sorter: 'number',
          width: 60,
          hozAlign: 'right',
          headerHozAlign: 'right',
          bottomCalc: 'max',
        },
        {
          title: 'Total Time (ms)',
          field: 'duration',
          sorter: 'number',
          headerSortTristate: true,
          width: 150,
          hozAlign: 'right',
          headerHozAlign: 'right',
          formatter: progressFormatter,
          formatterParams: {
            thousand: false,
            precision: 3,
            totalValue: rootMethod.duration,
          },
          bottomCalcFormatter: progressFormatter,
          bottomCalc: 'max',
          bottomCalcFormatterParams: { precision: 3, totalValue: rootMethod.duration },
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
          width: 150,
          hozAlign: 'right',
          headerHozAlign: 'right',
          bottomCalc: 'sum',
          bottomCalcFormatterParams: { precision: 3, totalValue: rootMethod.duration },
          bottomCalcFormatter: progressFormatter,
          formatter: progressFormatter,
          formatterParams: {
            thousand: false,
            precision: 3,
            totalValue: rootMethod.duration,
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
      debugOnlyFilterCache.clear();
      showDetailsFilterCache.clear();
    });

    calltreeTable.on('tableBuilt', () => {
      resolve();
      //@ts-expect-error valid
      calltreeTable.addFilter(showDetailsFilter);
    });
  });
}

function expandCollapseAll(rows: RowComponent[], expand: boolean = true) {
  const len = rows.length;
  for (let i = 0; i < len; i++) {
    const row = rows[i];
    if (row) {
      if (expand) {
        row.treeExpand();
      } else {
        row.treeCollapse();
      }

      expandCollapseAll(row.getTreeChildren(), expand);
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

const showDetailsFilter = (data: CalltreeRow) => {
  return deepFilter(
    data,
    (rowData) => {
      return rowData.originalData.duration > 0 || rowData.originalData.discontinuity;
    },
    {
      filterCache: showDetailsFilterCache,
    },
  );
};

const debugFilter = (data: CalltreeRow) => {
  return deepFilter(
    data,
    (rowData) => {
      const debugValues = [
        'USER_DEBUG',
        'DATAWEAVE_USER_DEBUG',
        'USER_DEBUG_FINER',
        'USER_DEBUG_FINEST',
        'USER_DEBUG_FINE',
        'USER_DEBUG_DEBUG',
        'USER_DEBUG_INFO',
        'USER_DEBUG_WARN',
        'USER_DEBUG_ERROR',
      ];
      return debugValues.includes(rowData.originalData.type || '');
    },
    {
      filterCache: debugOnlyFilterCache,
    },
  );
};
