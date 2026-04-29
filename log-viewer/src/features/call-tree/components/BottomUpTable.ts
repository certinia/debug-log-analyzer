/*
 * Copyright (c) 2024 Certinia Inc. All rights reserved.
 */
import type { ApexLog, LogEventType } from 'apex-log-parser';
import { Tabulator, type Options } from 'tabulator-tables';

import { vscodeMessenger } from '../../../core/messaging/VSCodeExtensionMessenger.js';
import { formatDuration } from '../../../core/utility/Util.js';
import MinMaxEditor from '../../../tabulator/editors/MinMax.js';
import MinMaxFilter from '../../../tabulator/filters/MinMax.js';
import { progressFormatterMS } from '../../../tabulator/format/ProgressMS.js';
import { GroupCalcs } from '../../../tabulator/groups/GroupCalcs.js';
import { GroupSort } from '../../../tabulator/groups/GroupSort.js';
import { sumDurationTotalForRootEvents } from '../../analysis/services/CallStackSum.js';
import { toBottomUpTree, type BottomUpRow } from '../utils/Aggregation.js';
import {
  commonColumnDefaults,
  headerSortElement,
  registerTableModules,
  type TableCallbacks,
} from './TableShared.js';

import { createCalltreeNameFormatter } from './CalltreeNameFormatter.js';

export type BottomUpTableOptions = Partial<Options> & {
  enableClipboardAndDownload?: boolean;
  exportFileName?: string;
};

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
  callbacks: TableCallbacks,
  options: BottomUpTableOptions = {},
): { table: Tabulator; tableBuilt: Promise<void> } {
  registerTableModules();
  Tabulator.registerModule([GroupCalcs, GroupSort]);

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

  const tabulatorOptions = {
    data: toBottomUpTree(rootMethod.children),
    layout: 'fitColumns',
    placeholder: options.placeholder ?? 'No Call Tree Available',
    height: '100%',
    maxHeight: '100%',
    rowKeyboardNavigation: true,
    middleRowFocus: true,
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
    groupSort: true,
    groupClosedShowCalcs: true,
    groupStartOpen: false,
    groupToggleElement: 'header',
    columnDefaults: commonColumnDefaults,
  } as Options;

  const table = new Tabulator(container, {
    ...tabulatorOptions,
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
          const rowData = cell.getData() as BottomUpRow;
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
        headerFilterFunc: 'in',
        headerFilterParams: {
          values: rootMethod.namespaces,
          clearable: true,
          multiselect: true,
        },
        headerFilterLiveFilter: false,
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
    ],
    ...tabulatorOptionOverrides,
  });

  table.on('dataFiltered', () => {
    callbacks.onFilterCacheClear();
  });

  table.on('renderStarted', () => {
    callbacks.onRenderStarted();
  });

  const tableBuilt = new Promise<void>((resolve) => {
    table.on('tableBuilt', () => {
      resolve();
    });
  });

  return { table, tableBuilt };
}
