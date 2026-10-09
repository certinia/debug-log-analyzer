/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * The Call Tree's Aggregated table, as Tabulator and as `<lv-call-tree-grid>`, each built
 * with the options `CalltreeView` gives it.
 */
import type { ApexLog } from '@apexdevtools/apex-log-parser';
import type { Tabulator } from 'tabulator-tables';

import { logStoreFor } from '../../src/core/log/LogStore.js';
import { createAggregatedTable } from '../../src/features/call-tree/components/AggregatedTable.js';
import '../../src/features/call-tree/grid/CallTreeGrid.js';
import type { CallTreeGrid } from '../../src/features/call-tree/grid/CallTreeGrid.js';
import { aggregatedColumns, mergedLines } from '../../src/features/call-tree/grid/columns.js';
import {
  toAggregatedCallTree,
  type AggregatedRow,
} from '../../src/features/call-tree/utils/Aggregation.js';
import { groupedRowFormatter } from '../../src/features/call-tree/utils/CategoryColoring.js';
import { expandCollapseAll } from '../../src/features/call-tree/utils/ExpandCollapse.js';
import dataGridStyles from '../../src/tabulator/style/DataGrid.scss';
import type { MergedContender } from './contender.js';

const details = (row: AggregatedRow): boolean => row._hasDetailsDeep;

/** The extension function the app's Find module adds to a table. */
interface Extended {
  find(args: { text: string; count: number; options: { matchCase: boolean } }): Promise<{
    totalMatches: number;
  }>;
}

export class TabulatorAggregated implements MergedContender {
  private table!: Tabulator & Extended;
  private holder!: HTMLElement;

  async mount(host: HTMLElement, log: ApexLog): Promise<void> {
    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = String(dataGridStyles);
    const container = document.createElement('div');
    container.style.height = '100%';
    root.append(style, container);

    const { table, tableBuilt } = createAggregatedTable(container, log, {
      showDetailsFilter: details,
      rowFormatter: groupedRowFormatter,
    });
    this.table = table as Tabulator & Extended;
    await tableBuilt;
    this.holder = container.querySelector('.tabulator-tableholder') as HTMLElement;
  }

  sortTotalDesc(): void {
    this.table.setSort('totalTime', 'desc');
  }

  clearSort(): void {
    this.table.clearSort();
  }

  expandAll(): void {
    this.table.blockRedraw();
    expandCollapseAll(this.table.getRows(), true);
    this.table.restoreRedraw();
  }

  collapseAll(): void {
    this.table.blockRedraw();
    expandCollapseAll(this.table.getRows(), false);
    this.table.restoreRedraw();
  }

  async find(text: string): Promise<number> {
    const result = await this.table.find({ text, count: 0, options: { matchCase: false } });
    return result.totalMatches;
  }

  /** The Call Tree's Aggregated table has no download: the bench skips this. */
  exportCsv(): Promise<number> {
    return Promise.resolve(-1);
  }

  scroller(): HTMLElement {
    return this.holder;
  }

  visibleRowCount(): number {
    return this.table.rowManager.getDisplayRows().length;
  }
}

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
