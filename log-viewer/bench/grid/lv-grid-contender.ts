/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * An lv-grid element on the Time Order rows. `lv-grid` has the same plain text cells as
 * the `grid` contender, so the difference is what the ui layer costs. `call-tree` is
 * `<lv-call-tree-grid>` with the app's columns: what the Call Tree would cost.
 */
import type { ApexLog } from '@apexdevtools/apex-log-parser';

import { logStoreFor } from '../../src/core/log/LogStore.js';
import {
  TimeOrderSource,
  type TimeOrderNode,
} from '../../src/features/call-tree/utils/TimeOrderTree.js';
import { timeOrderColumns } from '../../src/features/call-tree/grid/columns.js';
import type { GridColumn, LvGrid, RowFilter } from '../../src/grid/index.js';
import type { Contender } from './contender.js';
import { columnsFor } from './grid-contender.js';

const SORTED = 'duration.self';

const plainColumns = (source: TimeOrderSource): GridColumn<TimeOrderNode>[] =>
  columnsFor(source).map((column) => ({
    id: column.field,
    title: column.title,
    width: column.width === 'flex' ? 'flex' : column.width,
    minWidth: column.width === 'flex' ? 200 : undefined,
    cell: column.text,
    text: column.text,
    sort:
      column.field === SORTED
        ? { value: ({ row }: TimeOrderNode) => source.index.self[row]! }
        : undefined,
    sortFirst: 'desc',
  }));

type Setup<R extends object> = (source: TimeOrderSource) => {
  grid: LvGrid<R>;
  details: RowFilter<R>;
};

const plain: Setup<TimeOrderNode> = (source) => {
  const grid = document.createElement('lv-grid') as LvGrid<TimeOrderNode>;
  grid.style.cssText =
    'font: 13px sans-serif; --grid-fg: #ccc; --grid-bg: #1e1e1e; color-scheme: dark';
  grid.columns = plainColumns(source);
  grid.source = source;
  return { grid, details: source.withoutDetails };
};

const app: Setup<TimeOrderNode> = (source) => {
  const grid = document.createElement('lv-call-tree-grid') as unknown as LvGrid<TimeOrderNode>;
  grid.columns = timeOrderColumns(source, { openType: () => {} });
  grid.source = source;
  return { grid, details: source.withoutDetails };
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
    const source = new TimeOrderSource(await logStoreFor(log).logIndex());
    ({ grid: this.grid, details: this.details } = this.setup(source));
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

  async goTo(path: readonly number[]): Promise<void> {
    await this.grid.goTo([...path]);
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

/** `<lv-grid>` with plain text cells on the Time Order rows. */
export const lvGridContender = (): Contender => new LvGridContender(plain);

/** `<lv-call-tree-grid>` with the app's Time Order columns. */
export const callTreeContender = (): Contender => new LvGridContender(app);
