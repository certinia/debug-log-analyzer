/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import type { GovernorLimits } from 'apex-log-parser';
import {
  Tabulator,
  type ColumnDefinition,
  type Options,
  type RowComponent,
} from 'tabulator-tables';

import { formatInteger } from '../../../core/utility/Util.js';
import { NAMESPACE_WIDTH } from '../../../tabulator/ColumnWidths.js';
import { progressFormatter } from '../../../tabulator/format/Progress.js';
import { type ProgressParams, progressFormatterMS } from '../../../tabulator/format/ProgressMS.js';
import { AnchoringPolicy } from '../../../tabulator/module/AnchoringPolicy.js';
import * as CommonModules from '../../../tabulator/module/CommonModules.js';
import { Find } from '../../../tabulator/module/Find.js';
import { RowKeyboardNavigation } from '../../../tabulator/module/RowKeyboardNavigation.js';
import { RowNavigation } from '../../../tabulator/module/RowNavigation.js';
import { VirtualVerticalRenderer } from '../../../tabulator/renderer/VirtualVerticalRenderer.js';
import { makeSumFieldAllVisible } from '../utils/BottomCalcs.js';
import { governorCostBreakdown, type GovernorCostRow } from '../utils/GovernorCost.js';

export interface TableCallbacks {
  rowFormatter?: (row: RowComponent) => void;
}

export function registerTableModules(): void {
  Tabulator.registerModule(Object.values(CommonModules));
  Tabulator.registerModule([RowKeyboardNavigation, RowNavigation, AnchoringPolicy, Find]);
}

/**
 * Table options that make `Cmd/Ctrl+C` copy the whole table, as every top-level
 * grid does. Spread into a table's options; the cast covers Tabulator's typings,
 * which don't yet accept an array of key bindings.
 */
export const clipboardCopyOptions = {
  clipboard: true,
  clipboardCopyRowRange: 'all',
  keybindings: { copyToClipboard: ['ctrl + 67', 'meta + 67'] },
} as unknown as Partial<Options>;

/**
 * Virtual row rendering plus the scroll anchoring that goes with it — one
 * matched pair (see ScrollAnchor), so any table with an unbounded row count
 * spreads this rather than remembering both halves.
 */
export const virtualScrollOptions = {
  renderVertical: VirtualVerticalRenderer,
  anchoringPolicy: true,
} satisfies Partial<Options>;

/**
 * A right-aligned duration column rendered as a `progressFormatterMS` bar
 * (value + percent), fixed to `barWidth`, with a matching bottom-calc. Shared by
 * the side-panel Call stack / Call tree tables so their Total/Self columns match.
 */
export function createDurationBarColumn(opts: {
  title: string;
  field: string;
  barWidth: number;
  barParams: ProgressParams;
  bottomCalc: ColumnDefinition['bottomCalc'];
  tooltip?: ColumnDefinition['tooltip'];
}): ColumnDefinition {
  return {
    title: opts.title,
    field: opts.field,
    sorter: 'number',
    hozAlign: 'right',
    headerHozAlign: 'right',
    width: opts.barWidth,
    minWidth: opts.barWidth,
    widthGrow: 0,
    widthShrink: 0,
    formatter: progressFormatterMS,
    formatterParams: opts.barParams,
    bottomCalc: opts.bottomCalc,
    bottomCalcFormatter: progressFormatterMS,
    bottomCalcFormatterParams: opts.barParams,
    ...(opts.tooltip ? { tooltip: opts.tooltip } : {}),
  };
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

/** Row-metric columns: "Rows" is a shorter title than "Count", so they sit narrower. */
const ROWS_WIDTH = 63;

/** Numeric count columns: the narrowest a right-aligned count stays readable at. */
const COUNT_MIN_WIDTH = 60;

/**
 * The `Namespace` / `Caller Namespace` pair every call-tree table leads with, so
 * the two can't drift apart between tables. Caller is hidden until a view or the
 * user shows it.
 */
export function createNamespaceColumns(): ColumnDefinition[] {
  return [
    {
      title: 'Namespace',
      field: 'namespace',
      sorter: 'string',
      width: NAMESPACE_WIDTH,
      minWidth: 80,
    },
    {
      title: 'Caller Namespace',
      field: 'callerNamespace',
      sorter: 'string',
      width: NAMESPACE_WIDTH,
      visible: false,
    },
  ];
}

/**
 * The log event `Type` column. Hidden by default in the top-down tables, where
 * the name already carries the type prefix; Bottom-Up shows it, as its buckets
 * merge frames of differing types.
 */
export function createTypeColumn(opts: { visible?: boolean } = {}): ColumnDefinition {
  return {
    title: 'Type',
    field: 'type',
    headerSortStartingDir: 'asc',
    sorter: 'string',
    width: 150,
    tooltip: true,
    visible: opts.visible ?? false,
  };
}

/**
 * A plain right-aligned integer column with a summing footer — for counts with no
 * governor limit to draw a bar against (see {@link createGovernorColumn} for those).
 */
export function createCountColumn(opts: {
  title: string;
  field: string;
  width: number;
  visible?: boolean;
}): ColumnDefinition {
  return {
    title: opts.title,
    field: opts.field,
    visible: opts.visible,
    sorter: 'number',
    cssClass: 'number-cell',
    width: opts.width,
    minWidth: COUNT_MIN_WIDTH,
    hozAlign: 'right',
    headerHozAlign: 'right',
    bottomCalc: 'sum',
  };
}

/**
 * The shared "Gov Avg %" column — the average governor consumption across all
 * governors on a call path (see {@link governorCost}), rendered as a progress
 * bar. Reused across all call-tree/analysis tables. `governorCost` is populated
 * during tree build; the tooltip breaks the average down per metric.
 */
export function createGovernorCostColumn(governorLimits: GovernorLimits): ColumnDefinition {
  const formatterParams = { precision: 0, totalValue: 100, showPercentageText: false };
  return {
    title: 'Gov Avg %',
    field: 'governorCost',
    sorter: 'number',
    cssClass: 'number-cell',
    width: 71,
    minWidth: 71,
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
 * The "Gov Peak %" column — the single tightest governor consumed on a path
 * (see {@link governorCostMax}), rendered as a bar. Complements the averaged
 * Gov Avg column; hidden by default (surfaced by the Governor Limits view or a
 * user toggle). The tooltip names which governor is the peak.
 */
export function createGovernorPeakColumn(governorLimits: GovernorLimits): ColumnDefinition {
  const formatterParams = { precision: 0, totalValue: 100, showPercentageText: false };
  return {
    title: 'Gov Peak %',
    field: 'governorCostMax',
    visible: false,
    sorter: 'number',
    cssClass: 'number-cell',
    width: 78,
    minWidth: 78,
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
 *
 * The default 70px is what a two-line "… Count" header needs; the values never
 * exceed their governor limit, so they're far narrower. Row columns pass a
 * smaller `width` because "Rows" is a shorter word than "Count". Self titles say
 * `self`, not `(self)`, so the extra word wraps rather than costing 30-40px of
 * width.
 */
export function createGovernorColumn(opts: {
  title: string;
  field: string;
  limit: number;
  width?: number;
  minWidth?: number;
  visible?: boolean;
}): ColumnDefinition {
  const { title, field, limit, width = 70, minWidth = COUNT_MIN_WIDTH, visible } = opts;
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

/**
 * Heap footers for the top-down tables (aggregated, time-order): totals are a plain
 * `'sum'` (top-level rows are the non-overlapping call-stack roots), self sums every
 * visible row (self never overlaps). Bottom-up needs call-stack dedup for its totals,
 * so it builds its own footers instead.
 */
export function createSelfSumHeapFooters(getTable: () => Tabulator | undefined): HeapFooterCalcs {
  return {
    netTotal: 'sum',
    grossTotal: 'sum',
    netSelf: makeSumFieldAllVisible(getTable, (row) => row.heapAllocated.self),
    grossSelf: makeSumFieldAllVisible(getTable, (row) => row.heapGross.self),
  };
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
      title: 'DML Count self',
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
      title: 'SOQL Count self',
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
      title: 'SOSL Count self',
      field: 'soslCount.self',
      limit: governorLimits.soslQueries.limit,
      visible: false,
    }),
    // 77 is the narrowest width that doesn't clip "Throws"; 60 did.
    createCountColumn({ title: 'Throws Count', field: 'thrownCount.total', width: 77 }),
    createGovernorColumn({
      title: 'DML Rows',
      field: 'dmlRowCount.total',
      limit: governorLimits.dmlRows.limit,
      width: ROWS_WIDTH,
    }),
    createGovernorColumn({
      title: 'DML Rows self',
      field: 'dmlRowCount.self',
      limit: governorLimits.dmlRows.limit,
      width: ROWS_WIDTH,
      visible: false,
    }),
    createGovernorColumn({
      title: 'SOQL Rows',
      field: 'soqlRowCount.total',
      limit: governorLimits.queryRows.limit,
      width: ROWS_WIDTH,
    }),
    createGovernorColumn({
      title: 'SOQL Rows self',
      field: 'soqlRowCount.self',
      limit: governorLimits.queryRows.limit,
      width: ROWS_WIDTH,
      visible: false,
    }),
    // SOSL rows have no governor limit (only SOSL queries is limited, to 20),
    // so these are plain counts rather than progress bars against a limit.
    createCountColumn({ title: 'SOSL Rows', field: 'soslRowCount.total', width: ROWS_WIDTH }),
    createCountColumn({
      title: 'SOSL Rows self',
      field: 'soslRowCount.self',
      width: ROWS_WIDTH,
      visible: false,
    }),
    createHeapBytesColumn({
      field: 'heapAllocated.total',
      title: 'Heap Net (bytes)',
      headerTooltip: 'Net bytes retained on this path (alloc − free); may be negative',
      bottomCalc: heapFooters.netTotal,
      // The title wrapped to two lines is wider than "-12,000,000", the widest value.
      width: 92,
    }),
    createHeapBytesColumn({
      field: 'heapAllocated.self',
      title: 'Heap Net self (bytes)',
      headerTooltip:
        'Net bytes retained directly by this node (excluding sub-methods); may be negative',
      bottomCalc: heapFooters.netSelf,
      width: 121,
      visible: false,
    }),
    createHeapBytesColumn({
      field: 'heapPeak',
      title: 'Heap Peak (bytes)',
      headerTooltip: 'Peak live heap on this path (matches the "Maximum heap size" governor)',
      bottomCalc: 'max',
      width: 100,
    }),
    createHeapBytesColumn({
      field: 'heapGross.total',
      title: 'Heap Alloc (bytes)',
      headerTooltip: 'Total bytes allocated on this path (ignores frees; churn)',
      bottomCalc: heapFooters.grossTotal,
      width: 107,
      visible: false,
    }),
    createHeapBytesColumn({
      field: 'heapGross.self',
      title: 'Heap Alloc self (bytes)',
      headerTooltip: 'Bytes allocated directly by this node (excluding sub-methods; ignores frees)',
      bottomCalc: heapFooters.grossSelf,
      width: 121,
      visible: false,
    }),
    createGovernorCostColumn(governorLimits),
    createGovernorPeakColumn(governorLimits),
  ];
}

/**
 * A shared plain-number heap column: every heap value (net, gross, peak — total & self)
 * renders identically as a thousand-separated integer in bytes (no bar, no %), so the
 * columns scan uniformly. The unit lives in the title — the header, not the value, is what
 * sets these columns' minimum width.
 */
export interface HeapBytesColumnOptions {
  field: string;
  title: string;
  headerTooltip: string;
  /**
   * Supplied per column so each table's footer matches its time-column aggregation
   * (per-table sum vs call-stack-dedup for totals, sum-all-visible for self, 'max' for peak).
   */
  bottomCalc: ColumnDefinition['bottomCalc'];
  /** The widest title word wrapped to two lines, or the widest value — whichever is larger. */
  width: number;
  visible?: boolean;
}

export function createHeapBytesColumn({
  field,
  title,
  headerTooltip,
  bottomCalc,
  width,
  visible,
}: HeapBytesColumnOptions): ColumnDefinition {
  return {
    title,
    field,
    headerTooltip,
    visible,
    sorter: 'number',
    cssClass: 'number-cell',
    width,
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
