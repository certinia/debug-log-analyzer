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
import { LitElement, css, html, unsafeCSS, type PropertyValues } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { Tabulator, type RowComponent } from 'tabulator-tables';
import * as CommonModules from '../../datagrid/module/CommonModules.js';

import MinMaxEditor from '../../datagrid/editors/MinMax.js';
import MinMaxFilter from '../../datagrid/filters/MinMax.js';
import { progressFormatter } from '../../datagrid/format/Progress.js';
import { RowKeyboardNavigation } from '../../datagrid/module/RowKeyboardNavigation.js';
import { RowNavigation } from '../../datagrid/module/RowNavigation.js';
import dataGridStyles from '../../datagrid/style/DataGrid.scss';
import { ApexLog, LogLine, TimedNode, type LogEventType } from '../../parsers/ApexLogParser.js';
import { vscodeMessenger } from '../../services/VSCodeExtensionMessenger.js';
import { globalStyles } from '../../styles/global.styles.js';
import '../skeleton/GridSkeleton.js';

provideVSCodeDesignSystem().register(vsCodeCheckbox());

let calltreeTable: Tabulator;
let tableContainer: HTMLDivElement | null;
let rootMethod: ApexLog | null;

@customElement('call-tree-view')
export class CalltreeView extends LitElement {
  @property()
  timelineRoot: ApexLog | null = null;

  filterState = { showDetails: false, debugOnly: false };
  debugOnlyFilterCache = new Map<number, boolean>();
  showDetailsFilterCache = new Map<number, boolean>();

  get _callTreeTableWrapper(): HTMLDivElement | null {
    return (tableContainer = this.renderRoot?.querySelector('#call-tree-table') ?? null);
  }

  constructor() {
    super();

    document.addEventListener('calltree-go-to-row', (e: Event) => {
      this._goToRow((e as CustomEvent).detail.timestamp);
    });
  }

  updated(changedProperties: PropertyValues): void {
    if (this.timelineRoot && changedProperties.has('timelineRoot')) {
      this._appendTableWhenVisible();
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
      }

      #call-tree-container {
        display: flex;
        flex-direction: column;
        height: 100%;
        width: 100%;
        min-height: 0;
        min-width: 0;
      }

      #call-tree-table-container {
        height: 100%;
        flex-grow: 1;
        min-height: 0;
      }

      #call-tree-table {
        height: 100%;
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
      calltreeTable.removeFilter(this._showDetailsFilter);
    } else if (!this.filterState.showDetails) {
      // @ts-expect-error valid
      calltreeTable.addFilter(this._showDetailsFilter);
    }

    if (this.filterState.debugOnly) {
      calltreeTable.clearFilter(false);
      // @ts-expect-error valid
      calltreeTable.addFilter(this._debugFilter);
    } else if (!this.filterState.debugOnly) {
      // @ts-expect-error valid
      calltreeTable.removeFilter(this._debugFilter);
    }

    calltreeTable.restoreRedraw();
  }
  _expandButtonClick() {
    calltreeTable.blockRedraw();
    this._expandCollapseAll(calltreeTable.getRows(), true);
    calltreeTable.restoreRedraw();
  }

  _collapseButtonClick() {
    calltreeTable.blockRedraw();
    this._expandCollapseAll(calltreeTable.getRows(), false);
    calltreeTable.restoreRedraw();
  }

  _appendTableWhenVisible() {
    const callTreeWrapper = this._callTreeTableWrapper;
    rootMethod = this.timelineRoot;
    if (callTreeWrapper && rootMethod) {
      const analysisObserver = new IntersectionObserver(
        (entries, observer) => {
          const visible = entries[0]?.isIntersecting;
          if (rootMethod && visible) {
            this._renderCallTree(callTreeWrapper, rootMethod);
            observer.disconnect();
          }
        },
        { threshold: 1 },
      );
      analysisObserver.observe(callTreeWrapper);
    }
  }

  async _goToRow(timestamp: number) {
    if (!tableContainer || !rootMethod) {
      return;
    }
    document.dispatchEvent(new CustomEvent('show-tab', { detail: { tabid: 'tree-tab' } }));
    await this._renderCallTree(tableContainer, rootMethod);

    const treeRow = this._findByTime(calltreeTable.getRows(), timestamp);
    //@ts-expect-error This is a custom function added in by RowNavigation custom module
    calltreeTable.goToRow(treeRow);
  }

  _showDetailsFilter = (data: CalltreeRow) => {
    return this._deepFilter(
      data,
      (rowData) => {
        const logLine = rowData.originalData;
        return logLine.duration.total > 0 || logLine.exitTypes.length > 0 || logLine.discontinuity;
      },
      {
        filterCache: this.showDetailsFilterCache,
      },
    );
  };

  _debugFilter = (data: CalltreeRow) => {
    return this._deepFilter(
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
        filterCache: this.debugOnlyFilterCache,
      },
    );
  };

  _namespaceFilter = (
    selectedNamespaces: string[],
    namespace: string,
    data: CalltreeRow,
    filterParams: { columnName: string; filterCache: Map<number, boolean> },
  ) => {
    if (selectedNamespaces.length === 0) {
      return true;
    }

    return this._deepFilter(
      data,
      (rowData) => {
        return selectedNamespaces.includes(rowData.originalData.namespace || '');
      },
      {
        filterCache: filterParams.filterCache,
      },
    );
  };

  private _deepFilter(
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
        const match = this._deepFilter(childRow, filterFunction, filterParams);

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

  private async _renderCallTree(
    callTreeTableContainer: HTMLDivElement,
    rootMethod: ApexLog,
  ): Promise<void> {
    if (calltreeTable) {
      // Ensure the table is fully visible before attempting to do things e.g go to rows.
      // Otherwise there are visible rendering issues.
      await new Promise((resolve, reject) => {
        const visibilityObserver = new IntersectionObserver(
          (entries, observer) => {
            const entry = entries[0];
            const visible = entry?.isIntersecting && entry?.intersectionRatio > 0;
            if (visible) {
              resolve(true);
              observer.disconnect();
            } else {
              reject();
            }
          },
          { threshold: 1 },
        );
        visibilityObserver.observe(callTreeTableContainer);
      });
      await new Promise((resolve) => window.requestAnimationFrame(resolve));
      await new Promise((resolve) => window.requestAnimationFrame(resolve));

      return Promise.resolve();
    }

    return new Promise((resolve) => {
      Tabulator.registerModule(Object.values(CommonModules));
      Tabulator.registerModule([RowKeyboardNavigation, RowNavigation]);

      const selfTimeFilterCache = new Map<string, boolean>();
      const totalTimeFilterCache = new Map<string, boolean>();
      const namespaceFilterCache = new Map<string, boolean>();

      let childIndent;
      calltreeTable = new Tabulator(callTreeTableContainer, {
        data: this._toCallTree(rootMethod.children),
        layout: 'fitColumns',
        placeholder: 'No Call Tree Available',
        columnCalcs: 'both',
        height: '100%',
        maxHeight: '100%',
        dataTree: true,
        dataTreeChildColumnCalcs: true,
        dataTreeBranchElement: '<span/>',
        selectableRows: 1,
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
                const link = document.createElement('a');
                link.setAttribute('href', '#!');
                link.textContent = text;
                return link;
              }

              const excludedTypes: LogEventType[] = ['SOQL_EXECUTE_BEGIN', 'DML_BEGIN'];
              text =
                (node.type &&
                  (!excludedTypes.includes(node.type) && node.type !== text
                    ? node.type + ': '
                    : '') + text) ||
                '';

              const textSpan = document.createElement('span');
              textSpan.textContent = text;
              return textSpan;
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

                vscodeMessenger.send<VSCodeApexSymbol>('openType', {
                  typeName: typeName,
                  text: text,
                });
              }
            },
            widthGrow: 5,
          },
          {
            title: 'Namespace',
            field: 'namespace',
            sorter: 'string',
            width: 120,
            cssClass: 'datagrid-code-text',
            headerFilter: 'list',
            headerFilterFunc: this._namespaceFilter,
            headerFilterFuncParams: { filterCache: namespaceFilterCache },
            headerFilterParams: {
              values: rootMethod.namespaces,
              clearable: true,
              multiselect: true,
            },
            headerFilterLiveFilter: false,
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
              totalValue: rootMethod.duration.total,
            },
            bottomCalcFormatter: progressFormatter,
            bottomCalc: 'max',
            bottomCalcFormatterParams: { precision: 3, totalValue: rootMethod.duration.total },
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
            bottomCalcFormatterParams: { precision: 3, totalValue: rootMethod.duration.total },
            bottomCalcFormatter: progressFormatter,
            formatter: progressFormatter,
            formatterParams: {
              thousand: false,
              precision: 3,
              totalValue: rootMethod.duration.total,
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
        this.debugOnlyFilterCache.clear();
        this.showDetailsFilterCache.clear();
        namespaceFilterCache.clear();
      });

      calltreeTable.on('tableBuilt', () => {
        const filter = this._showDetailsFilter;
        // @ts-expect-error valid
        calltreeTable.addFilter(filter);
        resolve();
      });

      let middleRow: RowComponent | null;
      calltreeTable.on('renderStarted', () => {
        if (calltreeTable && !middleRow) {
          middleRow = this._findMiddleVisibleRow(calltreeTable);
        }
      });

      calltreeTable.on('renderComplete', async () => {
        let rowToScrollTo = middleRow;

        if (rowToScrollTo) {
          //@ts-expect-error This is private to tabulator, but we have no other choice atm.
          const internalRow = rowToScrollTo._getSelf();
          const displayRows = internalRow.table.rowManager.getDisplayRows();
          const canScroll = displayRows.indexOf(internalRow) !== -1;
          if (!canScroll) {
            const node = (rowToScrollTo.getData() as CalltreeRow).originalData as TimedNode;
            rowToScrollTo = this._findClosestActive(
              calltreeTable.getRows('active'),
              node.timestamp,
            );
          }

          if (rowToScrollTo) {
            calltreeTable.scrollToRow(rowToScrollTo, 'center', true).then(() => {
              if (rowToScrollTo) {
                // row.getElement().scrollIntoView

                // NOTE: This is a workaround for the fact that `row.scrollTo('center'` does not work correctly for ros near the bottom.
                // This needs fixing in main tabulator lib
                window.requestAnimationFrame(() => {
                  // table.scrollToRow(row, 'center', true);
                  rowToScrollTo
                    ?.getElement()
                    .scrollIntoView({ behavior: 'auto', block: 'center', inline: 'start' });
                });
              }
            });
          }
        }

        middleRow = null;
      });
    });
  }

  private _expandCollapseAll(rows: RowComponent[], expand: boolean = true) {
    const len = rows.length;
    for (let i = 0; i < len; i++) {
      const row = rows[i];
      if (!row) {
        continue;
      }

      expand ? row.treeExpand() : row.treeCollapse();
      this._expandCollapseAll(row.getTreeChildren(), expand);
    }
  }

  private _toCallTree(nodes: LogLine[]): CalltreeRow[] | undefined {
    const len = nodes.length;
    if (!len) {
      return undefined;
    }

    const results: CalltreeRow[] = [];
    for (let i = 0; i < len; i++) {
      const node = nodes[i];
      if (node) {
        const isTimedNode = node instanceof TimedNode;
        const children = isTimedNode ? this._toCallTree(node.children) : null;
        const data: CalltreeRow = {
          id: node.timestamp,
          text: node.text,
          namespace: node.namespace,
          duration: node.duration.total,
          selfTime: node.duration.self,
          _children: children,
          totalDmlCount: node.dmlCount.total,
          totalSoqlCount: node.soqlCount.total,
          totalThrownCount: node.totalThrownCount,
          rows: node.rowCount.total,
          originalData: node,
        };
        results.push(data);
      }
    }
    return results;
  }

  private _findByTime(rows: RowComponent[], timeStamp: number): RowComponent | null {
    if (!rows) {
      return null;
    }

    let start = 0,
      end = rows.length - 1;

    // Iterate as long as the beginning does not encounter the end.
    while (start <= end) {
      // find out the middle index
      const mid = Math.floor((start + end) / 2);
      const row = rows[mid];

      if (!row) {
        break;
      }
      const node = (row.getData() as CalltreeRow).originalData as TimedNode;

      // Return True if the element is present in the middle.
      const endTime = node.exitStamp ?? node.timestamp;
      const isInRange = timeStamp >= node.timestamp && timeStamp <= endTime;
      if (timeStamp === node.timestamp) {
        return row;
      } else if (isInRange) {
        return this._findByTime(row.getTreeChildren(), timeStamp);
      }
      // Otherwise, look in the left or right half
      else if (timeStamp > endTime) {
        start = mid + 1;
      } else if (timeStamp < node.timestamp) {
        end = mid - 1;
      } else {
        return null;
      }
    }

    return null;
  }

  private _findClosestActive(rows: RowComponent[], timeStamp: number): RowComponent | null {
    if (!rows) {
      return null;
    }

    let start = 0,
      end = rows.length - 1;

    // Iterate as long as the beginning does not encounter the end.
    while (start <= end) {
      // find out the middle index
      const mid = Math.floor((start + end) / 2);
      const row = rows[mid];

      if (!row) {
        break;
      }
      const node = (row.getData() as CalltreeRow).originalData as TimedNode;

      //@ts-expect-error This is private to tabulator, but we have no other choice atm.
      const internalRow = row._getSelf();
      const displayRows = internalRow.table.rowManager.getDisplayRows();
      const endTime = node.exitStamp ?? node.timestamp;

      if (timeStamp === node.timestamp) {
        const isActive = displayRows.indexOf(internalRow) !== -1;
        if (isActive) {
          return row;
        }

        return this._findClosestActiveSibling(mid, rows, displayRows);
      } else if (timeStamp >= node.timestamp && timeStamp <= endTime) {
        const childMatch = this._findClosestActive(row.getTreeChildren(), timeStamp);
        if (childMatch) {
          return childMatch;
        }
        return this._findClosestActiveSibling(mid, rows, displayRows);
      }
      // Otherwise, look in the left or right half
      else if (timeStamp > endTime) {
        start = mid + 1;
      } else if (timeStamp < node.timestamp) {
        end = mid - 1;
      } else {
        return null;
      }
    }

    return null;
  }

  private _findClosestActiveSibling(
    midIndex: number,
    rows: RowComponent[],
    activeRows: RowComponent[],
  ) {
    const indexes = [];

    let previousIndex = midIndex;
    let previousVisible;
    while (previousIndex >= 0) {
      previousVisible = rows[previousIndex];
      if (!previousVisible) {
        continue;
      }
      //@ts-expect-error This is private to tabulator, but we have no other choice atm.
      const internalRow = previousVisible._getSelf();
      const isActive = activeRows.indexOf(internalRow) !== -1;
      if (previousVisible && isActive) {
        indexes.push(previousIndex);
        break;
      }

      previousIndex--;
    }

    const distanceFromMid = previousIndex > -1 ? midIndex - previousIndex : midIndex;

    const len = rows.length;
    let nextIndex = midIndex;
    let nextVisible;
    while (nextIndex >= 0 && nextIndex !== len && nextIndex - midIndex < distanceFromMid) {
      nextVisible = rows[nextIndex];
      if (!nextVisible) {
        continue;
      }

      //@ts-expect-error This is private to tabulator, but we have no other choice atm.
      const internalRow = nextVisible._getSelf();
      const isActive = activeRows.indexOf(internalRow) !== -1;
      if (nextVisible && isActive) {
        indexes.push(nextIndex);
        break;
      }
      nextIndex++;
    }

    const closestIndex = indexes.length
      ? indexes.reduce((a, b) => {
          return Math.abs(b - midIndex) < Math.abs(a - midIndex) ? b : a;
        })
      : null;

    return closestIndex ? rows[closestIndex] || null : null;
  }

  private _findMiddleVisibleRow(table: Tabulator) {
    const visibleRows = table.getRows('visible');
    if (visibleRows.length === 1) {
      return visibleRows[0] || null;
    }

    const tableRect = table.element.getBoundingClientRect();
    const totalHeight = Math.round(tableRect.height / 2);

    let currentHeight = 0;
    for (const row of visibleRows) {
      const elementRect = row.getElement().getBoundingClientRect();

      const topDiff = tableRect.top - elementRect.top;
      currentHeight += topDiff > 0 ? elementRect.height - topDiff : elementRect.height;

      const bottomDiff = elementRect.bottom - tableRect.bottom;
      currentHeight -= bottomDiff > 0 ? bottomDiff : 0;

      if (Math.round(currentHeight) >= totalHeight) {
        return row;
      }
    }
    return null;
  }
}

interface CalltreeRow {
  id: number;
  originalData: LogLine;
  text: string;
  duration: number;
  namespace: string;
  selfTime: number;
  _children: CalltreeRow[] | undefined | null;
  totalDmlCount: number;
  totalSoqlCount: number;
  totalThrownCount: number;
  rows: number;
}

export async function goToRow(timestamp: number) {
  if (!tableContainer || !rootMethod) {
    return;
  }

  document.dispatchEvent(
    new CustomEvent('calltree-go-to-row', { detail: { timestamp: timestamp } }),
  );
}

type VSCodeApexSymbol = {
  typeName: string;
  text: string;
};
