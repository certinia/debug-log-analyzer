/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ApexLog, LogEvent } from '@apexdevtools/apex-log-parser';
import { Tabulator, type Options } from 'tabulator-tables';

import { logStoreFor } from '../../../core/log/LogStore.js';
import { vscodeMessenger } from '../../../core/messaging/VSCodeExtensionMessenger.js';
import { initialisedRowRange } from '../../../tabulator/module/initialisedRows.js';
import {
  sumDurationTotalForRootEvents,
  sumTotalForRootEvents,
} from '../../analysis/services/CallStackSum.js';
import { soqlGroupHeader } from '../../soql/format/groupHeader.js';
import { toBottomUpTree, type BottomUpRow } from '../utils/Aggregation.js';
import {
  clipboardCopyOptions,
  commonColumnDefaults,
  createCountColumn,
  createGovernorMetricColumns,
  createNamespaceColumns,
  createTimeColumn,
  createTypeColumn,
  downloadOptions,
  groupingOptions,
  headerSortElement,
  registerTableModules,
  virtualScrollOptions,
  type TableCallbacks,
} from './TableShared.js';

import { createCalltreeNameFormatter } from './CalltreeNameFormatter.js';

export type BottomUpTableOptions = Partial<Options> & {
  enableClipboardAndDownload?: boolean;
  exportFileName?: string;
};

export interface BottomUpTableCallbacks extends TableCallbacks {
  showDetailsFilter?: (data: BottomUpRow) => boolean;
}

export function createBottomUpTable(
  container: HTMLDivElement,
  rootMethod: ApexLog,
  callbacks: BottomUpTableCallbacks,
  options: BottomUpTableOptions = {},
): { table: Tabulator; tableBuilt: Promise<void> } {
  registerTableModules({ grouping: true });

  const nameFormatter = createCalltreeNameFormatter();

  const totalTimeBottomCalc = (
    _values: number[],
    data: BottomUpRow[],
    _calcParams: unknown,
  ): number => sumDurationTotalForRootEvents(data.map((row) => row.instances));

  // Heap totals need the same call-stack dedup as totalTime: bottom-up buckets overlap, so a
  // naive sum double-counts nested allocations. Self sums plainly (self never overlaps).
  const heapTotalBottomCalc =
    (valueOf: (node: LogEvent) => number) =>
    (_values: number[], data: BottomUpRow[], _calcParams: unknown): number =>
      sumTotalForRootEvents(
        data.map((row) => row.instances),
        valueOf,
      );
  const heapFooters = {
    netTotal: heapTotalBottomCalc((node) => node.heapAllocated.total),
    grossTotal: heapTotalBottomCalc((node) => node.heapGross.total),
    netSelf: 'sum' as const,
    grossSelf: 'sum' as const,
  };

  const { enableClipboardAndDownload, exportFileName, ...tabulatorOptionOverrides } = options;

  const clipboardAndDownloadOptions: Partial<Options> = enableClipboardAndDownload
    ? {
        ...clipboardCopyOptions,
        clipboardCopyRowRange: initialisedRowRange,
        clipboardCopyConfig: {
          dataTree: false,
        },
        ...downloadOptions(exportFileName ?? 'analysis.csv'),
        downloadRowRange: initialisedRowRange,
      }
    : {};

  const tableData = toBottomUpTree(
    rootMethod.children,
    logStoreFor(rootMethod).keyPathIds(),
    rootMethod.governorLimits,
  );

  const tabulatorOptions = {
    data: tableData,
    index: 'id',
    layout: 'fitColumns',
    placeholder: options.placeholder ?? 'No Call Tree Available',
    height: '100%',
    maxHeight: '100%',
    rowKeyboardNavigation: true,
    ...virtualScrollOptions,
    initialFilter: callbacks.showDetailsFilter,
    dataTree: true,
    dataTreeChildColumnCalcs: false,
    dataTreeBranchElement: '<span/>',
    tooltipDelay: 100,
    selectableRows: options.selectableRows ?? 1,
    ...clipboardAndDownloadOptions,
    initialSort: [{ column: 'totalSelfTime', dir: 'desc' }],
    headerSortElement,
    columnCalcs: 'table',
    ...groupingOptions,
    groupHeader: soqlGroupHeader,
    groupToggleElement: 'header',
    columnDefaults: commonColumnDefaults,
    rowFormatter: callbacks.rowFormatter,
  } as Options;

  const table = new Tabulator(container, {
    ...tabulatorOptions,
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
          const rowData = cell.getData() as BottomUpRow;
          // Deep buckets don't populate `instances` (see Aggregation.ts);
          // `originalData` is the representative event at every depth.
          if (rowData.originalData?.hasValidSymbols) {
            vscodeMessenger.send<string>('openType', rowData.text);
          }
        },
        widthGrow: 5,
        widthShrink: 1,
      },
      ...createNamespaceColumns(),
      createTypeColumn({ visible: true }),
      createCountColumn({ title: 'Calls', field: 'callCount', width: 70 }),
      ...createGovernorMetricColumns(rootMethod, heapFooters),
      // Time columns sit at the far right of every call-tree table.
      createTimeColumn({
        title: 'Total Time (ms)',
        field: 'totalTime',
        totalValue: rootMethod.duration.total,
        bottomCalc: totalTimeBottomCalc,
      }),
      createTimeColumn({
        title: 'Self Time (ms)',
        field: 'totalSelfTime',
        totalValue: rootMethod.duration.total,
        bottomCalc: 'sum',
      }),
      createTimeColumn({
        title: 'Avg Self Time (ms)',
        field: 'avgSelfTime',
        totalValue: rootMethod.duration.total,
        visible: false,
      }),
    ],
    ...tabulatorOptionOverrides,
  });

  const tableBuilt = new Promise<void>((resolve) => {
    table.on('tableBuilt', () => {
      resolve();
    });
  });

  return { table, tableBuilt };
}
