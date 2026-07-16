/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ApexLog, LogEventType } from 'apex-log-parser';
import { Tabulator, type RowComponent } from 'tabulator-tables';

import { vscodeMessenger } from '../../../core/messaging/VSCodeExtensionMessenger.js';
import { formatDuration } from '../../../core/utility/Util.js';
import MinMaxEditor from '../../../tabulator/editors/MinMax.js';
import { minMaxTreeFilter } from '../../../tabulator/filters/MinMax.js';
import { progressFormatterMS } from '../../../tabulator/format/ProgressMS.js';
import { VirtualVerticalRenderer } from '../../../tabulator/renderer/VirtualVerticalRenderer.js';
import { makeSumSelfTimeAllVisible } from '../utils/BottomCalcs.js';
import { annotateGovernorCost } from '../utils/GovernorCost.js';
import { toTimeOrderTree, type TimeOrderRow } from '../utils/TimeOrderTree.js';
import { createCalltreeNameFormatter } from './CalltreeNameFormatter.js';
import {
  commonColumnDefaults,
  createGovernorColumn,
  createGovernorCostColumn,
  createGovernorPeakColumn,
  createHeapColumn,
  headerSortElement,
  registerTableModules,
  type TableCallbacks,
} from './TableShared.js';

export interface TimeOrderCallbacks extends TableCallbacks {
  showDetailsFilter: (data: TimeOrderRow) => boolean;
  onContextMenu: (e: UIEvent, row: RowComponent) => void;
}

export function createTimeOrderTable(
  container: HTMLDivElement,
  rootMethod: ApexLog,
  callbacks: TimeOrderCallbacks,
): { table: Tabulator; tableBuilt: Promise<void> } {
  registerTableModules();

  const selfTimeFilterCache = new Map<number, boolean>();
  const totalTimeFilterCache = new Map<number, boolean>();
  const namespaceFilterCache = new Map<number, boolean>();

  const excludedTypes = new Set<LogEventType>(['SOQL_EXECUTE_BEGIN', 'DML_BEGIN']);
  const governorLimits = rootMethod.governorLimits;

  const tableData = toTimeOrderTree(rootMethod.children);
  annotateGovernorCost(tableData, governorLimits);
  const nameFormatter = createCalltreeNameFormatter(excludedTypes);

  const tableRef: { current: Tabulator | undefined } = { current: undefined };
  const selfTimeBottomCalc = makeSumSelfTimeAllVisible(() => tableRef.current);

  const table = new Tabulator(container, {
    data: tableData,
    index: 'id',
    layout: 'fitColumns',
    placeholder: 'No Call Tree Available',
    height: '100%',
    maxHeight: '100%',
    //  custom property for datagrid/module/RowKeyboardNavigation
    rowKeyboardNavigation: true,
    //  custom property for module/AnchoringPolicy
    anchoringPolicy: true,
    renderVertical: VirtualVerticalRenderer,
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
    rowFormatter: callbacks.rowFormatter,
    columns: [
      {
        title: 'Name',
        field: 'text',
        frozen: true,
        minWidth: 200,
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
          const node = (cell.getData() as TimeOrderRow).originalData;
          if (node.hasValidSymbols) {
            vscodeMessenger.send<string>('openType', node.text);
          }
        },
        widthGrow: 5,
        widthShrink: 1,
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
        title: 'Caller Namespace',
        field: 'callerNamespace',
        sorter: 'string',
        width: 120,
        visible: false,
      },
      createGovernorColumn({
        title: 'DML Count',
        field: 'dmlCount.total',
        limit: governorLimits.dmlStatements.limit,
      }),
      createGovernorColumn({
        title: 'DML Count (self)',
        field: 'dmlCount.self',
        limit: governorLimits.dmlStatements.limit,
        visible: false,
      }),
      createGovernorColumn({
        title: 'SOQL Count',
        field: 'soqlCount.total',
        limit: governorLimits.soqlQueries.limit,
      }),
      createGovernorColumn({
        title: 'SOQL Count (self)',
        field: 'soqlCount.self',
        limit: governorLimits.soqlQueries.limit,
        visible: false,
      }),
      createGovernorColumn({
        title: 'SOSL Count',
        field: 'soslCount.total',
        limit: governorLimits.soslQueries.limit,
      }),
      createGovernorColumn({
        title: 'SOSL Count (self)',
        field: 'soslCount.self',
        limit: governorLimits.soslQueries.limit,
        visible: false,
      }),
      {
        title: 'Throws Count',
        field: 'thrownCount.total',
        sorter: 'number',
        cssClass: 'number-cell',
        width: 60,
        hozAlign: 'right',
        headerHozAlign: 'right',
        bottomCalc: 'sum',
      },
      createGovernorColumn({
        title: 'DML Rows',
        field: 'dmlRowCount.total',
        limit: governorLimits.dmlRows.limit,
      }),
      createGovernorColumn({
        title: 'DML Rows (self)',
        field: 'dmlRowCount.self',
        limit: governorLimits.dmlRows.limit,
        visible: false,
      }),
      createGovernorColumn({
        title: 'SOQL Rows',
        field: 'soqlRowCount.total',
        limit: governorLimits.queryRows.limit,
      }),
      createGovernorColumn({
        title: 'SOQL Rows (self)',
        field: 'soqlRowCount.self',
        limit: governorLimits.queryRows.limit,
        visible: false,
      }),
      createGovernorColumn({
        title: 'SOSL Rows',
        field: 'soslRowCount.total',
        limit: governorLimits.queryRows.limit,
      }),
      createGovernorColumn({
        title: 'SOSL Rows (self)',
        field: 'soslRowCount.self',
        limit: governorLimits.queryRows.limit,
        visible: false,
      }),
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
      createHeapColumn(governorLimits),
      createHeapColumn(governorLimits, 'heapAllocated.self', 'Heap (self)', false),
      createGovernorCostColumn(governorLimits),
      createGovernorPeakColumn(governorLimits),
    ],
  });
  tableRef.current = table;

  // Filter caches are cleared once per render via `renderStarted`. Row ids
  // produced by `toTimeOrderTree` are globally unique within a build
  // (per-build monotonic counter), so cached `deepFilter` results stay valid
  // across the cascaded `filter.filter()` passes Tabulator runs for each
  // expanded subtree — `getChildren` → `filter.filter(config.children)`
  // would otherwise fire `dataFiltered` multiple times per user action,
  // defeating the cache. If row ids ever lose their uniqueness guarantee
  // this must move back to `dataFiltered`.
  table.on('renderStarted', () => {
    totalTimeFilterCache.clear();
    selfTimeFilterCache.clear();
    namespaceFilterCache.clear();
    callbacks.onFilterCacheClear?.();
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
