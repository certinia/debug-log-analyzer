/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

import type { ApexLog } from '@apexdevtools/apex-log-parser';

import { logStoreFor } from '../../src/core/log/LogStore.js';
import '../../src/features/call-tree/grid/CallTreeGrid.js';
import type { CallTreeGrid } from '../../src/features/call-tree/grid/CallTreeGrid.js';
import {
  BOTTOM_UP_SORT,
  bottomUpColumns,
  mergedLines,
} from '../../src/features/call-tree/grid/columns.js';
import {
  buildBottomUpTree,
  type BottomUpRow,
} from '../../src/features/call-tree/utils/Aggregation.js';
import type { BottomUpContender } from './contender.js';
import { LvGridBench } from './lv-grid-contender.js';

const details = (row: BottomUpRow): boolean => row._hasDetailsDeep;

export class LvGridBottomUp extends LvGridBench<BottomUpRow> implements BottomUpContender {
  async mount(host: HTMLElement, log: ApexLog): Promise<void> {
    const grid = document.createElement('lv-call-tree-grid') as CallTreeGrid<BottomUpRow>;
    grid.columns = bottomUpColumns(log, { openType: () => {} });
    grid.filters = [{ test: details }];
    grid.sort = BOTTOM_UP_SORT;
    grid.rowLines = mergedLines;
    const roots = await buildBottomUpTree(
      log.children,
      logStoreFor(log).keyPathIds(),
      log.governorLimits,
    );
    grid.source = { roots: roots ?? [], children: (r) => r._children, key: (r) => r.id };
    this.grid = grid;
    host.append(grid);
    await grid.settled();
  }

  async groupBy(field: 'type' | 'namespace' | null): Promise<void> {
    this.grid.groupBy = field ? (row) => row[field] : null;
    await this.settle();
  }

  async sortTotalDesc(): Promise<void> {
    this.grid.sort = { column: 'totalTime', dir: 'desc' };
    await this.settle();
  }
}
