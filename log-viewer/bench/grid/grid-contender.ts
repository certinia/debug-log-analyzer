/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * The grid's core and render layers on the Time Order rows, with plain text cells: what
 * the table itself costs, before the ui layer and the app's cell formatters.
 */
import type { ApexLog, LogEvent } from '@apexdevtools/apex-log-parser';

import {
  toTimeOrderTree,
  type TimeOrderRow,
} from '../../src/features/call-tree/utils/TimeOrderTree.js';
import {
  browserScheduler,
  FIND_ATTR,
  findPattern,
  GridStore,
  GridView,
  Group,
  sortComparator,
  type CellText,
  type RowFilter,
  type RowPainter,
  type RowView,
} from '../../src/grid/index.js';
import type { Contender } from './contender.js';

interface Column {
  field: string;
  title: string;
  /** Pixels; the Name column takes the rest. */
  width: number | 'flex';
  text: CellText<TimeOrderRow>;
}

const ms = (ns: number): string => (ns / 1e6).toFixed(2);
const count = (n: number): string => String(n);

/** The Time Order grid's fifteen columns, as text. */
const COLUMNS: Column[] = [
  { field: 'text', title: 'Name', width: 'flex', text: (r) => r.text },
  { field: 'namespace', title: 'Namespace', width: 117, text: (r) => r.namespace },
  { field: 'dmlCount.total', title: 'DML Count', width: 70, text: (r) => count(r.dmlCount.total) },
  {
    field: 'soqlCount.total',
    title: 'SOQL Count',
    width: 70,
    text: (r) => count(r.soqlCount.total),
  },
  {
    field: 'soslCount.total',
    title: 'SOSL Count',
    width: 70,
    text: (r) => count(r.soslCount.total),
  },
  {
    field: 'thrownCount.total',
    title: 'Throws',
    width: 77,
    text: (r) => count(r.thrownCount.total),
  },
  {
    field: 'dmlRowCount.total',
    title: 'DML Rows',
    width: 63,
    text: (r) => count(r.dmlRowCount.total),
  },
  {
    field: 'soqlRowCount.total',
    title: 'SOQL Rows',
    width: 63,
    text: (r) => count(r.soqlRowCount.total),
  },
  {
    field: 'soslRowCount.total',
    title: 'SOSL Rows',
    width: 63,
    text: (r) => count(r.soslRowCount.total),
  },
  {
    field: 'heapAllocated.total',
    title: 'Heap Net',
    width: 92,
    text: (r) => count(r.heapAllocated.total),
  },
  { field: 'heapPeak', title: 'Heap Peak', width: 100, text: (r) => count(r.heapPeak) },
  {
    field: 'governorCost',
    title: 'Gov Avg %',
    width: 71,
    text: (r) => String(r.governorCost ?? '—'),
  },
  {
    field: 'governorCostMax',
    title: 'Gov Peak %',
    width: 78,
    text: (r) => String(r.governorCostMax ?? '—'),
  },
  {
    field: 'duration.total',
    title: 'Total Time (ms)',
    width: 140,
    text: (r) => ms(r.duration.total),
  },
  { field: 'duration.self', title: 'Self Time (ms)', width: 140, text: (r) => ms(r.duration.self) },
];

const STYLE = `
  .scroller { height: 100%; overflow: auto; contain: strict; font: 13px sans-serif; color: #ccc; }
  .row { display: grid; grid-template-columns: var(--cols); min-width: var(--min-width); }
  .head { position: sticky; top: 0; z-index: 1; background: #1e1e1e; font-weight: bold; }
  .body { position: relative; }
  .body .row { position: absolute; top: 0; left: 0; width: 100%; }
  .c { padding: 4px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .c.name { white-space: normal; overflow-wrap: anywhere; }
  .c[hidden] { display: none; }
  ::highlight(find-match) { background: #623315; }
  ::highlight(current-find-match) { background: #9e6a03; }
`;

const detail: RowFilter<TimeOrderRow> = { test: (r) => r._hasDetailsDeep };

export class GridContender implements Contender {
  private store!: GridStore<TimeOrderRow>;
  private view!: GridView<TimeOrderRow>;
  private host!: HTMLElement;
  private scrollEl!: HTMLElement;
  private head!: HTMLElement;
  private readonly hidden = new Set<string>();
  private nameWidth: number | null = null;

  async mount(host: HTMLElement, log: ApexLog): Promise<void> {
    this.host = host;
    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = STYLE;
    this.scrollEl = document.createElement('div');
    this.scrollEl.className = 'scroller';
    this.scrollEl.role = 'treegrid';
    this.head = document.createElement('div');
    this.head.className = 'row head';
    const body = document.createElement('div');
    body.className = 'body';
    this.scrollEl.append(this.head, body);
    root.append(style, this.scrollEl);
    this.layoutColumns();

    const roots = toTimeOrderTree(log.children, log.governorLimits) ?? [];
    this.store = new GridStore<TimeOrderRow>(
      { roots, children: (r) => r._children, key: (r) => r.id },
      { scheduler: browserScheduler },
    );
    this.view = new GridView<TimeOrderRow>({
      scroller: this.scrollEl,
      body,
      painter: this.painter(),
      rowHeight: 24,
    });
    await this.store.setFilters([detail]);
    this.show();
  }

  private painter(): RowPainter<TimeOrderRow> {
    return {
      paint: (el: HTMLElement, index: number, rows: RowView<TimeOrderRow>) => {
        el.className = 'row';
        if (el.childElementCount !== COLUMNS.length) {
          el.replaceChildren(
            ...COLUMNS.map((column) => {
              const cell = document.createElement('div');
              cell.className = column.width === 'flex' ? 'c name' : 'c';
              cell.setAttribute(FIND_ATTR, '');
              return cell;
            }),
          );
        }
        const entry = rows.rowAt(index);
        const depth = rows.depthAt(index);
        const cells = el.children;
        COLUMNS.forEach((column, i) => {
          const cell = cells[i] as HTMLElement;
          cell.hidden = this.hidden.has(column.field);
          if (entry instanceof Group) {
            cell.textContent = i ? '' : entry.key;
          } else if (i === 0) {
            const twisty = rows.hasChildrenAt(index)
              ? rows.isExpandedAt(index)
                ? '▾ '
                : '▸ '
              : '  ';
            cell.style.paddingLeft = `${depth * 9 + 4}px`;
            cell.textContent = twisty + column.text(entry);
          } else {
            cell.textContent = column.text(entry);
          }
        });
      },
    };
  }

  private layoutColumns(): void {
    const shown = COLUMNS.filter((c) => !this.hidden.has(c.field));
    const flex = this.nameWidth ? `${this.nameWidth}px` : 'minmax(200px, 1fr)';
    this.host.style.setProperty(
      '--cols',
      shown.map((c) => (c.width === 'flex' ? flex : `${c.width}px`)).join(' '),
    );
    const min = shown.reduce(
      (sum, c) => sum + (c.width === 'flex' ? (this.nameWidth ?? 200) : c.width),
      0,
    );
    this.host.style.setProperty('--min-width', `${min}px`);
    this.head.replaceChildren(
      ...shown.map((c) => {
        const cell = document.createElement('div');
        cell.className = 'c';
        cell.textContent = c.title;
        return cell;
      }),
    );
  }

  private show(toggled?: TimeOrderRow['id']): void {
    this.view.setRows(this.store.snapshot().rows, toggled);
  }

  async expandAll(): Promise<void> {
    await this.store.expandAll();
    this.show();
  }

  async collapseAll(): Promise<void> {
    await this.store.collapseAll();
    this.show();
  }

  async sortSelfDesc(): Promise<void> {
    await this.store.setSort(
      sortComparator<TimeOrderRow>({ value: (r) => r.duration.self }, 'desc'),
    );
    this.show();
  }

  async clearSort(): Promise<void> {
    await this.store.setSort(null);
    this.show();
  }

  async setDetailFilter(on: boolean): Promise<void> {
    await this.store.setFilters(on ? [detail] : []);
    this.show();
  }

  async goTo(target: LogEvent): Promise<void> {
    const path: number[] = [];
    for (let e: LogEvent | null = target; e?.parent; e = e.parent) {
      path.push(e.eventIndex);
    }
    const index = await this.store.reveal(path.reverse());
    this.show();
    if (index >= 0) {
      this.view.scrollToIndex(index);
    }
  }

  async find(text: string): Promise<number> {
    const query = { text };
    const shown = COLUMNS.filter((c) => !this.hidden.has(c.field)).map((c) => c.text);
    const result = await this.store.find(query, shown);
    const pattern = findPattern(query);
    if (result && pattern) {
      this.view.setFind({ result, pattern, current: 0 });
    }
    return result?.total ?? -1;
  }

  async exportCsv(): Promise<number> {
    const text = await this.store.exportText(
      COLUMNS.map((c) => ({ title: c.title, value: c.text })),
      { format: 'csv' },
    );
    return text?.length ?? -1;
  }

  setColumnVisible(field: string, visible: boolean): void {
    if (visible) {
      this.hidden.delete(field);
    } else {
      this.hidden.add(field);
    }
    this.layoutColumns();
    this.view.repaint();
  }

  setNameWidth(px: number): void {
    // One track changes: rows lay out again without a repaint.
    this.nameWidth = px;
    this.layoutColumns();
  }

  scroller(): HTMLElement {
    return this.scrollEl;
  }

  visibleRowCount(): number {
    return this.store.snapshot().rows.size;
  }
}
