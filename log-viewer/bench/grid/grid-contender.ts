/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * The grid's core and render layers on the Time Order rows, with plain text cells: what
 * the table itself costs, before the ui layer and the app's cell formatters.
 */
import type { ApexLog, SelfTotal } from '@apexdevtools/apex-log-parser';

import { logStoreFor } from '../../src/core/log/LogStore.js';
import { rowMetrics, type SelfTotalColumns } from '../../src/core/log/rowMetrics.js';
import { formatNsAsMs } from '../../src/core/utility/Duration.js';
import {
  costLimitsOf,
  governorCostOf,
  type GovernorUsage,
} from '../../src/features/call-tree/utils/GovernorCost.js';
import {
  TimeOrderSource,
  type TimeOrderNode,
} from '../../src/features/call-tree/utils/TimeOrderTree.js';
import { GridStore, Group, type CellText, type RowView } from '../../src/grid/core/index.js';
import { FIND_ATTR, GridView, type RowPainter } from '../../src/grid/render/index.js';
import { browserScheduler } from '../../src/grid/ui/index.js';
import type { Contender } from './contender.js';

interface Column {
  field: string;
  title: string;
  width: number | 'flex';
  text: CellText<TimeOrderNode>;
}

/** Each row's governor cost, worked out up front as the Time Order rows once held it. */
function governorCosts(source: TimeOrderSource): { avg: Float64Array; max: Float64Array } {
  const { index } = source;
  const m = rowMetrics(index);
  const costLimits = costLimitsOf(index.log.limits);
  const avg = new Float64Array(index.rowCount);
  const max = new Float64Array(index.rowCount);
  const at = (from: SelfTotalColumns<Int32Array | Float64Array>, row: number): SelfTotal => ({
    self: from.self[row]!,
    total: from.total[row]!,
  });
  for (let row = 0; row < index.rowCount; row++) {
    const usage: GovernorUsage = {
      dmlCount: at(m.dmlCount, row),
      soqlCount: at(m.soqlCount, row),
      soslCount: at(m.soslCount, row),
      dmlRowCount: at(m.dmlRowCount, row),
      soqlRowCount: at(m.soqlRowCount, row),
      soslRowCount: at(m.soslRowCount, row),
      heapAllocated: at(m.heapAllocated, row),
      heapGross: at(m.heapGross, row),
      heapPeak: m.heapPeak[row]!,
    };
    const [a, b] = governorCostOf(usage, costLimits);
    avg[row] = a ?? NaN;
    max[row] = b ?? NaN;
  }
  return { avg, max };
}

/** The plain text columns, read from the log index by row. */
export function columnsFor(source: TimeOrderSource): Column[] {
  const m = rowMetrics(source.index);
  const cost = governorCosts(source);
  const total =
    (from: SelfTotalColumns<Int32Array | Float64Array>) =>
    ({ row }: TimeOrderNode): string =>
      String(from.total[row]);
  const percent =
    (from: Float64Array) =>
    ({ row }: TimeOrderNode) =>
      Number.isNaN(from[row]) ? '—' : String(from[row]);
  return [
    { field: 'text', title: 'Name', width: 'flex', text: source.text },
    { field: 'namespace', title: 'Namespace', width: 117, text: source.namespace },
    { field: 'dmlCount.total', title: 'DML Count', width: 70, text: total(m.dmlCount) },
    { field: 'soqlCount.total', title: 'SOQL Count', width: 70, text: total(m.soqlCount) },
    { field: 'soslCount.total', title: 'SOSL Count', width: 70, text: total(m.soslCount) },
    { field: 'thrownCount.total', title: 'Throws', width: 77, text: total(m.thrownCount) },
    { field: 'dmlRowCount.total', title: 'DML Rows', width: 63, text: total(m.dmlRowCount) },
    { field: 'soqlRowCount.total', title: 'SOQL Rows', width: 63, text: total(m.soqlRowCount) },
    { field: 'soslRowCount.total', title: 'SOSL Rows', width: 63, text: total(m.soslRowCount) },
    { field: 'heapAllocated.total', title: 'Heap Net', width: 92, text: total(m.heapAllocated) },
    {
      field: 'heapPeak',
      title: 'Heap Peak',
      width: 100,
      text: ({ row }) => String(m.heapPeak[row]),
    },
    { field: 'governorCost', title: 'Gov Avg %', width: 71, text: percent(cost.avg) },
    { field: 'governorCostMax', title: 'Gov Peak %', width: 78, text: percent(cost.max) },
    {
      field: 'duration.total',
      title: 'Total Time (ms)',
      width: 140,
      text: ({ row }) => formatNsAsMs(m.duration.total[row]!),
    },
    {
      field: 'duration.self',
      title: 'Self Time (ms)',
      width: 140,
      text: ({ row }) => formatNsAsMs(m.duration.self[row]!),
    },
  ];
}

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

export class GridContender implements Contender {
  private store!: GridStore<TimeOrderNode>;
  private view!: GridView<TimeOrderNode>;
  private source!: TimeOrderSource;
  private columns: Column[] = [];
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

    this.source = new TimeOrderSource(await logStoreFor(log).logIndex());
    this.columns = columnsFor(this.source);
    this.layoutColumns();
    this.store = new GridStore<TimeOrderNode>(this.source, { scheduler: browserScheduler });
    this.view = new GridView<TimeOrderNode>({
      scroller: this.scrollEl,
      body,
      painter: this.painter(),
      rowHeight: 24,
    });
    await this.store.setFilters([this.source.details]);
    this.show();
  }

  private painter(): RowPainter<TimeOrderNode> {
    return {
      paint: (el: HTMLElement, index: number, rows: RowView<TimeOrderNode>) => {
        el.className = 'row';
        if (el.childElementCount !== this.columns.length) {
          el.replaceChildren(
            ...this.columns.map((column) => {
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
        this.columns.forEach((column, i) => {
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
    const shown = this.columns.filter((c) => !this.hidden.has(c.field));
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

  private show(toggled?: number): void {
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
    const { self } = this.source.index;
    await this.store.setSort({ value: ({ row }) => self[row]!, dir: 'desc' });
    this.show();
  }

  async clearSort(): Promise<void> {
    await this.store.setSort(null);
    this.show();
  }

  async setDetailFilter(on: boolean): Promise<void> {
    await this.store.setFilters(on ? [this.source.details] : []);
    this.show();
  }

  async goTo(path: readonly number[]): Promise<void> {
    const index = await this.store.reveal(path);
    this.show();
    if (index >= 0) {
      this.view.scrollToIndex(index);
    }
  }

  async find(text: string): Promise<number> {
    const query = { text };
    const shown = this.columns.filter((c) => !this.hidden.has(c.field)).map((c) => c.text);
    const result = await this.store.find(query, shown);

    if (result?.pattern) {
      this.view.setFind({ result, current: 0 });
    }
    return result?.total ?? -1;
  }

  async exportCsv(): Promise<number> {
    const text = await this.store.exportText(
      this.columns.map((c) => ({ title: c.title, value: c.text })),
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
