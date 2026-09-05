/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ApexLog } from 'apex-log-parser';
import { Tabulator } from 'tabulator-tables';

import { logStoreFor } from '../../../core/log/LogStore.js';
import { vscodeMessenger } from '../../../core/messaging/VSCodeExtensionMessenger.js';
import { formatDuration } from '../../../core/utility/Util.js';
import { TIME_WIDTH } from '../../../tabulator/ColumnWidths.js';
import { progressFormatterMS } from '../../../tabulator/format/ProgressMS.js';
import { toAggregatedCallTree, type AggregatedRow } from '../utils/Aggregation.js';
import { makeSumSelfTimeAllVisible } from '../utils/BottomCalcs.js';
import { eventLabel, eventName } from '../utils/eventText.js';
import {
  commonColumnDefaults,
  createCountColumn,
  createGovernorMetricColumns,
  createNamespaceColumns,
  createSelfSumHeapFooters,
  createTypeColumn,
  headerSortElement,
  registerTableModules,
  virtualScrollOptions,
  type TableCallbacks,
} from './TableShared.js';

export interface AggregatedTableCallbacks extends TableCallbacks {
  showDetailsFilter?: (data: AggregatedRow) => boolean;
}

export function createAggregatedTable(
  container: HTMLDivElement,
  rootMethod: ApexLog,
  callbacks: AggregatedTableCallbacks,
): { table: Tabulator; tableBuilt: Promise<void> } {
  registerTableModules();

  let childIndent: number | undefined;

  const tableRef: { current: Tabulator | undefined } = { current: undefined };
  const selfTimeBottomCalc = makeSumSelfTimeAllVisible(() => tableRef.current);
  const heapFooters = createSelfSumHeapFooters(() => tableRef.current);

  const tableData = toAggregatedCallTree(
    rootMethod.children,
    logStoreFor(rootMethod).keyPathIds(),
    rootMethod.governorLimits,
  );

  const table = new Tabulator(container, {
    data: tableData,
    index: 'id',
    layout: 'fitColumns',
    placeholder: 'No Call Tree Available',
    height: '100%',
    maxHeight: '100%',
    rowKeyboardNavigation: true,
    ...virtualScrollOptions,
    // @ts-expect-error tabulator allows a function predicate but the types only declare Filter[]
    initialFilter: callbacks.showDetailsFilter,
    dataTree: true,
    dataTreeChildColumnCalcs: false,
    dataTreeBranchElement: '<span/>',
    tooltipDelay: 100,
    selectableRows: 1,
    headerSortElement,
    columnCalcs: 'both',
    columnDefaults: commonColumnDefaults,
    rowFormatter: callbacks.rowFormatter,
    columns: [
      {
        title: 'Name',
        field: 'text',
        // Sticky column parked: frozen layout fights the vertical virtual renderer.
        // Re-add with _syncTableWidth in VirtualVerticalRenderer.
        // frozen: true,
        minWidth: 200,
        headerSortTristate: true,
        bottomCalc: () => 'Total',
        cssClass: 'datagrid-textarea datagrid-code-text',
        formatter: (cell) => {
          const row = cell.getRow();
          // @ts-expect-error: _row is private
          const dataTree = row._row.modules.dataTree;
          const treeLevel = dataTree?.index ?? 0;
          childIndent ??= row.getTable().options.dataTreeChildIndent || 0;
          const levelIndent = treeLevel * childIndent;

          const cellElem = cell.getElement();
          cellElem.style.paddingLeft = `${levelIndent + 4}px`;
          cellElem.style.textIndent = `-${levelIndent}px`;

          const rowData = cell.getData() as AggregatedRow;
          const firstInstance = rowData.instances[0];

          const label = firstInstance ? eventLabel(firstInstance) : rowData.text;
          if (firstInstance?.hasValidSymbols) {
            const link = document.createElement('a');
            link.setAttribute('href', '#!');
            link.textContent = eventName(firstInstance);
            return link;
          }
          return document.createTextNode(label) as unknown as HTMLElement;
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
        widthShrink: 1,
      },
      ...createNamespaceColumns(),
      createTypeColumn(),
      createCountColumn({ title: 'Calls', field: 'callCount', width: 70 }),
      ...createGovernorMetricColumns(rootMethod.governorLimits, heapFooters),
      // Time columns sit at the far right of every call-tree table.
      {
        title: 'Total Time (ms)',
        field: 'totalTime',
        sorter: 'number',
        headerSortTristate: true,
        width: TIME_WIDTH,
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
        tooltip: (_event, cell) => formatDuration(cell.getValue()),
      },
      {
        title: 'Self Time (ms)',
        field: 'totalSelfTime',
        sorter: 'number',
        headerSortTristate: true,
        width: TIME_WIDTH,
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
        tooltip: (_event, cell) => formatDuration(cell.getValue()),
      },
      {
        title: 'Avg Self Time (ms)',
        field: 'avgSelfTime',
        sorter: 'number',
        headerSortTristate: true,
        width: TIME_WIDTH,
        minWidth: 120,
        hozAlign: 'right',
        headerHozAlign: 'right',
        formatter: progressFormatterMS,
        formatterParams: { precision: 2, totalValue: rootMethod.duration.total },
        tooltip: (_event, cell) => formatDuration(cell.getValue()),
      },
    ],
  });
  tableRef.current = table;

  const tableBuilt = new Promise<void>((resolve) => {
    table.on('tableBuilt', () => {
      resolve();
    });
  });

  return { table, tableBuilt };
}
