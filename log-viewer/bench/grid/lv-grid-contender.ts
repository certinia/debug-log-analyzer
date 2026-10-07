/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * An lv-grid element on the Time Order rows. `lv-grid` has the same plain text cells as
 * the `grid` contender, so the difference is what the ui layer costs. `call-tree` is
 * `<lv-call-tree-grid>` with the app's columns: what the Call Tree would cost.
 */
import type { ApexLog, LogEvent } from '@apexdevtools/apex-log-parser';

import {
  toTimeOrderTree,
  type TimeOrderRow,
} from '../../src/features/call-tree/utils/TimeOrderTree.js';
import '../../src/features/call-tree/grid/CallTreeGrid.js';
import { timeOrderColumns } from '../../src/features/call-tree/grid/columns.js';
import type { GridColumn, LvGrid } from '../../src/grid/index.js';
import type { Contender } from './contender.js';
import { COLUMNS, detail } from './grid-contender.js';

const SORTED = 'duration.self';

const plainColumns = (): GridColumn<TimeOrderRow>[] =>
  COLUMNS.map((column) => ({
    id: column.field,
    title: column.title,
    width: column.width === 'flex' ? 'flex' : column.width,
    minWidth: column.width === 'flex' ? 200 : undefined,
    cell: column.text,
    text: column.text,
    sort: column.field === SORTED ? { value: (r: TimeOrderRow) => r.duration.self } : undefined,
    sortFirst: 'desc',
  }));

export class LvGridContender implements Contender {
  private grid!: LvGrid<TimeOrderRow>;
  private readonly app: boolean;

  /** `app`: `<lv-call-tree-grid>` and the Time Order columns, not plain text. */
  constructor(app = false) {
    this.app = app;
  }

  async mount(host: HTMLElement, log: ApexLog): Promise<void> {
    if (this.app) {
      this.grid = document.createElement('lv-call-tree-grid');
      this.grid.columns = timeOrderColumns(log, { openType: () => {} });
    } else {
      this.grid = document.createElement('lv-grid') as LvGrid<TimeOrderRow>;
      this.grid.style.cssText =
        'font: 13px sans-serif; --grid-fg: #ccc; --grid-bg: #1e1e1e; color-scheme: dark';
      this.grid.columns = plainColumns();
    }
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
    // aria-rowcount counts the header row, and the footer row where there is one.
    const footer = this.scroller().querySelector('.foot') ? 1 : 0;
    return Number(this.scroller().getAttribute('aria-rowcount')) - 1 - footer;
  }
}
