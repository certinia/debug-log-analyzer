/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ApexLog } from '@apexdevtools/apex-log-parser';
import { Tabulator, type RowComponent } from 'tabulator-tables';

import { vscodeMessenger } from '../../../core/messaging/VSCodeExtensionMessenger.js';
import { makeSumSelfTimeAllVisible } from '../utils/BottomCalcs.js';
import { toTimeOrderTree, type TimeOrderRow } from '../utils/TimeOrderTree.js';
import { createCalltreeNameFormatter } from './CalltreeNameFormatter.js';
import {
  commonColumnDefaults,
  createGovernorMetricColumns,
  createNamespaceColumns,
  createSelfSumHeapFooters,
  createTimeColumn,
  createTypeColumn,
  headerSortElement,
  registerTableModules,
  virtualScrollOptions,
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

  const governorLimits = rootMethod.governorLimits;

  const tableData = toTimeOrderTree(rootMethod.children, governorLimits);
  const nameFormatter = createCalltreeNameFormatter();

  const tableRef: { current: Tabulator | undefined } = { current: undefined };
  const selfTimeBottomCalc = makeSumSelfTimeAllVisible(() => tableRef.current);
  const heapFooters = createSelfSumHeapFooters(() => tableRef.current);

  const table = new Tabulator(container, {
    data: tableData,
    index: 'id',
    layout: 'fitColumns',
    placeholder: 'No Call Tree Available',
    height: '100%',
    maxHeight: '100%',
    //  custom property for datagrid/module/RowKeyboardNavigation
    rowKeyboardNavigation: true,
    ...virtualScrollOptions,
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
        // Sticky column parked: frozen layout fights the vertical virtual renderer.
        // Re-add with _syncTableWidth in VirtualVerticalRenderer.
        // frozen: true,
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
      ...createNamespaceColumns(),
      createTypeColumn(),
      ...createGovernorMetricColumns(rootMethod, heapFooters),
      // Time columns sit at the far right of every call-tree table.
      createTimeColumn({
        title: 'Total Time (ms)',
        field: 'duration.total',
        totalValue: rootMethod.duration.total,
        bottomCalc: 'sum',
      }),
      createTimeColumn({
        title: 'Self Time (ms)',
        field: 'duration.self',
        totalValue: rootMethod.duration.total,
        bottomCalc: selfTimeBottomCalc,
      }),
    ],
  });
  tableRef.current = table;

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
