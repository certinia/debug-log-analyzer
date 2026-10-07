/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * The Call Tree's Time Order grid exactly as the app builds it, driven the way
 * `CalltreeView` drives it.
 */
import type { ApexLog, LogEvent } from '@apexdevtools/apex-log-parser';
import type { RowComponent, Tabulator } from 'tabulator-tables';

import { rowIndexStamper } from '../../src/components/locatedRow.js';
import { downloadOptions } from '../../src/features/call-tree/components/TableShared.js';
import { createTimeOrderTable } from '../../src/features/call-tree/components/TimeOrderTable.js';
import { initialisedRowRange } from '../../src/tabulator/module/initialisedRows.js';
import { categoryRowFormatter } from '../../src/features/call-tree/utils/CategoryColoring.js';
import { expandCollapseAll } from '../../src/features/call-tree/utils/ExpandCollapse.js';
import type { TimeOrderRow } from '../../src/features/call-tree/utils/TimeOrderTree.js';
import { withCodeDrivenExpand } from '../../src/tabulator/module/expandOrigin.js';
import dataGridStyles from '../../src/tabulator/style/DataGrid.scss';
import type { Contender } from './contender.js';
import { nextPaint } from './timing.js';

const showDetailsFilter = (data: TimeOrderRow): boolean => data._hasDetailsDeep;
const stampIndex = rowIndexStamper('id');

/** Extension functions the app's own modules add to a table. */
interface Extended {
  find(args: { text: string; count: number; options: { matchCase: boolean } }): Promise<{
    totalMatches: number;
  }>;
  goToRow(row: RowComponent, opts: { scrollIfVisible: boolean; focusRow: boolean }): Promise<void>;
}

export class TabulatorContender implements Contender {
  private table!: Tabulator & Extended;
  private holder!: HTMLElement;

  async mount(host: HTMLElement, log: ApexLog): Promise<void> {
    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = String(dataGridStyles);
    const container = document.createElement('div');
    container.style.height = '100%';
    root.append(style, container);

    const { table, tableBuilt } = createTimeOrderTable(container, log, {
      showDetailsFilter,
      onContextMenu: () => {},
      rowFormatter: (row) => {
        categoryRowFormatter(row);
        stampIndex(row);
      },
    });
    this.table = table as Tabulator & Extended;
    await tableBuilt;
    this.holder = container.querySelector('.tabulator-tableholder') as HTMLElement;
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

  sortSelfDesc(): void {
    this.table.setSort('duration.self', 'desc');
  }

  clearSort(): void {
    this.table.clearSort();
  }

  setDetailFilter(on: boolean): void {
    this.table.blockRedraw();
    this.table.clearFilter(false);
    if (on) {
      this.table.addFilter(showDetailsFilter);
    }
    this.table.restoreRedraw();
  }

  /** `CalltreeView._materializeRowPath`, then `goToRow`. */
  async goTo(target: LogEvent): Promise<void> {
    const path: LogEvent[] = [];
    let event: LogEvent | null = target;
    while (event?.parent) {
      path.push(event);
      event = event.parent;
    }
    path.reverse();

    let rows = this.table.getRows();
    let matched: RowComponent | null = null;
    for (const [i, step] of path.entries()) {
      const next = rows.find(
        (r) => (r.getData() as TimeOrderRow).originalData.eventIndex === step.eventIndex,
      );
      if (!next) {
        break;
      }
      matched = next;
      if (i === path.length - 1) {
        break;
      }
      let children = next.getTreeChildren() ?? [];
      if (!children.length && (next.getData() as TimeOrderRow)._children?.length) {
        withCodeDrivenExpand(() => next.treeExpand());
        await nextPaint();
        children = next.getTreeChildren() ?? [];
      }
      rows = children;
    }
    if (matched) {
      await this.table.goToRow(matched, { scrollIfVisible: true, focusRow: true });
    }
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
    // Bottom-Up's export: the same config and the same initialised range, since 'all'
    // reaches tree rows the display never built.
    this.table.options.downloadConfig = downloadOptions('bench.csv').downloadConfig;
    this.table.download('csv', 'bench.csv', { bom: true, delimiter: ',' }, initialisedRowRange);
    return length;
  }

  setColumnVisible(field: string, visible: boolean): void {
    const column = this.table.getColumn(field);
    if (visible) {
      column.show();
    } else {
      column.hide();
    }
    // `ColumnViews` redraws: show/hide does not re-run fitColumns.
    this.table.redraw();
  }

  setNameWidth(px: number): void {
    this.table.getColumn('text').setWidth(px);
  }

  scroller(): HTMLElement {
    return this.holder;
  }

  visibleRowCount(): number {
    return this.table.rowManager.getDisplayRows().length;
  }
}
