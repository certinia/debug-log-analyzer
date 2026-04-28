/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

import type { RowComponent, Tabulator } from 'tabulator-tables';

import type { AggregatedRow, BottomUpRow } from './Aggregation.js';
import { type MergedCalltreeRow } from './MergeAdjacent.js';

type CalltreeRowUnion = MergedCalltreeRow | AggregatedRow | BottomUpRow;

interface InternalRow {
  getComponent(): RowComponent;
  getData(): CalltreeRowUnion;
}

interface DataTreeModule {
  getFilteredTreeChildren(row: InternalRow): InternalRow[];
}

interface RowComponentInternal extends RowComponent {
  _getSelf(): InternalRow;
}

type TabulatorInternals = Tabulator & {
  modules: { dataTree?: DataTreeModule };
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
 * reach into `table.modules.dataTree.getFilteredTreeChildren(internalRow)`,
 * which applies the active filters to a row's tree children. The internal Row
 * is obtained via `RowComponent._getSelf()`.
 */
export function makeSumSelfTimeAllVisible(getTable: () => Tabulator | undefined) {
  return (_values: number[], _data: CalltreeRowUnion[], _calcParams: unknown): number => {
    const table = getTable() as TabulatorInternals | undefined;
    const dataTree = table?.modules.dataTree;
    if (!table || !dataTree) {
      return 0;
    }

    let total = 0;
    const walk = (rows: InternalRow[]): void => {
      for (const row of rows) {
        total += getRowSelfTime(row.getData());
        walk(dataTree.getFilteredTreeChildren(row));
      }
    };

    const topLevel = table.getRows('active') as RowComponentInternal[];
    walk(topLevel.map((rc) => rc._getSelf()));
    return total;
  };
}
