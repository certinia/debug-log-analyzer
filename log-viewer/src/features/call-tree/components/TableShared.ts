/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import type { GovernorLimits } from 'apex-log-parser';
import { Tabulator, type ColumnDefinition, type RowComponent } from 'tabulator-tables';

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

/** Bytes → human-readable (e.g. 1536 → "1.5 KB"), for heap columns/tooltips. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

/**
 * The shared "Gov. Avg (%)" column — the average governor consumption across all
 * governors on a call path (see {@link governorCost}), rendered as a progress
 * bar. Reused across all call-tree/analysis tables. `governorCost` is populated
 * by {@link annotateGovernorCost}; the tooltip breaks the average down per metric.
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
        const used = m.label === 'Heap' ? formatBytes(m.used) : `${m.used}`;
        const limit = m.label === 'Heap' ? formatBytes(m.limit) : `${m.limit}`;
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
      const used = top.label === 'Heap' ? formatBytes(top.used) : `${top.used}`;
      const limit = top.label === 'Heap' ? formatBytes(top.limit) : `${top.limit}`;
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
 * The shared "Heap Allocated" column — bytes allocated on a call path, rendered
 * as a bar relative to the heap governor limit. Reused across all
 * call-tree/analysis tables. Pass a `heapAllocated.self` field + `visible: false`
 * for the Self variant.
 */
export function createHeapColumn(
  governorLimits: GovernorLimits,
  field = 'heapAllocated.total',
  title = 'Heap Allocated',
  visible?: boolean,
): ColumnDefinition {
  const limit = governorLimits.heapSize.limit;
  const formatterParams = { precision: 0, totalValue: limit, showPercentageText: false };
  return {
    title,
    field,
    visible,
    sorter: 'number',
    cssClass: 'number-cell',
    width: 90,
    minWidth: 70,
    hozAlign: 'right',
    headerHozAlign: 'right',
    formatter: progressFormatter,
    formatterParams,
    bottomCalc: 'sum',
    bottomCalcFormatter: progressFormatter,
    bottomCalcFormatterParams: formatterParams,
    tooltip(_event, cell) {
      const used = (cell.getValue() ?? 0) as number;
      return limit > 0 ? `${formatBytes(used)} / ${formatBytes(limit)}` : formatBytes(used);
    },
  };
}
