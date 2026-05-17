/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

import type { Tabulator } from 'tabulator-tables';

import type { AggregatedRow, BottomUpRow } from './Aggregation.js';
import type { TimeOrderRow } from './TimeOrderTree.js';

import { getFilteredDataTreeRows, type DataTreeFilterTable } from './DataTreeFilter.js';

type CalltreeRowUnion = TimeOrderRow | AggregatedRow | BottomUpRow;

interface FilterModule {
  filterRow(row: { getData(): CalltreeRowUnion }, filters?: unknown): boolean;
}

type BottomCalcTable = DataTreeFilterTable<CalltreeRowUnion> & {
  modules: { filter?: FilterModule };
};

function getRowSelfTime(row: CalltreeRowUnion): number {
  if ('duration' in row) {
    return row.duration.self;
  }
  return row.totalSelfTime;
}

/**
 * Top-down self-time bottom calc factory: sums self-time across every row that
 * currently passes the table's filters, regardless of whether its parent
 * branch is expanded.
 *
 * Tabulator's public `RowComponent.getTreeChildren()` ignores filters, and
 * `getRows('active')` only walks expanded branches. To get an accurate sum we
 * collect rows through a data-only table-centric helper that applies the
 * active filter rules without DataTree child-row initialization side effects.
 */
export function makeSumSelfTimeAllVisible(getTable: () => Tabulator | undefined) {
  return (_values: number[], _data: CalltreeRowUnion[], _calcParams: unknown): number => {
    const table = getTable() as BottomCalcTable | undefined;
    if (!table) {
      return 0;
    }

    let total = 0;

    const allVisibleRows = getFilteredDataTreeRows(table);

    for (const row of allVisibleRows) {
      total += getRowSelfTime(row);
    }

    return total;
  };
}
