/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * The Call Tree's Bottom-Up table, as Tabulator and as `<lv-call-tree-grid>`, each built
 * with the options `CalltreeView` gives it.
 */
import type { ApexLog } from '@apexdevtools/apex-log-parser';
import type { Tabulator } from 'tabulator-tables';

import { logStoreFor } from '../../src/core/log/LogStore.js';
import { createBottomUpTable } from '../../src/features/call-tree/components/BottomUpTable.js';
import '../../src/features/call-tree/grid/CallTreeGrid.js';
import type { CallTreeGrid } from '../../src/features/call-tree/grid/CallTreeGrid.js';
import { BOTTOM_UP_SORT, bottomUpColumns } from '../../src/features/call-tree/grid/columns.js';
import {
  buildBottomUpTree,
  type BottomUpRow,
} from '../../src/features/call-tree/utils/Aggregation.js';
import { groupedRowFormatter } from '../../src/features/call-tree/utils/CategoryColoring.js';
import { expandCollapseAll } from '../../src/features/call-tree/utils/ExpandCollapse.js';
import { initialisedRowRange } from '../../src/tabulator/module/initialisedRows.js';
import dataGridStyles from '../../src/tabulator/style/DataGrid.scss';
import type { BottomUpContender } from './contender.js';

const details = (row: BottomUpRow): boolean => row._hasDetailsDeep;

/** Extension functions the app's own modules add to a table. */
interface Extended {
  find(args: { text: string; count: number; options: { matchCase: boolean } }): Promise<{
    totalMatches: number;
  }>;
  setSortedGroupBy(field: string): void;
}

export class TabulatorBottomUp implements BottomUpContender {
  private table!: Tabulator & Extended;
  private holder!: HTMLElement;

  async mount(host: HTMLElement, log: ApexLog): Promise<void> {
    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = String(dataGridStyles);
    const container = document.createElement('div');
    container.style.height = '100%';
    root.append(style, container);

    const { table, tableBuilt } = createBottomUpTable(
      container,
      log,
      { showDetailsFilter: details, rowFormatter: groupedRowFormatter },
      { selectableRows: 'highlight', enableClipboardAndDownload: true, exportFileName: 'b.csv' },
    );
    this.table = table as Tabulator & Extended;
    await tableBuilt;
    this.holder = container.querySelector('.tabulator-tableholder') as HTMLElement;
  }

  groupBy(field: 'type' | 'namespace' | null): void {
    this.table.setSortedGroupBy(field ?? '');
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

  async exportCsv(): Promise<number> {
    let length = 0;
    // Read at download time, so swapping it in captures the text instead of saving it.
    this.table.options.downloadEncoder = (contents: string) => {
      length = contents.length;
      return false;
    };
    this.table.download('csv', 'b.csv', { bom: true, delimiter: ',' }, initialisedRowRange);
    return length;
  }

  scroller(): HTMLElement {
    return this.holder;
  }

  visibleRowCount(): number {
    return this.table.rowManager.getDisplayRows().length;
  }
}

export class LvGridBottomUp implements BottomUpContender {
  private grid!: CallTreeGrid<BottomUpRow>;

  async mount(host: HTMLElement, log: ApexLog): Promise<void> {
    this.grid = document.createElement('lv-call-tree-grid') as CallTreeGrid<BottomUpRow>;
    this.grid.columns = bottomUpColumns(log, { openType: () => {} });
    this.grid.filters = [{ test: details }];
    this.grid.sort = BOTTOM_UP_SORT;
    const roots = await buildBottomUpTree(
      log.children,
      logStoreFor(log).keyPathIds(),
      log.governorLimits,
    );
    this.grid.source = { roots: roots ?? [], children: (r) => r._children, key: (r) => r.id };
    host.append(this.grid);
    await this.grid.settled();
  }

  async groupBy(field: 'type' | 'namespace' | null): Promise<void> {
    this.grid.groupBy = field ? (row) => row[field] : null;
    await this.settle();
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
