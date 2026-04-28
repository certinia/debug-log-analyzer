/*
 * Copyright (c) 2024 Certinia Inc. All rights reserved.
 */
import type { ApexLog, LogEventType } from 'apex-log-parser';
import { Tabulator, type RowComponent } from 'tabulator-tables';

import { vscodeMessenger } from '../../../core/messaging/VSCodeExtensionMessenger.js';
import { formatDuration } from '../../../core/utility/Util.js';
import MinMaxEditor from '../../../tabulator/editors/MinMax.js';
import { minMaxTreeFilter } from '../../../tabulator/filters/MinMax.js';
import { progressFormatter } from '../../../tabulator/format/Progress.js';
import { progressFormatterMS } from '../../../tabulator/format/ProgressMS.js';
import { makeSumSelfTimeAllVisible } from '../utils/BottomCalcs.js';
import { toUnmergedCallTree, type MergedCalltreeRow } from '../utils/MergeAdjacent.js';
import { createCalltreeNameFormatter } from './CalltreeNameFormatter.js';
import {
  commonColumnDefaults,
  headerSortElement,
  registerTableModules,
  type TableCallbacks,
} from './TableShared.js';

export interface TimeOrderCallbacks extends TableCallbacks {
  showDetailsFilter: (data: MergedCalltreeRow) => boolean;
  onContextMenu: (e: UIEvent, row: RowComponent) => void;
}

export function createTimeOrderTable(
  container: HTMLDivElement,
  rootMethod: ApexLog,
  callbacks: TimeOrderCallbacks,
): { table: Tabulator; tableBuilt: Promise<void> } {
  registerTableModules();

  const selfTimeFilterCache = new Map<string, boolean>();
  const totalTimeFilterCache = new Map<string, boolean>();
  const namespaceFilterCache = new Map<string, boolean>();

  const excludedTypes = new Set<LogEventType>(['SOQL_EXECUTE_BEGIN', 'DML_BEGIN']);
  const governorLimits = rootMethod.governorLimits;

  const tableData = toUnmergedCallTree(rootMethod.children);
  const nameFormatter = createCalltreeNameFormatter(excludedTypes);

  const tableRef: { current: Tabulator | undefined } = { current: undefined };
  const selfTimeBottomCalc = makeSumSelfTimeAllVisible(() => tableRef.current);

  const table = new Tabulator(container, {
    data: tableData,
    layout: 'fitColumns',
    placeholder: 'No Call Tree Available',
    height: '100%',
    maxHeight: '100%',
    //  custom property for datagrid/module/RowKeyboardNavigation
    rowKeyboardNavigation: true,
    //  custom property for module/MiddleRowFocus
    middleRowFocus: true,
    dataTree: true,
    dataTreeChildColumnCalcs: false,
    dataTreeBranchElement: '<span/>',
    tooltipDelay: 100,
    selectableRows: 1,
    // @ts-expect-error it is possible to pass a function to intitialFilter the types need updating
    initialFilter: callbacks.showDetailsFilter,
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
        formatter: nameFormatter,
        variableHeight: true,
        cellClick: (e, cell) => {
          const { type } = window.getSelection() ?? {};
          if (type === 'Range') {
            return;
          }

          if (!(e.target as HTMLElement).matches('a')) {
            return;
          }
          const node = (cell.getData() as MergedCalltreeRow).originalData;
          if (node.hasValidSymbols) {
            vscodeMessenger.send<string>('openType', node.text);
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
        width: 70,
        minWidth: 60,
        bottomCalc: 'sum',
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
        bottomCalc: 'sum',
      },
      {
        title: 'DML Rows',
        field: 'dmlRowCount.total',
        sorter: 'number',
        cssClass: 'number-cell',
        width: 60,
        bottomCalc: 'sum',
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
        bottomCalc: 'sum',
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
          precision: 2,
          totalValue: rootMethod.duration.total,
        },
        bottomCalcFormatter: progressFormatterMS,
        bottomCalc: 'sum',
        bottomCalcFormatterParams: { precision: 2, totalValue: rootMethod.duration.total },
        headerFilter: MinMaxEditor,
        headerFilterFunc: minMaxTreeFilter,
        headerFilterFuncParams: { columnName: 'duration.total', filterCache: totalTimeFilterCache },
        headerFilterLiveFilter: false,
        tooltip(_event, cell, _onRender) {
          return formatDuration(cell.getValue());
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
        bottomCalc: selfTimeBottomCalc,
        bottomCalcFormatterParams: { precision: 2, totalValue: rootMethod.duration.total },
        bottomCalcFormatter: progressFormatterMS,
        formatter: progressFormatterMS,
        formatterParams: {
          precision: 2,
          totalValue: rootMethod.duration.total,
        },
        headerFilter: MinMaxEditor,
        headerFilterFunc: minMaxTreeFilter,
        headerFilterFuncParams: {
          columnName: 'duration.self',
          filterCache: selfTimeFilterCache,
        },
        headerFilterLiveFilter: false,
        tooltip(_event, cell, _onRender) {
          return formatDuration(cell.getValue());
        },
      },
    ],
  });
  tableRef.current = table;

  table.on('dataFiltered', () => {
    totalTimeFilterCache.clear();
    selfTimeFilterCache.clear();
    namespaceFilterCache.clear();
    callbacks.onFilterCacheClear();
  });

  table.on('dataSorted', () => {
    callbacks.onRenderStarted();
  });

  table.on('dataFiltered', () => {
    callbacks.onRenderStarted();
  });

  table.on('rowContext', (e: UIEvent, row: RowComponent) => {
    callbacks.onContextMenu(e, row);
  });

  const tableBuilt = new Promise<void>((resolve) => {
    table.on('tableBuilt', () => {
      resolve();
    });
  });

  return { table, tableBuilt };
}
