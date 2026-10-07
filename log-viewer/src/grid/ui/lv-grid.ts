/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { html, LitElement, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { createRef, ref } from 'lit/directives/ref.js';

import {
  findPattern,
  GridStore,
  Group,
  navigate,
  sortComparator,
  type Calcs,
  type ExpandPolicy,
  type ExportOptions,
  type FindQuery,
  type FindResult,
  type GroupBy,
  type RowFilter,
  type RowKey,
  type RowView,
  type Scheduler,
  type SortDirection,
  type TreeSource,
} from '../core/index.js';
import { browserScheduler, GridView } from '../render/index.js';
import type { CellContent, GridColumn } from './column.js';
import { gridKey } from './keyboard.js';
import { litPainter } from './painter.js';
import { StoreController } from './store-controller.js';
import { gridStyles } from './styles.js';

/** A data row's key, or a group: what can be selected, toggled or found again. */
export type RowTarget<R> = RowKey | Group<R>;

export interface GridSelectDetail<R> {
  /** The selected data row; null for a group row or no selection. */
  row: R | null;
  target: RowTarget<R> | null;
}

export interface GridRowDetail<R> {
  /** The data row; null for a group row or, on `lv-grid-locate`, for none. */
  row: R | null;
}

export interface GridContextDetail<R> extends GridRowDetail<R> {
  event: MouseEvent;
}

export interface GridFindDetail {
  total: number;
}

export interface GridSort {
  column: string;
  dir: SortDirection;
}

export interface GridReshapeDetail {
  reason: 'sort';
}

declare global {
  interface HTMLElementTagNameMap {
    'lv-grid': LvGrid;
  }
}

const NOTHING_MARKED: ReadonlySet<RowKey> = new Set();

/** Whether a list property holds other items, so the same items in a new array do nothing. */
const itemsChanged = (next: readonly unknown[], prev: readonly unknown[] | undefined): boolean =>
  !prev || next.length !== prev.length || next.some((item, i) => item !== prev[i]);

const sameTarget = <R>(a: RowTarget<R> | null, b: RowTarget<R>): boolean =>
  a instanceof Group ? b instanceof Group && a.key === b.key : !(b instanceof Group) && a === b;

const total = <R>(column: GridColumn<R>, value: number | undefined): CellContent =>
  value === undefined ? '' : (column.total?.(value) ?? String(value));

/**
 * A virtualised tree grid. Set `columns` and `source`; it sorts from its header, and the
 * keyboard moves, opens and closes rows. Events bubble but stay inside the host's shadow
 * root: `lv-grid-select`, `lv-grid-locate` (hover), `lv-grid-context`,
 * `lv-grid-find-results` and `lv-grid-reshape`.
 */
@customElement('lv-grid')
export class LvGrid<R extends object = object> extends LitElement {
  static styles = gridStyles;

  @property({ attribute: false })
  source: TreeSource<R> | null = null;

  @property({ attribute: false, hasChanged: itemsChanged })
  columns: readonly GridColumn<R>[] = [];

  @property({ attribute: false, hasChanged: itemsChanged })
  filters: readonly RowFilter<R>[] = [];

  @property({ attribute: false })
  groupBy: GroupBy<R> | null = null;

  /** Which rows start expanded. Read when the first `source` is set. */
  @property({ attribute: false })
  expanded: ExpandPolicy<R> = false;

  /** Rows to mark, like the row another view points at. */
  @property({ attribute: false })
  marked: ReadonlySet<RowKey> = NOTHING_MARKED;

  /** A row's height before it is measured. */
  @property({ type: Number, attribute: 'row-height' })
  rowHeight = 24;

  /** Copy writes each row's tree under it; off, top-level rows only. */
  @property({ type: Boolean, attribute: 'copy-tree' })
  copyTree = true;

  /** How long steps share the thread. Read when the first `source` is set. */
  @property({ attribute: false })
  scheduler: Scheduler = browserScheduler;

  /** The sorted column. The header sets it too. */
  @property({ attribute: false })
  sort: GridSort | null = null;

  private store: GridStore<R> | null = null;
  private readonly data = new StoreController<R>(this);
  private view: GridView<R> | null = null;
  private shown: RowView<R> | null = null;
  private calcs: Calcs<R> = {};
  private sortedBy: { sort: unknown; calc: unknown; dir: SortDirection } | null = null;
  /** The row a toggle came from, kept in place when the new rows show. */
  private toggled: RowTarget<R> | undefined;
  private selected: RowTarget<R> | null = null;
  /** Where the selection was last seen, to skip a search of every row. */
  private selectedAt = -1;
  private hovered = -1;
  private found: { result: FindResult<R>; pattern: RegExp; current: number } | null = null;
  private readonly scrollerRef = createRef<HTMLDivElement>();
  private readonly bodyRef = createRef<HTMLDivElement>();

  /** Resolves once every step started so far has run and its rows are shown. */
  async settled(): Promise<void> {
    await this.store?.settled();
    await this.updateComplete;
  }

  /** Opens every row. Groups stay as they are. */
  async expandAll(): Promise<void> {
    await this.store?.expandAll();
  }

  async collapseAll(): Promise<void> {
    await this.store?.collapseAll();
  }

  /**
   * Opens each ancestor on `path` (keys from the root down), then scrolls the row to the
   * middle and selects it. False when no row on the path is shown.
   */
  async goTo(path: readonly RowKey[]): Promise<boolean> {
    const index = (await this.store?.reveal(path)) ?? -1;
    if (index < 0) {
      return false;
    }
    await this.updateComplete;
    this.view?.scrollToIndex(index);
    this.select(this.targetAt(index), index);
    return true;
  }

  /**
   * Searches the text of every shown column with a `text`, over every row that passes the
   * filters, open or not. Marks the matches and reports the total in `lv-grid-find-results`.
   */
  async find(query: FindQuery): Promise<number> {
    const cells = this.visibleColumns().flatMap((column) => (column.text ? [column.text] : []));
    const result = await this.store?.find(query, cells);
    const pattern = findPattern(query);
    if (!result) {
      return -1;
    }
    this.found = pattern ? { result, pattern, current: -1 } : null;
    this.view?.setFind(this.found);
    this.emit<GridFindDetail>('lv-grid-find-results', { total: result.total });
    return result.total;
  }

  /** Opens the way to match `match` (numbered from 0), scrolls to it and marks it current. */
  async setCurrentMatch(match: number): Promise<void> {
    const found = this.found;
    if (!found || match < 0 || match >= found.result.total) {
      return;
    }
    found.current = match;
    const index = (await this.store?.reveal(found.result.pathOf(match))) ?? -1;
    await this.updateComplete;
    if (index >= 0) {
      this.view?.scrollToIndex(index);
    }
    this.view?.setFind(found);
  }

  clearFind(): void {
    this.found = null;
    this.view?.setFind(null);
  }

  /** The shown columns' text for every row that passes the filters, open or not. */
  async exportText(options: ExportOptions): Promise<string | null> {
    const columns = this.visibleColumns().flatMap((column) =>
      column.text ? [{ title: column.title, value: column.text }] : [],
    );
    return (await this.store?.exportText(columns, options)) ?? null;
  }

  /** Copies what `exportText` gives, tab-separated, as Ctrl/Cmd+C on the grid does. */
  async copy(): Promise<void> {
    const text = await this.exportText({ format: 'tsv', tree: this.copyTree });
    if (text !== null) {
      await navigator.clipboard.writeText(text);
    }
  }

  connectedCallback(): void {
    super.connectedCallback();
    if (this.hasUpdated && !this.view) {
      this.makeView();
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.view?.destroy();
    this.view = null;
    this.shown = null;
  }

  protected willUpdate(changed: PropertyValues): void {
    if (changed.has('columns')) {
      this.layoutColumns();
    }
    const store = this.store;
    if (!store) {
      if (this.source) {
        this.createStore(this.source);
      }
      return;
    }
    if (changed.has('source') && this.source) {
      void store.setSource(this.source);
    }
    if (changed.has('filters')) {
      void store.setFilters(this.filters);
    }
    if (changed.has('groupBy')) {
      void store.setGroupBy(this.groupBy);
    }
    if (changed.has('columns') && this.calcsChanged()) {
      void store.setCalcs(this.calcs);
    }
    if (changed.has('sort') || changed.has('columns')) {
      void this.applySort();
    }
  }

  protected firstUpdated(): void {
    this.makeView();
  }

  protected updated(changed: PropertyValues): void {
    const snapshot = this.data.snapshot;
    this.toggleAttribute('busy', snapshot?.busy ?? false);
    if (this.view && snapshot && snapshot.rows !== this.shown) {
      this.shown = snapshot.rows;
      this.view.setRows(snapshot.rows, this.toggled);
      this.toggled = undefined;
    } else if (changed.has('columns') || changed.has('marked')) {
      this.view?.repaint();
    }
  }

  protected render(): TemplateResult {
    const columns = this.visibleColumns();
    const totals = this.data.snapshot?.totals ?? {};
    const footer = columns.some((column) => column.calc || column.footer !== undefined);
    return html`<div
      class="scroller"
      role="treegrid"
      tabindex="0"
      aria-rowcount=${this.data.snapshot?.rows.size ?? 0}
      aria-busy=${this.data.snapshot?.busy ?? false}
      ${ref(this.scrollerRef)}
      @keydown=${this.onKey}
    >
      <div class="busy"></div>
      <div class="row head" role="row">${columns.map((column) => this.headerCell(column))}</div>
      <div
        class="body"
        ${ref(this.bodyRef)}
        @click=${this.onClick}
        @contextmenu=${this.onContextMenu}
        @pointerover=${this.onHover}
        @pointerleave=${this.onLeave}
      ></div>
      ${
        footer
          ? html`<div class="row foot" role="row">
              ${columns.map(
                (column) =>
                  html`<div class="cell ${column.align === 'end' ? 'end' : ''}" role="gridcell">
                    ${column.calc ? total(column, totals[column.id]) : (column.footer ?? nothing)}
                  </div>`,
              )}
            </div>`
          : nothing
      }
    </div>`;
  }

  private headerCell(column: GridColumn<R>): TemplateResult {
    const dir = this.sort?.column === column.id ? this.sort.dir : null;
    const ariaSort = !column.sort
      ? nothing
      : dir === 'asc'
        ? 'ascending'
        : dir === 'desc'
          ? 'descending'
          : 'none';
    return html`<div
      class="cell colhead ${column.align === 'end' ? 'end' : ''}"
      role="columnheader"
      aria-sort=${ariaSort}
      ?data-sortable=${column.sort !== undefined}
      @click=${() => this.cycleSort(column)}
    >
      ${column.title}
    </div>`;
  }

  /** Off, then the column's first direction, then the other, then off again. */
  private cycleSort(column: GridColumn<R>): void {
    if (!column.sort) {
      return;
    }
    const first = column.sortFirst ?? 'asc';
    const dir = this.sort?.column === column.id ? this.sort.dir : null;
    this.sort =
      dir === null
        ? { column: column.id, dir: first }
        : dir === first
          ? { column: column.id, dir: first === 'asc' ? 'desc' : 'asc' }
          : null;
    this.emit<GridReshapeDetail>('lv-grid-reshape', { reason: 'sort' });
  }

  /** Re-sorts only when the sort's inputs change: a re-sort of a large tree is not free. */
  private applySort(): Promise<void> | undefined {
    const sort = this.sort;
    const column = sort && this.columns.find((c) => c.id === sort.column);
    const by =
      sort && column?.sort ? { sort: column.sort, calc: column.calc, dir: sort.dir } : null;
    const last = this.sortedBy;
    if (by?.sort === last?.sort && by?.calc === last?.calc && by?.dir === last?.dir) {
      return undefined;
    }
    this.sortedBy = by;
    if (!sort || !column?.sort) {
      return this.store?.setSort(null);
    }
    const groups = column.calc
      ? sortComparator<Group<R>>({ value: (group) => group.totals[column.id] }, sort.dir)
      : null;
    return this.store?.setSort(sortComparator(column.sort, sort.dir), groups);
  }

  private createStore(source: TreeSource<R>): void {
    this.calcsChanged();
    this.store = new GridStore<R>(source, {
      scheduler: this.scheduler,
      expanded: this.expanded,
      calcs: this.calcs,
      groupBy: this.groupBy,
    });
    this.data.follow(this.store);
    if (this.filters.length) {
      void this.store.setFilters(this.filters);
    }
    if (this.sort) {
      void this.applySort();
    }
  }

  /** Collects the columns' calcs; true when any differs from the last set. */
  private calcsChanged(): boolean {
    const next: Record<string, NonNullable<GridColumn<R>['calc']>> = {};
    for (const column of this.columns) {
      if (column.calc) {
        next[column.id] = column.calc;
      }
    }
    const names = Object.keys(next);
    const same =
      names.length === Object.keys(this.calcs).length &&
      names.every((name) => this.calcs[name] === next[name]);
    this.calcs = next;
    return !same;
  }

  private visibleColumns(): GridColumn<R>[] {
    return this.columns.filter((column) => !column.hidden);
  }

  /** One track per shown column, on the host so header, rows and footer line up. */
  private layoutColumns(): void {
    const columns = this.visibleColumns();
    const tracks = columns.map((column) => {
      const min = column.minWidth ?? 40;
      return column.width === undefined || column.width === 'flex'
        ? `minmax(${min}px, 1fr)`
        : `${Math.max(column.width, min)}px`;
    });
    const minWidth = columns.reduce(
      (sum, column) =>
        sum + (typeof column.width === 'number' ? column.width : (column.minWidth ?? 40)),
      0,
    );
    this.style.setProperty('--grid-cols', tracks.join(' '));
    this.style.setProperty('--grid-min-width', `${minWidth}px`);
  }

  private makeView(): void {
    const scroller = this.scrollerRef.value;
    const body = this.bodyRef.value;
    if (!scroller || !body) {
      return;
    }
    this.view = new GridView<R>({
      scroller,
      body,
      rowHeight: this.rowHeight,
      painter: litPainter(() => ({
        columns: this.columns,
        isSelected: (target) => sameTarget(this.selected, target),
        marked: this.marked,
      })),
    });
    this.view.setFind(this.found);
    this.requestUpdate();
  }

  private targetAt(index: number): RowTarget<R> | null {
    const rows = this.shown;
    if (!rows || index < 0 || index >= rows.size) {
      return null;
    }
    const entry = rows.rowAt(index);
    return entry instanceof Group ? entry : rows.keyAt(index);
  }

  private indexOfSelected(): number {
    const rows = this.shown;
    const selected = this.selected;
    if (!rows || selected === null) {
      return -1;
    }
    const at = this.selectedAt;
    const there = this.targetAt(at);
    if (there !== null && sameTarget(selected, there)) {
      return at;
    }
    this.selectedAt = rows.indexOf(selected);
    return this.selectedAt;
  }

  private select(target: RowTarget<R> | null, index = -1): void {
    this.selected = target;
    this.selectedAt = index;
    this.view?.repaint();
    const entry = index >= 0 ? this.shown?.rowAt(index) : undefined;
    this.emit<GridSelectDetail<R>>('lv-grid-select', {
      row: entry !== undefined && !(entry instanceof Group) ? entry : null,
      target,
    });
  }

  private async toggleAt(index: number, expanded?: boolean): Promise<void> {
    const target = this.targetAt(index);
    if (target === null) {
      return;
    }
    this.toggled = target;
    await this.store?.toggle(target, expanded);
  }

  /** The index of the row element an event came from, or -1. */
  private indexFrom(e: Event): number {
    const row = (e.target as Element | null)?.closest<HTMLElement>('[role="row"]');
    return row?.dataset.index === undefined ? -1 : Number(row.dataset.index);
  }

  private dataRow(index: number): R | null {
    const entry = index >= 0 ? this.shown?.rowAt(index) : undefined;
    return entry === undefined || entry instanceof Group ? null : entry;
  }

  private readonly onClick = (e: MouseEvent): void => {
    // A drag that selected text is a copy in the making, not a click on a row.
    if (window.getSelection()?.type === 'Range') {
      return;
    }
    const index = this.indexFrom(e);
    if (index < 0) {
      return;
    }
    const target = this.targetAt(index);
    if (target === null) {
      return;
    }
    if (target instanceof Group || (e.target as Element).closest('[data-toggle]')) {
      void this.toggleAt(index);
    } else if (sameTarget(this.selected, target)) {
      this.select(null);
    } else {
      this.select(target, index);
    }
    this.scrollerRef.value?.focus({ preventScroll: true });
  };

  private readonly onKey = (e: KeyboardEvent): void => {
    // Keys from a control inside a cell are that control's.
    if (e.target !== this.scrollerRef.value) {
      return;
    }
    const key = gridKey(e);
    const rows = this.shown;
    if (!key || !rows) {
      return;
    }
    e.preventDefault();
    if (key === 'copy') {
      void this.copy();
      return;
    }
    const at = this.indexOfSelected();
    if (at < 0) {
      if (rows.size > 0 && key !== 'left' && key !== 'right') {
        const index = key === 'up' || key === 'end' ? rows.size - 1 : 0;
        this.select(this.targetAt(index), index);
        this.view?.scrollToIndex(index, 'auto');
      }
      return;
    }
    const intent = navigate(rows, at, key);
    if (intent?.kind === 'select') {
      this.select(this.targetAt(intent.index), intent.index);
      this.view?.scrollToIndex(intent.index, 'auto');
    } else if (intent) {
      void this.toggleAt(intent.index, intent.kind === 'expand');
    }
  };

  private readonly onContextMenu = (e: MouseEvent): void => {
    const index = this.indexFrom(e);
    if (index >= 0) {
      this.emit<GridContextDetail<R>>('lv-grid-context', { row: this.dataRow(index), event: e });
    }
  };

  private readonly onHover = (e: PointerEvent): void => {
    const index = this.indexFrom(e);
    if (index !== this.hovered) {
      this.hovered = index;
      this.emit<GridRowDetail<R>>('lv-grid-locate', { row: this.dataRow(index) });
    }
  };

  private readonly onLeave = (): void => {
    this.hovered = -1;
    this.emit<GridRowDetail<R>>('lv-grid-locate', { row: null });
  };

  /** Bubbles, but is not composed: it stays inside the host's shadow root. */
  private emit<T>(type: string, detail: T): void {
    this.dispatchEvent(new CustomEvent<T>(type, { detail, bubbles: true }));
  }
}
