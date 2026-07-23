/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import type { GovernorLimits } from 'apex-log-parser';
import { Tabulator, type ColumnDefinition, type RowComponent } from 'tabulator-tables';

import { formatInteger } from '../../../core/utility/Util.js';
import { progressFormatter } from '../../../tabulator/format/Progress.js';
import { AnchoringPolicy } from '../../../tabulator/module/AnchoringPolicy.js';
import * as CommonModules from '../../../tabulator/module/CommonModules.js';
import { Find } from '../../../tabulator/module/Find.js';
import { RowKeyboardNavigation } from '../../../tabulator/module/RowKeyboardNavigation.js';
import { RowNavigation } from '../../../tabulator/module/RowNavigation.js';
import type { AggregatedRow, BottomUpRow } from '../utils/Aggregation.js';
import { governorCostBreakdown, type GovernorCostRow } from '../utils/GovernorCost.js';
import type { TimeOrderRow } from '../utils/TimeOrderTree.js';

export interface TableCallbacks {
  namespaceFilter: (
    selectedNamespaces: string[],
    namespace: string,
    data: TimeOrderRow | AggregatedRow | BottomUpRow,
    filterParams: { filterCache: Map<number, boolean> },
  ) => boolean;
  onFilterCacheClear?: () => void;
  onRenderStarted: () => void;
  rowFormatter?: (row: RowComponent) => void;
}

export function registerTableModules(): void {
  Tabulator.registerModule(Object.values(CommonModules));
  Tabulator.registerModule([RowKeyboardNavigation, RowNavigation, AnchoringPolicy, Find]);
}

export function headerSortElement(_column: unknown, dir: string): string {
  switch (dir) {
    case 'asc':
      return "<div class='sort-by--top'></div>";
    case 'desc':
      return "<div class='sort-by--bottom'></div>";
    default:
      return "<div class='sort-by'><div class='sort-by--top'></div><div class='sort-by--bottom'></div></div>";
  }
}

export const commonColumnDefaults = {
  title: 'default',
  resizable: true,
  headerSortStartingDir: 'desc' as const,
  headerTooltip: true,
  headerWordWrap: true,
  // Name-only flex: every column keeps its content width by default (no
  // stretch, no squeeze). The Name column overrides these to absorb slack.
  widthGrow: 0,
  widthShrink: 0,
};

/**
 * The shared "Gov. Avg (%)" column — the average governor consumption across all
 * governors on a call path (see {@link governorCost}), rendered as a progress
 * bar. Reused across all call-tree/analysis tables. `governorCost` is populated
 * during tree build; the tooltip breaks the average down per metric.
 */
export function createGovernorCostColumn(governorLimits: GovernorLimits): ColumnDefinition {
  const formatterParams = { precision: 0, totalValue: 100, showPercentageText: false };
  return {
    title: 'Gov. Avg (%)',
    field: 'governorCost',
    sorter: 'number',
    cssClass: 'number-cell',
    width: 100,
    minWidth: 80,
    hozAlign: 'right',
    headerHozAlign: 'right',
    formatter: progressFormatter,
    formatterParams,
    bottomCalc: 'max',
    bottomCalcFormatter: progressFormatter,
    bottomCalcFormatterParams: formatterParams,
    tooltip(_event, cell) {
      const total = (cell.getValue() ?? 0) as number;
      const breakdown = governorCostBreakdown(cell.getData() as GovernorCostRow, governorLimits);
      if (!breakdown.length) {
        return `${total.toFixed(1)}%`;
      }
      const rows = breakdown.map((m) => {
        const used = m.label === 'Heap' ? formatInteger(m.used) : `${m.used}`;
        const limit = m.label === 'Heap' ? formatInteger(m.limit) : `${m.limit}`;
        return `${m.label} ${used}/${limit} (${m.percent.toFixed(1)}%)`;
      });
      return `${total.toFixed(1)}% — average utilisation across all governors<br>${rows.join('<br>')}`;
    },
  };
}

/**
 * The "Gov. Peak (%)" column — the single tightest governor consumed on a path
 * (see {@link governorCostMax}), rendered as a bar. Complements the averaged
 * Gov. Avg column; hidden by default (surfaced by the Governor Limits view or a
 * user toggle). The tooltip names which governor is the peak.
 */
export function createGovernorPeakColumn(governorLimits: GovernorLimits): ColumnDefinition {
  const formatterParams = { precision: 0, totalValue: 100, showPercentageText: false };
  return {
    title: 'Gov. Peak (%)',
    field: 'governorCostMax',
    visible: false,
    sorter: 'number',
    cssClass: 'number-cell',
    width: 100,
    minWidth: 80,
    hozAlign: 'right',
    headerHozAlign: 'right',
    formatter: progressFormatter,
    formatterParams,
    bottomCalc: 'max',
    bottomCalcFormatter: progressFormatter,
    bottomCalcFormatterParams: formatterParams,
    tooltip(_event, cell) {
      const peak = (cell.getValue() ?? 0) as number;
      const [top] = governorCostBreakdown(cell.getData() as GovernorCostRow, governorLimits);
      if (!top) {
        return `${peak.toFixed(1)}%`;
      }
      const used = top.label === 'Heap' ? formatInteger(top.used) : `${top.used}`;
      const limit = top.label === 'Heap' ? formatInteger(top.limit) : `${top.limit}`;
      return `Tightest single governor: ${top.label} ${used}/${limit} (${peak.toFixed(1)}%)`;
    },
  };
}

/**
 * A governor-metric column (DML/SOQL/SOSL counts & rows) rendered as a bar
 * relative to its governor `limit`. Shared by all call-tree/analysis tables so
 * the Total and Self variants stay consistent. Pass `visible: false` for the
 * Self variants, which are hidden until a view or the user shows them.
 */
export function createGovernorColumn(opts: {
  title: string;
  field: string;
  limit: number;
  width?: number;
  minWidth?: number;
  visible?: boolean;
}): ColumnDefinition {
  const { title, field, limit, width = 70, minWidth = 60, visible } = opts;
  const formatterParams = { precision: 0, totalValue: limit, showPercentageText: false };
  return {
    title,
    field,
    visible,
    sorter: 'number',
    cssClass: 'number-cell',
    width,
    minWidth,
    hozAlign: 'right',
    headerHozAlign: 'right',
    formatter: progressFormatter,
    formatterParams,
    bottomCalc: 'sum',
    bottomCalcFormatter: progressFormatter,
    bottomCalcFormatterParams: formatterParams,
    tooltip(_event, cell) {
      const value = cell.getValue();
      return value + (limit > 0 ? '/' + limit : '');
    },
  };
}

/**
 * The shared governor-metric column block common to every call-tree table
 * (aggregated, bottom-up, time-order): the DML/SOQL/SOSL count & row columns
 * (Total + hidden Self variants), the Throws Count column, the two Heap columns,
 * and the Gov. Avg/Peak columns — in display order. Extracted so the block stays
 * identical across all three tables; spread into each table's `columns` after
 * its view-specific leading columns (Name, Namespace, …).
 */
/** Per-table footer (`bottomCalc`) for each heap column, so heap totals/self match the
 * table's time-column aggregation. Peak always uses 'max'. */
export interface HeapFooterCalcs {
  netTotal: ColumnDefinition['bottomCalc'];
  netSelf: ColumnDefinition['bottomCalc'];
  grossTotal: ColumnDefinition['bottomCalc'];
  grossSelf: ColumnDefinition['bottomCalc'];
}

export function createGovernorMetricColumns(
  governorLimits: GovernorLimits,
  heapFooters: HeapFooterCalcs,
): ColumnDefinition[] {
  return [
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
    // SOSL rows have no governor limit (only SOSL queries is limited, to 20),
    // so these are plain counts rather than progress bars against a limit.
    {
      title: 'SOSL Rows',
      field: 'soslRowCount.total',
      sorter: 'number',
      cssClass: 'number-cell',
      width: 70,
      minWidth: 60,
      hozAlign: 'right',
      headerHozAlign: 'right',
      bottomCalc: 'sum',
    },
    {
      title: 'SOSL Rows (self)',
      field: 'soslRowCount.self',
      visible: false,
      sorter: 'number',
      cssClass: 'number-cell',
      width: 70,
      minWidth: 60,
      hozAlign: 'right',
      headerHozAlign: 'right',
      bottomCalc: 'sum',
    },
    createHeapBytesColumn(
      'heapAllocated.total',
      'Heap Net (bytes)',
      'Net bytes retained on this path (alloc − free); may be negative',
      heapFooters.netTotal,
    ),
    createHeapBytesColumn(
      'heapAllocated.self',
      'Heap Net self (bytes)',
      'Net bytes retained directly by this node (excluding sub-methods); may be negative',
      heapFooters.netSelf,
      false,
    ),
    createHeapBytesColumn(
      'heapPeak',
      'Heap Peak (bytes)',
      'Peak live heap on this path (matches the "Maximum heap size" governor)',
      'max',
    ),
    createHeapBytesColumn(
      'heapGross.total',
      'Heap Alloc (bytes)',
      'Total bytes allocated on this path (ignores frees; churn)',
      heapFooters.grossTotal,
      false,
    ),
    createHeapBytesColumn(
      'heapGross.self',
      'Heap Alloc self (bytes)',
      'Bytes allocated directly by this node (excluding sub-methods; ignores frees)',
      heapFooters.grossSelf,
      false,
    ),
    createGovernorCostColumn(governorLimits),
    createGovernorPeakColumn(governorLimits),
  ];
}

/**
 * A shared plain-number heap column: every heap value (net, gross, peak — total & self)
 * renders identically as a thousand-separated integer in bytes (no bar, no %), so the
 * columns scan uniformly. The unit lives in the title. `bottomCalc` is supplied by the
 * caller so each table's footer can match its time-column aggregation (per-table sum vs
 * call-stack-dedup for totals, sum-all-visible for self, 'max' for peak).
 */
export function createHeapBytesColumn(
  field: string,
  title: string,
  headerTooltip: string,
  bottomCalc: ColumnDefinition['bottomCalc'],
  visible?: boolean,
): ColumnDefinition {
  return {
    title,
    field,
    headerTooltip,
    visible,
    sorter: 'number',
    cssClass: 'number-cell',
    width: 90,
    minWidth: 70,
    hozAlign: 'right',
    headerHozAlign: 'right',
    formatter: (cell) => formatInteger((cell.getValue() ?? 0) as number),
    bottomCalc,
    bottomCalcFormatter: (cell) => formatInteger((cell.getValue() ?? 0) as number),
    tooltip(_event, cell) {
      return formatInteger((cell.getValue() ?? 0) as number);
    },
  };
}
