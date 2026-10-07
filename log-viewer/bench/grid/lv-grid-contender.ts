/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * The `<lv-grid>` element on the Time Order rows, with the same plain text cells as the
 * `grid` contender: the difference between the two is what the ui layer costs.
 */
import type { ApexLog, LogEvent } from '@apexdevtools/apex-log-parser';

import {
  toTimeOrderTree,
  type TimeOrderRow,
} from '../../src/features/call-tree/utils/TimeOrderTree.js';
import type { GridColumn, LvGrid } from '../../src/grid/index.js';
import '../../src/grid/index.js';
import type { Contender } from './contender.js';
import { COLUMNS, detail } from './grid-contender.js';

const SORTED = 'duration.self';

export class LvGridContender implements Contender {
  private grid!: LvGrid<TimeOrderRow>;

  async mount(host: HTMLElement, log: ApexLog): Promise<void> {
    this.grid = document.createElement('lv-grid') as LvGrid<TimeOrderRow>;
    this.grid.style.cssText =
      'font: 13px sans-serif; --grid-fg: #ccc; --grid-bg: #1e1e1e; color-scheme: dark';
    this.grid.columns = COLUMNS.map((column): GridColumn<TimeOrderRow> => ({
      id: column.field,
      title: column.title,
      width: column.width === 'flex' ? 'flex' : column.width,
      minWidth: column.width === 'flex' ? 200 : undefined,
      cell: column.text,
      text: column.text,
      sort: column.field === SORTED ? { value: (r) => r.duration.self } : undefined,
      sortFirst: 'desc',
    }));
    this.grid.filters = [detail];
    const roots = toTimeOrderTree(log.children, log.governorLimits) ?? [];
    this.grid.source = { roots, children: (r) => r._children, key: (r) => r.id };
    host.append(this.grid);
    await this.grid.settled();
  }

  async expandAll(): Promise<void> {
    await this.grid.expandAll();
    await this.grid.settled();
  }

  async collapseAll(): Promise<void> {
    await this.grid.collapseAll();
    await this.grid.settled();
  }

  async sortSelfDesc(): Promise<void> {
    this.grid.sort = { column: SORTED, dir: 'desc' };
    await this.grid.updateComplete;
    await this.grid.settled();
  }

  async clearSort(): Promise<void> {
    this.grid.sort = null;
    await this.grid.updateComplete;
    await this.grid.settled();
  }

  async setDetailFilter(on: boolean): Promise<void> {
    this.grid.filters = on ? [detail] : [];
    await this.grid.updateComplete;
    await this.grid.settled();
  }

  async goTo(target: LogEvent): Promise<void> {
    const path: number[] = [];
    for (let e: LogEvent | null = target; e?.parent; e = e.parent) {
      path.push(e.eventIndex);
    }
    await this.grid.goTo(path.reverse());
  }

  find(text: string): Promise<number> {
    return this.grid.find({ text });
  }

  async exportCsv(): Promise<number> {
    const text = await this.grid.exportText({ format: 'csv' });
    return text?.length ?? -1;
  }

  async setColumnVisible(field: string, visible: boolean): Promise<void> {
    this.grid.columns = this.grid.columns.map((column) =>
      column.id === field ? { ...column, hidden: !visible } : column,
    );
    await this.grid.updateComplete;
  }

  setNameWidth(px: number): void {
    this.grid.setColumnWidth('text', px);
  }

  scroller(): HTMLElement {
    return this.grid.renderRoot.querySelector<HTMLElement>('.scroller') as HTMLElement;
  }

  visibleRowCount(): number {
    // aria-rowcount counts the header row; these columns have no footer.
    return Number(this.scroller().getAttribute('aria-rowcount')) - 1;
  }
}
