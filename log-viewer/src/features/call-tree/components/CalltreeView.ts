/*
 * Copyright (c) 2022 Certinia Inc. All rights reserved.
 */
import {
  provideVSCodeDesignSystem,
  vsCodeCheckbox,
  vsCodeDropdown,
  vsCodeOption,
} from '@vscode/webview-ui-toolkit';
import { css, html, LitElement, unsafeCSS, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { Tabulator, type RowComponent } from 'tabulator-tables';
import * as CommonModules from '../../../tabulator/module/CommonModules.js';

import MinMaxEditor from '../../../tabulator/editors/MinMax.js';
import MinMaxFilter from '../../../tabulator/filters/MinMax.js';
import { progressFormatter } from '../../../tabulator/format/Progress.js';
import { progressFormatterMS } from '../../../tabulator/format/ProgressMS.js';

import '../../../components/GridSkeleton.js';
import type { ApexLog, LogEvent } from '../../../core/log-parser/LogEvents.js';
import type { LogEventType } from '../../../core/log-parser/types.js';
import { vscodeMessenger } from '../../../core/messaging/VSCodeExtensionMessenger.js';
import formatDuration, { isVisible } from '../../../core/utility/Util.js';
import { globalStyles } from '../../../styles/global.styles.js';
import { RowKeyboardNavigation } from '../../../tabulator/module/RowKeyboardNavigation.js';
import { RowNavigation } from '../../../tabulator/module/RowNavigation.js';
import dataGridStyles from '../../../tabulator/style/DataGrid.scss';
import { Find, formatter } from '../services/Find.js';
import { MiddleRowFocus } from '../services/MiddleRowFocus.js';

provideVSCodeDesignSystem().register(vsCodeCheckbox(), vsCodeDropdown(), vsCodeOption());

@customElement('call-tree-view')
export class CalltreeView extends LitElement {
  @property()
  timelineRoot: ApexLog | null = null;

  @state()
  isVisible = false;

  filterState: { showDetails: boolean; debugOnly: boolean; selectedTypes: string[] } = {
    showDetails: false,
    debugOnly: false,
    selectedTypes: [],
  };
  debugOnlyFilterCache = new Map<string, boolean>();
  showDetailsFilterCache = new Map<string, boolean>();
  typeFilterCache = new Map<string, boolean>();

  findMap: { [key: number]: RowComponent } = {};
  totalMatches = 0;

  blockClearHighlights = true;
  searchString = '';
  findArgs: { text: string; count: number; options: { matchCase: boolean } } = {
    text: '',
    count: 0,
    options: { matchCase: false },
  };

  calltreeTable: Tabulator | null = null;
  tableContainer: HTMLDivElement | null = null;
  rootMethod: ApexLog | null = null;

  get _callTreeTableWrapper(): HTMLDivElement | null {
    return (this.tableContainer = this.renderRoot?.querySelector('#call-tree-table') ?? null);
  }

  constructor() {
    super();

    document.addEventListener('calltree-go-to-row', ((e: CustomEvent) => {
      this._goToRow(e.detail.timestamp);
    }) as EventListener);

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
      }

      #call-tree-table-container {
        height: 100%;
        width: 100%;
        min-height: 0;
        min-width: 0;
      }

      #call-tree-table {
        display: inline-block;
        height: 100%;
        width: 100%;
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
                    ${this.isVisible
                      ? repeat(
                          this._getAllTypes(this.timelineRoot?.children ?? []),
                          (type, _index) => html`<vscode-option>${type}</vscode-option>`,
                        )
                      : ''}
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

  _findEvt = ((event: FindEvt) => {
    this._find(event);
  }) as EventListener;

  _getAllTypes(data: LogEvent[]): string[] {
    const flattened = this._flatten(data);
    const types = new Set<string>();
    for (const line of flattened) {
      types.add(line.type?.toString() ?? '');
    }
    return Array.from(types).sort();
  }

  _flat(arr: LogEvent[], target: LogEvent[]) {
    arr.forEach((el) => {
      target.push(el);
      if (el.children.length > 0) {
        this._flat(el.children, target);
      }
    });
  }

  _flatten(arr: LogEvent[]) {
    const flattened: LogEvent[] = [];
    this._flat(arr, flattened);
    return flattened;
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
    if (!this.calltreeTable) {
      return;
    }
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

    this.calltreeTable.blockRedraw();
    this.calltreeTable.clearFilter(false);
    filtersToAdd.forEach((filter) => {
      // @ts-expect-error valid
      this.calltreeTable.addFilter(filter);
    });
    this.calltreeTable.restoreRedraw();
  }

  _expandButtonClick() {
    if (!this.calltreeTable?.modules?.dataTree) {
      return;
    }
    this.calltreeTable.blockRedraw();
    this._expandCollapseAll(this.calltreeTable.getRows(), true);
    this.calltreeTable.element?.querySelector<HTMLElement>('.tabulator-tableholder')?.focus();
    this.calltreeTable.restoreRedraw();
  }

  _collapseButtonClick() {
    if (!this.calltreeTable?.modules?.dataTree) {
      return;
    }
    this.calltreeTable.blockRedraw();
    this._expandCollapseAll(this.calltreeTable.getRows(), false);
    this.calltreeTable.element?.querySelector<HTMLElement>('.tabulator-tableholder')?.focus();
    this.calltreeTable.restoreRedraw();
  }

  _appendTableWhenVisible() {
    if (this.calltreeTable) {
      return;
    }

    this.rootMethod = this.timelineRoot;
    isVisible(this).then((isVisible) => {
      this.isVisible = isVisible;
      if (this.rootMethod && this._callTreeTableWrapper) {
        this._renderCallTree(this._callTreeTableWrapper, this.rootMethod);
      }
    });
  }

  async _goToRow(timestamp: number) {
    if (!this._callTreeTableWrapper || !this.rootMethod) {
      return;
    }
    document.dispatchEvent(new CustomEvent('show-tab', { detail: { tabid: 'tree-tab' } }));
    await this._renderCallTree(this._callTreeTableWrapper, this.rootMethod);
    if (!this.calltreeTable) {
      return;
    }

    const treeRow = this._findByTime(this.calltreeTable.getRows(), timestamp);
    //@ts-expect-error This is a custom function added in by RowNavigation custom module
    this.calltreeTable.goToRow(treeRow, { scrollIfVisible: true, focusRow: true });
  }

  async _find(e: CustomEvent<{ text: string; count: number; options: { matchCase: boolean } }>) {
    const isTableVisible = !!this.calltreeTable?.element?.clientHeight;
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
      //@ts-expect-error This is a custom function added in by Find custom module
      const result = await this.calltreeTable.find(this.findArgs);
      this.blockClearHighlights = false;
      this.totalMatches = result.totalMatches;
      this.findMap = result.matchIndexes;

      if (!clearHighlights) {
        document.dispatchEvent(
          new CustomEvent('lv-find-results', { detail: { totalMatches: result.totalMatches } }),
        );
      }
    }

    // Highlight the current row and reset the previous or next depending on whether we are stepping forward or back.
    if (this.totalMatches <= 0) {
      return;
    }
    this.blockClearHighlights = true;
    this.calltreeTable?.blockRedraw();
    const currentRow = this.findMap[this.findArgs.count];
    const rows = [
      currentRow,
      this.findMap[this.findArgs.count + 1],
      this.findMap[this.findArgs.count - 1],
    ];
    rows.forEach((row) => {
      row?.reformat();
    });

    if (currentRow) {
      //@ts-expect-error This is a custom function added in by RowNavigation custom module
      this.calltreeTable.goToRow(currentRow, { scrollIfVisible: false, focusRow: false });
    }
    this.calltreeTable?.restoreRedraw();
    this.blockClearHighlights = false;
  }

  _highlight(inputString: string, substring: string) {
    const regex = new RegExp(substring, 'gi');
    const resultString = inputString.replace(
      regex,
      '<span style="background-color:yellow;border:1px solid lightgrey">$&</span>',
    );
    return resultString;
  }

  _showDetailsFilter = (data: CalltreeRow) => {
    const excludedTypes = new Set<string>([
      'CUMULATIVE_LIMIT_USAGE',
      'LIMIT_USAGE_FOR_NS',
      'CUMULATIVE_PROFILING',
      'CUMULATIVE_PROFILING_BEGIN',
    ]);

    return this._deepFilter(
      data,
      (rowData) => {
        const logLine = rowData.originalData;
        return (
          logLine.duration.total > 0 ||
          logLine.exitTypes.length > 0 ||
          logLine.discontinuity ||
          !!(logLine.type && excludedTypes.has(logLine.type))
        );
      },
      {
        filterCache: this.showDetailsFilterCache,
      },
    );
  };

  _debugFilter = (data: CalltreeRow) => {
    const debugValues = new Set<string>([
      'USER_DEBUG',
      'DATAWEAVE_USER_DEBUG',
      'USER_DEBUG_FINER',
      'USER_DEBUG_FINEST',
      'USER_DEBUG_FINE',
      'USER_DEBUG_DEBUG',
      'USER_DEBUG_INFO',
      'USER_DEBUG_WARN',
      'USER_DEBUG_ERROR',
    ]);
    return this._deepFilter(
      data,
      (rowData) => {
        return !!(rowData.originalData.type && debugValues.has(rowData.originalData.type));
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
    filterParams: { columnName: string; filterCache: Map<string, boolean> },
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
    filterParams: { filterCache: Map<string, boolean> },
  ): boolean {
    const cachedMatch = filterParams.filterCache.get(rowData.id);
    if (cachedMatch !== null && cachedMatch !== undefined) {
      return cachedMatch;
    }

    let childMatch = false;
    const children = rowData._children || [];
    let len = children.length;
    while (--len >= 0) {
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
    if (this.calltreeTable) {
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

      const excludedTypes = new Set<LogEventType>(['SOQL_EXECUTE_BEGIN', 'DML_BEGIN']);
      const governorLimits = rootMethod.governorLimits;

      let childIndent;
      this.calltreeTable = new Tabulator(callTreeTableContainer, {
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
        dataTreeChildColumnCalcs: true, // todo: fix
        dataTreeBranchElement: '<span/>',
        tooltipDelay: 100,
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
          formatter(row, this.findArgs);
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
              const dataTree = row._row.modules.dataTree;
              const treeLevel = dataTree?.index ?? 0;
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

              if (node.type && !excludedTypes.has(node.type) && node.type !== text) {
                text = node.type + ': ' + text;
              }

              const textSpan = document.createElement('span');
              textSpan.textContent = text;
              return textSpan;
            },
            variableHeight: true,
            cellClick: (e, cell) => {
              const { type } = window.getSelection() ?? {};
              if (type === 'Range') {
                return;
              }

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
            width: 100,
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
            field: 'dmlCount.total',
            sorter: 'number',
            cssClass: 'number-cell',
            width: 60,
            bottomCalc: 'max',
            bottomCalcFormatter: progressFormatter,
            bottomCalcFormatterParams: {
              precision: 0,
              totalValue: governorLimits.dmlStatements.limit,
              showPercentageText: false,
            },
            formatter: progressFormatter,
            formatterParams: {
              precision: 0,
              totalValue: governorLimits.dmlStatements.limit,
              showPercentageText: false,
            },
            hozAlign: 'right',
            headerHozAlign: 'right',
            tooltip(_event, cell, _onRender) {
              const maxDmlStatements = governorLimits.dmlStatements.limit;
              return cell.getValue() + (maxDmlStatements > 0 ? '/' + maxDmlStatements : '');
            },
          },
          {
            title: 'SOQL Count',
            field: 'soqlCount.total',
            sorter: 'number',
            cssClass: 'number-cell',
            width: 60,
            bottomCalc: 'max',
            bottomCalcFormatter: progressFormatter,
            bottomCalcFormatterParams: {
              precision: 0,
              totalValue: governorLimits.soqlQueries.limit,
              showPercentageText: false,
            },
            formatter: progressFormatter,
            formatterParams: {
              precision: 0,
              totalValue: governorLimits.soqlQueries.limit,
              showPercentageText: false,
            },
            hozAlign: 'right',
            headerHozAlign: 'right',
            tooltip(_event, cell, _onRender) {
              const maxSoql = governorLimits.soqlQueries.limit;
              return cell.getValue() + (maxSoql > 0 ? '/' + maxSoql : '');
            },
          },
          {
            title: 'Throws Count',
            field: 'totalThrownCount',
            sorter: 'number',
            cssClass: 'number-cell',
            width: 60,
            hozAlign: 'right',
            headerHozAlign: 'right',
            bottomCalc: 'max',
          },
          {
            title: 'DML Rows',
            field: 'dmlRowCount.total',
            sorter: 'number',
            cssClass: 'number-cell',
            width: 60,
            bottomCalc: 'max',
            bottomCalcFormatter: progressFormatter,
            bottomCalcFormatterParams: {
              precision: 0,
              totalValue: governorLimits.dmlRows.limit,
              showPercentageText: false,
            },
            formatter: progressFormatter,
            formatterParams: {
              precision: 0,
              totalValue: governorLimits.dmlRows.limit,
              showPercentageText: false,
            },
            hozAlign: 'right',
            headerHozAlign: 'right',
            tooltip(_event, cell, _onRender) {
              const maxDmlRows = governorLimits.dmlRows.limit;
              return cell.getValue() + (maxDmlRows > 0 ? '/' + maxDmlRows : '');
            },
          },
          {
            title: 'SOQL Rows',
            field: 'soqlRowCount.total',
            sorter: 'number',
            cssClass: 'number-cell',
            width: 60,
            bottomCalc: 'max',
            bottomCalcFormatter: progressFormatter,
            bottomCalcFormatterParams: {
              precision: 0,
              totalValue: governorLimits.queryRows.limit,
              showPercentageText: false,
            },
            formatter: progressFormatter,
            formatterParams: {
              precision: 0,
              totalValue: governorLimits.queryRows.limit,
              showPercentageText: false,
            },
            hozAlign: 'right',
            headerHozAlign: 'right',
            tooltip(_event, cell, _onRender) {
              const maxQueryRows = governorLimits.queryRows.limit;
              return cell.getValue() + (maxQueryRows > 0 ? '/' + maxQueryRows : '');
            },
          },
          {
            title: 'Total Time (ms)',
            field: 'duration.total',
            sorter: 'number',
            headerSortTristate: true,
            width: 150,
            hozAlign: 'right',
            headerHozAlign: 'right',
            formatter: progressFormatterMS,
            formatterParams: {
              precision: 3,
              totalValue: rootMethod.duration.total,
            },
            bottomCalcFormatter: progressFormatterMS,
            bottomCalc: 'max',
            bottomCalcFormatterParams: { precision: 3, totalValue: rootMethod.duration.total },
            headerFilter: MinMaxEditor,
            headerFilterFunc: MinMaxFilter,
            headerFilterFuncParams: { columnName: 'duration', filterCache: totalTimeFilterCache },
            headerFilterLiveFilter: false,
            tooltip(_event, cell, _onRender) {
              return formatDuration(cell.getValue(), rootMethod.duration.total);
            },
          },
          {
            title: 'Self Time (ms)',
            field: 'duration.self',
            sorter: 'number',
            headerSortTristate: true,
            width: 150,
            hozAlign: 'right',
            headerHozAlign: 'right',
            bottomCalc: 'sum',
            bottomCalcFormatterParams: { precision: 3, totalValue: rootMethod.duration.total },
            bottomCalcFormatter: progressFormatterMS,
            formatter: progressFormatterMS,
            formatterParams: {
              precision: 3,
              totalValue: rootMethod.duration.total,
            },
            headerFilter: MinMaxEditor,
            headerFilterFunc: MinMaxFilter,
            headerFilterFuncParams: {
              columnName: 'duration.self',
              filterCache: selfTimeFilterCache,
            },
            headerFilterLiveFilter: false,
            tooltip(_event, cell, _onRender) {
              return formatDuration(cell.getValue(), rootMethod.duration.total);
            },
          },
        ],
      });

      this.calltreeTable.on('dataFiltered', () => {
        totalTimeFilterCache.clear();
        selfTimeFilterCache.clear();
        namespaceFilterCache.clear();
        this.debugOnlyFilterCache.clear();
        this.showDetailsFilterCache.clear();
        this.typeFilterCache.clear();
      });

      this.calltreeTable.on('renderStarted', () => {
        if (!this.blockClearHighlights && this.totalMatches > 0) {
          this._resetFindWidget();
          this._clearSearchHighlights();
        }
      });

      this.calltreeTable.on('tableBuilt', () => {
        resolve();
      });
    });
  }

  private _resetFindWidget() {
    document.dispatchEvent(new CustomEvent('lv-find-results', { detail: { totalMatches: 0 } }));
  }

  private _clearSearchHighlights() {
    this.findArgs.text = '';
    this.findArgs.count = 0;
    //@ts-expect-error This is a custom function added in by Find custom module
    this.calltreeTable.clearFindHighlights(Object.values(this.findMap));
    this.findMap = {};
    this.totalMatches = 0;
  }

  private _expandCollapseAll(rows: RowComponent[], expand: boolean = true) {
    const len = rows.length;
    for (let i = 0; i < len; ++i) {
      const row = rows[i];
      if (!row) {
        continue;
      }

      if (expand) {
        row.treeExpand();
      } else {
        row.treeCollapse();
      }
      this._expandCollapseAll(row.getTreeChildren() ?? [], expand);
    }
  }

  private _toCallTree(nodes: LogEvent[]): CalltreeRow[] | undefined {
    const len = nodes.length;
    if (!len) {
      return undefined;
    }

    const results: CalltreeRow[] = [];
    for (let i = 0; i < len; ++i) {
      const node = nodes[i];
      if (!node) {
        continue;
      }
      const children = node.children.length ? this._toCallTree(node.children) : null;
      results.push({
        id: node.timestamp + '-' + i,
        originalData: node,
        _children: children,
        text: node.text,
        namespace: node.namespace,
        duration: node.duration,
        dmlCount: node.dmlCount,
        soqlCount: node.soqlCount,
        dmlRowCount: node.dmlRowCount,
        soqlRowCount: node.soqlRowCount,
        totalThrownCount: node.totalThrownCount,
      });
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
      const node = (row.getData() as CalltreeRow).originalData as LogEvent;

      // Return True if the element is present in the middle.
      const endTime = node.exitStamp ?? node.timestamp;
      const isInRange = timeStamp >= node.timestamp && timeStamp <= endTime;
      if (timeStamp === node.timestamp) {
        return row;
      } else if (isInRange) {
        return this._findByTime(row.getTreeChildren() ?? [], timeStamp);
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
  id: string;
  originalData: LogEvent;
  _children: CalltreeRow[] | undefined | null;
  text: string;
  duration: CountTotals;
  namespace: string;
  dmlCount: CountTotals;
  soqlCount: CountTotals;
  dmlRowCount: CountTotals;
  soqlRowCount: CountTotals;
  totalThrownCount: number;
}

type CountTotals = { self: number; total: number };

export async function goToRow(timestamp: number) {
  document.dispatchEvent(
    new CustomEvent('calltree-go-to-row', { detail: { timestamp: timestamp } }),
  );
}

type VSCodeApexSymbol = {
  typeName: string;
  text: string;
};

type FindEvt = CustomEvent<{ text: string; count: number; options: { matchCase: boolean } }>;
