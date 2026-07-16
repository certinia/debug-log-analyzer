/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ApexLog, LogEventType } from 'apex-log-parser';
import { Tabulator, type Options } from 'tabulator-tables';

import { vscodeMessenger } from '../../../core/messaging/VSCodeExtensionMessenger.js';
import { formatDuration } from '../../../core/utility/Util.js';
import MinMaxEditor from '../../../tabulator/editors/MinMax.js';
import MinMaxFilter from '../../../tabulator/filters/MinMax.js';
import { progressFormatterMS } from '../../../tabulator/format/ProgressMS.js';
import { GroupCalcs } from '../../../tabulator/groups/GroupCalcs.js';
import { GroupChildIndent } from '../../../tabulator/groups/GroupChildIndent.js';
import { GroupSort } from '../../../tabulator/groups/GroupSort.js';
import { VirtualVerticalRenderer } from '../../../tabulator/renderer/VirtualVerticalRenderer.js';
import { sumDurationTotalForRootEvents } from '../../analysis/services/CallStackSum.js';
import { soqlGroupHeader } from '../../soql/format/groupHeader.js';
import { toBottomUpTree, type BottomUpRow } from '../utils/Aggregation.js';
import { annotateGovernorCost } from '../utils/GovernorCost.js';
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

import { createCalltreeNameFormatter } from './CalltreeNameFormatter.js';

export type BottomUpTableOptions = Partial<Options> & {
  enableClipboardAndDownload?: boolean;
  exportFileName?: string;
};

export interface BottomUpTableCallbacks extends TableCallbacks {
  showDetailsFilter?: (data: BottomUpRow) => boolean;
}

type VSCodeSaveFile = {
  fileContent: string;
  options: { defaultFileName: string };
};

function createDownloadEncoder(defaultFileName: string) {
  return function (fileContents: string, mimeType: string) {
    const vscodeHost = vscodeMessenger.getVsCodeAPI();
    if (vscodeHost) {
      vscodeMessenger.send<VSCodeSaveFile>('saveFile', {
        fileContent: fileContents,
        options: { defaultFileName },
      });
      return false;
    }
    return new Blob([fileContents], { type: mimeType });
  };
}

export function createBottomUpTable(
  container: HTMLDivElement,
  rootMethod: ApexLog,
  callbacks: BottomUpTableCallbacks,
  options: BottomUpTableOptions = {},
): { table: Tabulator; tableBuilt: Promise<void> } {
  registerTableModules();
  Tabulator.registerModule([GroupCalcs, GroupChildIndent, GroupSort]);

  const excludedTypes = new Set<LogEventType>(['SOQL_EXECUTE_BEGIN', 'DML_BEGIN']);
  const nameFormatter = createCalltreeNameFormatter(excludedTypes);

  const totalTimeBottomCalc = (
    _values: number[],
    data: BottomUpRow[],
    _calcParams: unknown,
  ): number => sumDurationTotalForRootEvents(data.map((row) => row.instances));

  const { enableClipboardAndDownload, exportFileName, ...tabulatorOptionOverrides } = options;

  // @ts-expect-error tabulator typings are behind runtime support for keybindings
  const clipboardAndDownloadOptions: Partial<Options> = enableClipboardAndDownload
    ? {
        clipboard: true,
        clipboardCopyConfig: {
          dataTree: false,
        },
        downloadEncoder: createDownloadEncoder(exportFileName ?? 'analysis.csv'),
        downloadRowRange: 'all',
        downloadConfig: {
          columnHeaders: true,
          columnGroups: true,
          rowGroups: true,
          columnCalcs: false,
          dataTree: true,
        },
        clipboardCopyRowRange: 'all',
        keybindings: { copyToClipboard: ['ctrl + 67', 'meta + 67'] },
      }
    : {};

  const tableData = toBottomUpTree(rootMethod.children);
  annotateGovernorCost(tableData, rootMethod.governorLimits);

  const tabulatorOptions = {
    data: tableData,
    index: 'id',
    layout: 'fitColumns',
    placeholder: options.placeholder ?? 'No Call Tree Available',
    height: '100%',
    maxHeight: '100%',
    rowKeyboardNavigation: true,
    anchoringPolicy: true,
    initialFilter: callbacks.showDetailsFilter,
    renderVertical: VirtualVerticalRenderer,
    dataTree: true,
    dataTreeChildColumnCalcs: false,
    dataTreeBranchElement: '<span/>',
    tooltipDelay: 100,
    selectableRows: options.selectableRows ?? 1,
    ...clipboardAndDownloadOptions,
    initialSort: [{ column: 'totalSelfTime', dir: 'desc' }],
    headerSortElement,
    columnCalcs: 'table',
    groupCalcs: true,
    groupHeader: soqlGroupHeader,
    groupSort: true,
    groupClosedShowCalcs: true,
    groupStartOpen: false,
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
      {
        title: 'Namespace',
        field: 'namespace',
        sorter: 'string',
        width: 100,
        minWidth: 80,
        headerFilter: 'list',
        headerFilterFunc: 'in',
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
      {
        title: 'Type',
        field: 'type',
        headerSortStartingDir: 'asc',
        width: 150,
        sorter: 'string',
        tooltip: true,
      },
      {
        title: 'Count',
        field: 'callCount',
        sorter: 'number',
        cssClass: 'number-cell',
        width: 65,
        minWidth: 60,
        hozAlign: 'right',
        headerHozAlign: 'right',
        bottomCalc: 'sum',
      },
      createGovernorColumn({
        title: 'DML Count',
        field: 'dmlCount.total',
        limit: rootMethod.governorLimits.dmlStatements.limit,
      }),
      createGovernorColumn({
        title: 'DML Count (self)',
        field: 'dmlCount.self',
        limit: rootMethod.governorLimits.dmlStatements.limit,
        visible: false,
      }),
      createGovernorColumn({
        title: 'SOQL Count',
        field: 'soqlCount.total',
        limit: rootMethod.governorLimits.soqlQueries.limit,
      }),
      createGovernorColumn({
        title: 'SOQL Count (self)',
        field: 'soqlCount.self',
        limit: rootMethod.governorLimits.soqlQueries.limit,
        visible: false,
      }),
      createGovernorColumn({
        title: 'SOSL Count',
        field: 'soslCount.total',
        limit: rootMethod.governorLimits.soslQueries.limit,
      }),
      createGovernorColumn({
        title: 'SOSL Count (self)',
        field: 'soslCount.self',
        limit: rootMethod.governorLimits.soslQueries.limit,
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
        limit: rootMethod.governorLimits.dmlRows.limit,
      }),
      createGovernorColumn({
        title: 'DML Rows (self)',
        field: 'dmlRowCount.self',
        limit: rootMethod.governorLimits.dmlRows.limit,
        visible: false,
      }),
      createGovernorColumn({
        title: 'SOQL Rows',
        field: 'soqlRowCount.total',
        limit: rootMethod.governorLimits.queryRows.limit,
      }),
      createGovernorColumn({
        title: 'SOQL Rows (self)',
        field: 'soqlRowCount.self',
        limit: rootMethod.governorLimits.queryRows.limit,
        visible: false,
      }),
      createGovernorColumn({
        title: 'SOSL Rows',
        field: 'soslRowCount.total',
        limit: rootMethod.governorLimits.queryRows.limit,
      }),
      createGovernorColumn({
        title: 'SOSL Rows (self)',
        field: 'soslRowCount.self',
        limit: rootMethod.governorLimits.queryRows.limit,
        visible: false,
      }),
      {
        title: 'Total Time (ms)',
        field: 'totalTime',
        sorter: 'number',
        headerSortTristate: true,
        width: 165,
        minWidth: 120,
        hozAlign: 'right',
        headerHozAlign: 'right',
        formatter: progressFormatterMS,
        formatterParams: {
          precision: 2,
          totalValue: rootMethod.duration.total,
        },
        bottomCalcFormatter: progressFormatterMS,
        bottomCalc: totalTimeBottomCalc,
        bottomCalcFormatterParams: { precision: 2, totalValue: rootMethod.duration.total },
        headerFilter: MinMaxEditor,
        headerFilterFunc: MinMaxFilter,
        headerFilterLiveFilter: false,
        tooltip: (_event, cell) => formatDuration(cell.getValue()),
      },
      {
        title: 'Self Time (ms)',
        field: 'totalSelfTime',
        sorter: 'number',
        headerSortTristate: true,
        width: 165,
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
        headerFilterFunc: MinMaxFilter,
        headerFilterLiveFilter: false,
        tooltip: (_event, cell) => formatDuration(cell.getValue()),
      },
      {
        title: 'Avg Self Time (ms)',
        field: 'avgSelfTime',
        sorter: 'number',
        headerSortTristate: true,
        width: 165,
        minWidth: 120,
        hozAlign: 'right',
        headerHozAlign: 'right',
        visible: false,
        formatter: progressFormatterMS,
        formatterParams: { precision: 2, totalValue: rootMethod.duration.total },
        tooltip: (_event, cell) => formatDuration(cell.getValue()),
      },
      createHeapColumn(rootMethod.governorLimits),
      createHeapColumn(rootMethod.governorLimits, 'heapAllocated.self', 'Heap (self)', false),
      createGovernorCostColumn(rootMethod.governorLimits),
      createGovernorPeakColumn(rootMethod.governorLimits),
    ],
    ...tabulatorOptionOverrides,
  });

  // Filter caches are cleared once per render via `renderStarted`. Row ids
  // produced by `toBottomUpTree` are globally unique within a build
  // (per-build monotonic counter), so cached `deepFilter` results stay valid
  // across the cascaded `filter.filter()` passes Tabulator runs for each
  // expanded subtree — `getChildren` → `filter.filter(config.children)`
  // would otherwise fire `dataFiltered` multiple times per user action,
  // defeating the cache. If row ids ever lose their uniqueness guarantee
  // this must move back to `dataFiltered`.
  table.on('renderStarted', () => {
    callbacks.onFilterCacheClear?.();
    callbacks.onRenderStarted();
  });

  const tableBuilt = new Promise<void>((resolve) => {
    table.on('tableBuilt', () => {
      resolve();
    });
  });

  return { table, tableBuilt };
}
