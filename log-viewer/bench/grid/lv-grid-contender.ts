/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * An lv-grid element on the Time Order rows. `lv-grid` has the same plain text cells as
 * the `grid` contender, so the difference is what the ui layer costs. `call-tree` is
 * `<lv-call-tree-grid>` with the app's columns on the parser's events: what the Call Tree
 * would cost.
 */
import type { ApexLog, LogEvent } from '@apexdevtools/apex-log-parser';

import {
  toTimeOrderTree,
  type TimeOrderRow,
} from '../../src/features/call-tree/utils/TimeOrderTree.js';
import type { CallTreeGrid } from '../../src/features/call-tree/grid/CallTreeGrid.js';
import {
  TIME_ORDER_DETAILS,
  timeOrderColumns,
  timeOrderSource,
} from '../../src/features/call-tree/grid/columns.js';
import type { GridColumn, LvGrid, RowFilter } from '../../src/grid/index.js';
import type { Contender } from './contender.js';
import { COLUMNS } from './grid-contender.js';
import { pathOf, timeOrderDetails } from './targets.js';

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

/** Builds the grid for a log, and gives the Show Details filter it uses. */
type Setup<R extends object> = (log: ApexLog) => { grid: LvGrid<R>; details: RowFilter<R> };

const plain: Setup<TimeOrderRow> = (log) => {
  const grid = document.createElement('lv-grid') as LvGrid<TimeOrderRow>;
  grid.style.cssText =
    'font: 13px sans-serif; --grid-fg: #ccc; --grid-bg: #1e1e1e; color-scheme: dark';
  grid.columns = plainColumns();
  const roots = toTimeOrderTree(log.children, log.governorLimits) ?? [];
  grid.source = { roots, children: (r) => r._children, key: (r) => r.id };
  return { grid, details: timeOrderDetails };
};

const app: Setup<LogEvent> = (log) => {
  const grid = document.createElement('lv-call-tree-grid') as CallTreeGrid<LogEvent>;
  grid.columns = timeOrderColumns(log, { openType: () => {} });
  grid.source = timeOrderSource(log);
  return { grid, details: TIME_ORDER_DETAILS };
};

/** The actions every lv-grid contender takes the same way. */
export abstract class LvGridBench<R extends object> {
  protected grid!: LvGrid<R>;

  abstract mount(host: HTMLElement, log: ApexLog): Promise<void>;

  async expandAll(): Promise<void> {
    await this.grid.expandAll();
    await this.grid.settled();
  }

  async collapseAll(): Promise<void> {
    await this.grid.collapseAll();
    await this.grid.settled();
  }

  async clearSort(): Promise<void> {
    this.grid.sort = null;
    await this.settle();
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
    // aria-rowcount counts the header row, and the footer row where there is one.
    const footer = this.scroller().querySelector('.foot') ? 1 : 0;
    return Number(this.scroller().getAttribute('aria-rowcount')) - 1 - footer;
  }

  protected async settle(): Promise<void> {
    await this.grid.updateComplete;
    await this.grid.settled();
  }
}

class LvGridContender<R extends object> extends LvGridBench<R> implements Contender {
  private details!: RowFilter<R>;

  constructor(private readonly setup: Setup<R>) {
    super();
  }

  async mount(host: HTMLElement, log: ApexLog): Promise<void> {
    ({ grid: this.grid, details: this.details } = this.setup(log));
    this.grid.filters = [this.details];
    host.append(this.grid);
    await this.grid.settled();
  }

  async sortSelfDesc(): Promise<void> {
    this.grid.sort = { column: SORTED, dir: 'desc' };
    await this.settle();
  }

  async setDetailFilter(on: boolean): Promise<void> {
    this.grid.filters = on ? [this.details] : [];
    await this.settle();
  }

  async goTo(target: LogEvent): Promise<void> {
    await this.grid.goTo(pathOf(target));
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
}

/** `<lv-grid>` with plain text cells on built Time Order rows. */
export const lvGridContender = (): Contender => new LvGridContender(plain);

/** `<lv-call-tree-grid>` with the app's Time Order columns on the parser's events. */
export const callTreeContender = (): Contender => new LvGridContender(app);
