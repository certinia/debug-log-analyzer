/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * The Call Tree's Aggregated table as `<lv-call-tree-grid>`, built with the options
 * `CalltreeView` gives it. Its Tabulator baseline is `baseline/tabulator-aggregated-580k.json`.
 */
import type { ApexLog } from '@apexdevtools/apex-log-parser';

import { logStoreFor } from '../../src/core/log/LogStore.js';
import '../../src/features/call-tree/grid/CallTreeGrid.js';
import type { CallTreeGrid } from '../../src/features/call-tree/grid/CallTreeGrid.js';
import { aggregatedColumns, mergedLines } from '../../src/features/call-tree/grid/columns.js';
import {
  toAggregatedCallTree,
  type AggregatedRow,
} from '../../src/features/call-tree/utils/Aggregation.js';
import type { MergedContender } from './contender.js';

const details = (row: AggregatedRow): boolean => row._hasDetailsDeep;

export class LvGridAggregated implements MergedContender {
  private grid!: CallTreeGrid<AggregatedRow>;

  async mount(host: HTMLElement, log: ApexLog): Promise<void> {
    this.grid = document.createElement('lv-call-tree-grid') as CallTreeGrid<AggregatedRow>;
    this.grid.columns = aggregatedColumns(log, { openType: () => {} });
    this.grid.filters = [{ test: details }];
    this.grid.rowLines = mergedLines;
    const roots = toAggregatedCallTree(
      log.children,
      logStoreFor(log).keyPathIds(),
      log.governorLimits,
    );
    this.grid.source = { roots, children: (r) => r._children, key: (r) => r.id };
    host.append(this.grid);
    await this.grid.settled();
  }

  async sortTotalDesc(): Promise<void> {
    this.grid.sort = { column: 'totalTime', dir: 'desc' };
    await this.settle();
  }

  async clearSort(): Promise<void> {
    this.grid.sort = null;
    await this.settle();
  }

  async expandAll(): Promise<void> {
    await this.grid.expandAll();
    await this.grid.settled();
  }

  async collapseAll(): Promise<void> {
    await this.grid.collapseAll();
    await this.grid.settled();
  }

  find(text: string): Promise<number> {
    return this.grid.find({ text });
  }

  async exportCsv(): Promise<number> {
    const text = await this.grid.exportText({ format: 'csv' });
    return text?.length ?? -1;
  }

  scroller(): HTMLElement {
    return this.grid.renderRoot.querySelector<HTMLElement>('.scroller') as HTMLElement;
  }

  visibleRowCount(): number {
    // aria-rowcount counts the header and footer rows.
    return Number(this.scroller().getAttribute('aria-rowcount')) - 2;
  }

  private async settle(): Promise<void> {
    await this.grid.updateComplete;
    await this.grid.settled();
  }
}
