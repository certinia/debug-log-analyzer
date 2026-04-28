/*
 * Copyright (c) 2024 Certinia Inc. All rights reserved.
 */
import type { ApexLog } from 'apex-log-parser';
import { Tabulator } from 'tabulator-tables';

import { vscodeMessenger } from '../../../core/messaging/VSCodeExtensionMessenger.js';
import { formatDuration } from '../../../core/utility/Util.js';
import MinMaxEditor from '../../../tabulator/editors/MinMax.js';
import { minMaxTreeFilter } from '../../../tabulator/filters/MinMax.js';
import { progressFormatter } from '../../../tabulator/format/Progress.js';
import { progressFormatterMS } from '../../../tabulator/format/ProgressMS.js';
import { toAggregatedCallTree, type AggregatedRow } from '../utils/Aggregation.js';
import { makeSumSelfTimeAllVisible } from '../utils/BottomCalcs.js';
import {
  commonColumnDefaults,
  headerSortElement,
  registerTableModules,
  type TableCallbacks,
} from './TableShared.js';

export function createAggregatedTable(
  container: HTMLDivElement,
  rootMethod: ApexLog,
  callbacks: TableCallbacks,
): Tabulator {
  registerTableModules();

  const namespaceFilterCache = new Map<string, boolean>();
  const totalTimeFilterCache = new Map<string, boolean>();
  const selfTimeFilterCache = new Map<string, boolean>();

  let childIndent: number | undefined;

  const tableRef: { current: Tabulator | undefined } = { current: undefined };
  const selfTimeBottomCalc = makeSumSelfTimeAllVisible(() => tableRef.current);

  const table = new Tabulator(container, {
    data: toAggregatedCallTree(rootMethod.children),
    layout: 'fitColumns',
    placeholder: 'No Call Tree Available',
    height: '100%',
    maxHeight: '100%',
    // @ts-expect-error custom property for module/RowKeyboardNavigation + MiddleRowFocus
    rowKeyboardNavigation: true,
    middleRowFocus: true,
    dataTree: true,
    dataTreeChildColumnCalcs: false,
    dataTreeBranchElement: '<span/>',
    tooltipDelay: 100,
    selectableRows: 1,
    headerSortElement,
    columnCalcs: 'both',
    columnDefaults: commonColumnDefaults,
    columns: [
      {
        title: 'Name',
        field: 'text',
        headerSortTristate: true,
        bottomCalc: () => 'Total',
        cssClass: 'datagrid-textarea datagrid-code-text',
        formatter: (cell) => {
          const cellElem = cell.getElement();
          const row = cell.getRow();
          // @ts-expect-error: _row is private
          const dataTree = row._row.modules.dataTree;
          const treeLevel = dataTree?.index ?? 0;
          childIndent ??= row.getTable().options.dataTreeChildIndent || 0;
          const levelIndent = treeLevel * childIndent;
          cellElem.style.paddingLeft = `${levelIndent + 4}px`;
          cellElem.style.textIndent = `-${levelIndent}px`;

          const rowData = cell.getData() as AggregatedRow;
          const elem = document.createElement('span');
          const firstInstance = rowData.instances[0];

          if (firstInstance?.hasValidSymbols) {
            const link = document.createElement('a');
            link.setAttribute('href', '#!');
            link.textContent = rowData.text;
            elem.appendChild(link);
          } else {
            const textSpan = document.createElement('span');
            textSpan.textContent = rowData.text;
            elem.appendChild(textSpan);
          }

          return elem;
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
          const rowData = cell.getData() as AggregatedRow;
          const firstInstance = rowData.instances[0];
          if (firstInstance?.hasValidSymbols) {
            vscodeMessenger.send<string>('openType', rowData.text);
          }
        },
        widthGrow: 5,
      },
      {
        title: 'Namespace',
        field: 'namespace',
        sorter: 'string',
        width: 100,
        minWidth: 80,
        headerFilter: 'list',
        headerFilterFunc: callbacks.namespaceFilter,
        headerFilterFuncParams: { filterCache: namespaceFilterCache },
        headerFilterParams: {
          values: rootMethod.namespaces,
          clearable: true,
          multiselect: true,
        },
        headerFilterLiveFilter: false,
      },
      {
        title: 'Calls',
        field: 'callCount',
        sorter: 'number',
        cssClass: 'number-cell',
        width: 70,
        minWidth: 60,
        hozAlign: 'right',
        headerHozAlign: 'right',
        bottomCalc: 'sum',
      },
      {
        title: 'DML Count',
        field: 'dmlCount.total',
        sorter: 'number',
        cssClass: 'number-cell',
        width: 70,
        minWidth: 60,
        bottomCalc: 'sum',
        bottomCalcFormatter: progressFormatter,
        bottomCalcFormatterParams: {
          precision: 0,
          totalValue: rootMethod.governorLimits.dmlStatements.limit,
          showPercentageText: false,
        },
        formatter: progressFormatter,
        formatterParams: {
          precision: 0,
          totalValue: rootMethod.governorLimits.dmlStatements.limit,
          showPercentageText: false,
        },
        hozAlign: 'right',
        headerHozAlign: 'right',
      },
      {
        title: 'SOQL Count',
        field: 'soqlCount.total',
        sorter: 'number',
        cssClass: 'number-cell',
        width: 70,
        minWidth: 60,
        bottomCalc: 'sum',
        bottomCalcFormatter: progressFormatter,
        bottomCalcFormatterParams: {
          precision: 0,
          totalValue: rootMethod.governorLimits.soqlQueries.limit,
          showPercentageText: false,
        },
        formatter: progressFormatter,
        formatterParams: {
          precision: 0,
          totalValue: rootMethod.governorLimits.soqlQueries.limit,
          showPercentageText: false,
        },
        hozAlign: 'right',
        headerHozAlign: 'right',
      },
      {
        title: 'Total Time (ms)',
        field: 'totalTime',
        sorter: 'number',
        headerSortTristate: true,
        width: 150,
        minWidth: 120,
        hozAlign: 'right',
        headerHozAlign: 'right',
        formatter: progressFormatterMS,
        formatterParams: {
          precision: 2,
          totalValue: rootMethod.duration.total,
        },
        bottomCalcFormatter: progressFormatterMS,
        bottomCalc: 'sum',
        bottomCalcFormatterParams: { precision: 2, totalValue: rootMethod.duration.total },
        headerFilter: MinMaxEditor,
        headerFilterFunc: minMaxTreeFilter,
        headerFilterFuncParams: { columnName: 'totalTime', filterCache: totalTimeFilterCache },
        headerFilterLiveFilter: false,
        tooltip: (_event, cell) => formatDuration(cell.getValue()),
      },
      {
        title: 'Self Time (ms)',
        field: 'totalSelfTime',
        sorter: 'number',
        headerSortTristate: true,
        width: 150,
        minWidth: 120,
        hozAlign: 'right',
        headerHozAlign: 'right',
        formatter: progressFormatterMS,
        formatterParams: {
          precision: 2,
          totalValue: rootMethod.duration.total,
        },
        bottomCalcFormatter: progressFormatterMS,
        bottomCalc: selfTimeBottomCalc,
        bottomCalcFormatterParams: { precision: 2, totalValue: rootMethod.duration.total },
        headerFilter: MinMaxEditor,
        headerFilterFunc: minMaxTreeFilter,
        headerFilterFuncParams: { columnName: 'totalSelfTime', filterCache: selfTimeFilterCache },
        headerFilterLiveFilter: false,
        tooltip: (_event, cell) => formatDuration(cell.getValue()),
      },
      {
        title: 'Avg Self (ms)',
        field: 'avgSelfTime',
        sorter: 'number',
        headerSortTristate: true,
        width: 110,
        minWidth: 90,
        hozAlign: 'right',
        headerHozAlign: 'right',
        formatter: progressFormatterMS,
        formatterParams: {
          precision: 2,
          totalValue: rootMethod.duration.total,
        },
        tooltip: (_event, cell) => formatDuration(cell.getValue()),
      },
    ],
  });
  tableRef.current = table;

  table.on('dataFiltered', () => {
    namespaceFilterCache.clear();
    totalTimeFilterCache.clear();
    selfTimeFilterCache.clear();
    callbacks.onFilterCacheClear();
  });

  table.on('renderStarted', () => {
    callbacks.onRenderStarted();
  });

  return table;
}
