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
import {
  provideVSCodeDesignSystem,
  vsCodeCheckbox,
  vsCodeDropdown,
  vsCodeOption,
} from '@vscode/webview-ui-toolkit';
import { LitElement, css, html, unsafeCSS, type PropertyValues } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
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
import { Find, formatter } from './module/Find.js';
import { MiddleRowFocus } from './module/MiddleRowFocus.js';

provideVSCodeDesignSystem().register(vsCodeCheckbox(), vsCodeDropdown(), vsCodeOption());

let calltreeTable: Tabulator;
let tableContainer: HTMLDivElement | null;
let rootMethod: ApexLog | null;

@customElement('call-tree-view')
export class CalltreeView extends LitElement {
  @property()
  timelineRoot: ApexLog | null = null;

  filterState: { showDetails: boolean; debugOnly: boolean; selectedTypes: string[] } = {
    showDetails: false,
    debugOnly: false,
    selectedTypes: [],
  };
  debugOnlyFilterCache = new Map<number, boolean>();
  showDetailsFilterCache = new Map<number, boolean>();
  typeFilterCache = new Map<number, boolean>();

  findMap: { [key: number]: RowComponent } = {};

  get _callTreeTableWrapper(): HTMLDivElement | null {
    return (tableContainer = this.renderRoot?.querySelector('#call-tree-table') ?? null);
  }

  constructor() {
    super();

    document.addEventListener('calltree-go-to-row', ((e: CustomEvent) => {
      this._goToRow(e.detail.timestamp);
    }) as EventListener);

    document.addEventListener('lv-find', this._find as EventListener);
    document.addEventListener('lv-find-match', this._find as EventListener);
    document.addEventListener('lv-find-close', this._find as EventListener);
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

      .header-bar {
        display: flex;
        gap: 10px;
      }

      .filter-container {
        display: flex;
        gap: 5px;
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
      }

      .dropdown-container label {
        display: block;
        color: var(--vscode-foreground);
        cursor: pointer;
        font-size: var(--vscode-font-size);
        line-height: normal;
        margin-bottom: 2px;
      }

      vscode-dropdown::part(listbox) {
        width: auto;
      }

      .align__end {
        align-items: end;
      }
    `,
  ];

  render() {
    const skeleton = !this.timelineRoot ? html`<grid-skeleton></grid-skeleton>` : '';

    return html`
      <div id="call-tree-container">
        <div>
          <div class="header-bar">
            <div class="filter-container align__end">
              <vscode-button appearance="secondary" @click="${this._expandButtonClick}"
                >Expand</vscode-button
              >
              <vscode-button appearance="secondary" @click="${this._collapseButtonClick}"
                >Collapse</vscode-button
              >
            </div>

            <div class="filter-section">
              <strong>Filter</strong>
              <div class="filter-container align__end">
                <vscode-checkbox class="align__end" @change="${this._handleShowDetailsChange}"
                  >Details</vscode-checkbox
                >

                <vscode-checkbox class="align__end" @change="${this._handleDebugOnlyChange}"
                  >Debug Only</vscode-checkbox
                >

                <div class="dropdown-container">
                  <label for="types">Type:</label>
                  <vscode-dropdown @change="${this._handleTypeFilter}">
                    <vscode-option>None</vscode-option>
                    ${repeat(
                      this._getAllTypes(this.timelineRoot?.children ?? []),
                      (type, _index) => html`<vscode-option>${type}</vscode-option>`,
                    )}
                  </vscode-dropdown>
                </div>
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

  _getAllTypes(data: LogLine[]): string[] {
    const flatten = (line: LogLine): LogLine[] => [line, ...line.children.flatMap(flatten)];
    const flattened = data.flatMap(flatten);

    return [...new Set(flattened.map((item) => item.type?.toString() ?? ''))].sort();
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

  _handleTypeFilter(event: CustomEvent<{ selectedOptions: [{ value: string }] }>) {
    this.filterState.selectedTypes = [];
    event.detail.selectedOptions.forEach((element) => {
      this.filterState.selectedTypes.push(element.value);
    });
    this._updateFiltering();
  }

  _updateFiltering() {
    const filtersToAdd = [];

    // if debug only we want to show everything and apply the debug only filter.
    // So we make sure this will be the only filter applied
    if (this.filterState.debugOnly) {
      filtersToAdd.push(this._debugFilter);
    } else {
      if (
        this.filterState.selectedTypes.length > 0 &&
        this.filterState.selectedTypes[0] !== 'None'
      ) {
        filtersToAdd.push(this._typeFilter);
      }

      if (!this.filterState.showDetails) {
        filtersToAdd.push(this._showDetailsFilter);
      }
    }

    calltreeTable.blockRedraw();
    calltreeTable.clearFilter(false);
    filtersToAdd.forEach((filter) => {
      // @ts-expect-error valid
      calltreeTable.addFilter(filter);
    });
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
    calltreeTable.goToRow(treeRow, { scrollIfVisible: true, focusRow: true });
  }

  searchString = '';
  findArgs: { text: string; count: number; options: { matchCase: boolean } } = {
    text: '',
    count: 0,
    options: { matchCase: false },
  };

  _find = (e: CustomEvent<{ text: string; count: number; options: { matchCase: boolean } }>) => {
    if (!calltreeTable?.element.clientHeight) {
      return;
    }

    const hasFindClosed = e.type === 'lv-find-close';
    const findArgs = e.detail;
    const newSearch =
      findArgs.text !== this.findArgs.text ||
      findArgs.options.matchCase !== this.findArgs.options?.matchCase;
    this.findArgs = findArgs;

    if (newSearch || hasFindClosed) {
      //@ts-expect-error This is a custom function added in by Find custom module
      const result = calltreeTable.find(findArgs);
      this.findMap = result.matchIndexes;

      if (!hasFindClosed) {
        document.dispatchEvent(
          new CustomEvent('lv-find-results', { detail: { totalMatches: result.totalMatches } }),
        );
      }
    }

    const currentRow = this.findMap[findArgs.count];
    const rows = [currentRow, this.findMap[findArgs.count + 1], this.findMap[findArgs.count - 1]];
    rows.forEach((row) => {
      row?.reformat();
    });
    //@ts-expect-error This is a custom function added in by RowNavigation custom module
    calltreeTable.goToRow(currentRow, { scrollIfVisible: false, focusRow: false });
  };

  _highlight(inputString: string, substring: string) {
    const regex = new RegExp(substring, 'gi');
    const resultString = inputString.replace(
      regex,
      '<span style="background-color:yellow;border:1px solid lightgrey">$&</span>',
    );
    return resultString;
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
    return this._deepFilter(
      data,
      (rowData) => {
        return debugValues.includes(rowData.originalData.type || '');
      },
      {
        filterCache: this.debugOnlyFilterCache,
      },
    );
  };

  _typeFilter = (data: CalltreeRow) => {
    return this._deepFilter(
      data,
      (rowData) => {
        if (!rowData.originalData.type) {
          return false;
        }

        return this.filterState.selectedTypes.includes(rowData.originalData.type);
      },
      {
        filterCache: this.typeFilterCache,
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
      return new Promise((resolve) => setTimeout(resolve));
    }

    return new Promise((resolve) => {
      Tabulator.registerModule(Object.values(CommonModules));
      Tabulator.registerModule([RowKeyboardNavigation, RowNavigation, MiddleRowFocus, Find]);

      const selfTimeFilterCache = new Map<string, boolean>();
      const totalTimeFilterCache = new Map<string, boolean>();
      const namespaceFilterCache = new Map<string, boolean>();

      let childIndent;
      calltreeTable = new Tabulator(callTreeTableContainer, {
        data: this._toCallTree(rootMethod.children),
        layout: 'fitColumns',
        placeholder: 'No Call Tree Available',
        height: '100%',
        maxHeight: '100%',
        //  custom property for datagrid/module/RowKeyboardNavigation
        rowKeyboardNavigation: true,
        //  custom property for module/MiddleRowFocus
        middleRowFocus: true,
        dataTree: true,
        dataTreeChildColumnCalcs: true,
        dataTreeBranchElement: '<span/>',
        selectableRows: 1,
        // @ts-expect-error it is possible to pass a function to intitialFilter the types need updating
        initialFilter: this._showDetailsFilter,
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
        rowFormatter: (row: RowComponent) => {
          requestAnimationFrame(() => {
            formatter(row, this.findArgs);
          });
        },
        columnCalcs: 'both',
        columnDefaults: {
          title: 'default',
          resizable: true,
          headerSortStartingDir: 'desc',
          headerTooltip: true,
          headerWordWrap: true,
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
        namespaceFilterCache.clear();
        this.debugOnlyFilterCache.clear();
        this.showDetailsFilterCache.clear();
        this.typeFilterCache.clear();
      });

      calltreeTable.on('tableBuilt', () => {
        resolve();
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
