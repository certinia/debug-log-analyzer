/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import {
  html,
  LitElement,
  nothing,
  type CSSResultGroup,
  type PropertyValues,
  type TemplateResult,
} from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { createRef, ref } from 'lit/directives/ref.js';
import { styleMap } from 'lit/directives/style-map.js';

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
import { browserScheduler, fontOf, GridView, textWidth } from '../render/index.js';
import type { GridColumn } from './column.js';
import { gridKey } from './keyboard.js';
import { litPainter, total } from './painter.js';
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

/** The rows or shown columns changed, so find's match numbers no longer hold. */
export interface GridReshapeDetail {
  /** `sort` from the header; `columns` when the shown columns change; `filter` on new filters or a refresh; `group` on a new grouping. */
  reason: 'sort' | 'columns' | 'filter' | 'group';
}

export interface GridColumnDetail {
  /** The column's `id`. */
  column: string;
}

export interface GridHeaderContextDetail extends GridColumnDetail {
  event: MouseEvent;
}

export interface GridColumnResizeDetail extends GridColumnDetail {
  width: number;
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

const shown = <R>(columns: readonly GridColumn<R>[]): GridColumn<R>[] =>
  columns.filter((column) => !column.hidden);

const shownIds = <R>(columns: readonly GridColumn<R>[] | undefined): string[] =>
  shown(columns ?? []).map((column) => column.id);

const sameTarget = <R>(a: RowTarget<R> | null, b: RowTarget<R>): boolean =>
  a instanceof Group ? b instanceof Group && a.key === b.key : !(b instanceof Group) && a === b;

const MIN_WIDTH = 40;

const minWidthOf = <R>(column: GridColumn<R>): number => column.minWidth ?? MIN_WIDTH;

const px = (value: string): number => Number.parseFloat(value) || 0;

/** The width a cell needs to show its text on one line, with its padding and twisty. */
function naturalWidth(cell: HTMLElement): number {
  const style = getComputedStyle(cell);
  const twisty = cell.querySelector<HTMLElement>('.twisty')?.offsetWidth ?? 0;
  const text = textWidth([cell.textContent?.trim() ?? ''], fontOf(cell));
  const padded = text + twisty + px(style.paddingInlineStart) + px(style.paddingInlineEnd);
  // A template cell, such as a bar, may hold no text but still need room.
  return Math.ceil(Math.max(padded, cell.scrollWidth));
}

/**
 * A virtualised tree grid. Set `columns` and `source`; it sorts from its header, and the
 * keyboard moves, opens and closes rows. Events bubble but stay inside the host's shadow
 * root: `lv-grid-select`, `lv-grid-locate` (hover), `lv-grid-context`,
 * `lv-grid-header-context`, `lv-grid-column-resize`, `lv-grid-find-results`,
 * `lv-grid-reshape` and `lv-grid-expand` (a data row the user opened).
 */
@customElement('lv-grid')
export class LvGrid<R extends object = object> extends LitElement {
  static styles: CSSResultGroup = gridStyles;

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

  /** Extra classes for a data row, such as one a host style colours by. */
  @property({ attribute: false })
  rowClass: ((row: R) => string | undefined) | null = null;

  /** A row's height before it is measured. */
  @property({ type: Number, attribute: 'row-height' })
  rowHeight = 24;

  /** A data row's lines of text, so a tall row has its height before it is drawn. Read when the grid first shows. */
  @property({ attribute: false })
  rowLines: ((row: R) => number) | null = null;

  /** Copy writes each row's tree under it; off, top-level rows only. */
  @property({ type: Boolean, attribute: 'copy-tree' })
  copyTree = true;

  /** How long steps share the thread. Read when the first `source` is set. */
  @property({ attribute: false })
  scheduler: Scheduler = browserScheduler;

  /** The sorted column. The header sets it too. */
  @property({ attribute: false })
  sort: GridSort | null = null;

  /** Keeps the first shown column in view on a horizontal scroll. */
  @property({ type: Boolean, attribute: 'freeze-first', reflect: true })
  freezeFirst = false;

  /** Where the footer sits when the rows do not fill the grid: its bottom edge, or under the last row. */
  @property({ attribute: 'footer-position', reflect: true })
  footerPosition: 'bottom' | 'rows' = 'bottom';

  /** What the body shows when no row passes the filters and no build runs, such as "No SOQL queries found". */
  @property({ attribute: false })
  placeholder: string | null = null;

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
  // Goes up with each find and clear, so a find still running sees it is stale.
  private searches = 0;
  /** Widths the user set, by column id. They win over a column's own `width`. */
  private readonly widths = new Map<string, number>();
  private readonly scrollerRef = createRef<HTMLDivElement>();
  private readonly bodyRef = createRef<HTMLDivElement>();

  constructor() {
    super();
    this.addController({
      hostConnected: () => this.view?.connect(),
      hostDisconnected: () => this.view?.disconnect(),
    });
  }

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
   * Runs the filters and column calcs again, for a filter or calc that reads state that
   * changed, such as a time window.
   */
  async refresh(): Promise<void> {
    // Only a filter or a group order by a total can move rows; with neither, matches hold.
    if (this.filters.length || this.groupBy) {
      this.emit<GridReshapeDetail>('lv-grid-reshape', { reason: 'filter' });
    }
    await this.store?.refresh();
  }

  /**
   * Opens each ancestor on `path` (keys from the root down), then scrolls the row to the
   * middle and selects it. False when no row on the path is shown. With `scrollIfVisible`
   * false, a row already in view whole stays where it is.
   */
  async goTo(
    path: readonly RowKey[],
    { scrollIfVisible = true }: { scrollIfVisible?: boolean } = {},
  ): Promise<boolean> {
    const index = (await this.store?.reveal(path)) ?? -1;
    if (index < 0) {
      return false;
    }
    await this.updateComplete;
    if (scrollIfVisible || !this.inView(index)) {
      this.view?.scrollToIndex(index);
    }
    this.select(this.targetAt(index), index);
    return true;
  }

  /** Moves keyboard focus to the grid, so its keys and copy work. */
  override focus(options?: FocusOptions): void {
    this.scrollerRef.value?.focus(options);
  }

  /** Clears the selection and reports it in `lv-grid-select`. Does nothing when no row is selected. */
  deselect(): void {
    if (this.selected !== null) {
      this.select(null);
    }
  }

  /**
   * Searches the text of every shown column with a `text`, over every row that passes the
   * filters, open or not. Marks the matches and reports the total in `lv-grid-find-results`.
   */
  async find(query: FindQuery): Promise<number> {
    const cells = this.visibleColumns().flatMap((column) => (column.text ? [column.text] : []));
    const search = ++this.searches;
    const result = await this.store?.find(query, cells);
    const pattern = findPattern(query);
    if (!result || search !== this.searches) {
      return -1;
    }
    this.found = pattern ? { result, pattern, current: -1 } : null;
    this.view?.setFind(this.found);
    this.emit<GridFindDetail>('lv-grid-find-results', { total: result.total });
    return result.total;
  }

  /**
   * Opens the way to match `match` (numbered from 0) and marks it current. A row out of
   * view whole scrolls to the middle; one in view stays where it is. -1 marks no match
   * current, as when the current match is in another grid.
   */
  async setCurrentMatch(match: number): Promise<void> {
    const found = this.found;
    if (!found || match < -1 || match >= found.result.total) {
      return;
    }
    found.current = match;
    if (match < 0) {
      this.view?.setFind(found);
      return;
    }
    const index = (await this.store?.reveal(found.result.pathOf(match))) ?? -1;
    await this.updateComplete;
    if (index >= 0 && !this.inView(index)) {
      this.view?.scrollToIndex(index);
    }
    this.view?.setFind(found);
  }

  clearFind(): void {
    this.searches++;
    this.found = null;
    this.view?.setFind(null);
  }

  /** The shown columns' text for every row that passes the filters, open or not. */
  async exportText(options: ExportOptions): Promise<string | null> {
    const columns = this.visibleColumns().flatMap((column) => {
      const value = column.exportText ?? column.text;
      return value ? [{ title: column.title, value }] : [];
    });
    return (await this.store?.exportText(columns, options)) ?? null;
  }

  /**
   * Sets a column's width in pixels, no less than its `minWidth`, over its own `width`.
   * Only the column tracks change: no row paints again.
   */
  setColumnWidth(id: string, width: number): void {
    const column = this.columns.find((c) => c.id === id);
    if (column) {
      this.widths.set(id, Math.max(Math.round(width), minWidthOf(column)));
      this.requestUpdate();
    }
  }

  /** Copies what `exportText` gives, tab-separated, as Ctrl/Cmd+C on the grid does. */
  async copy(): Promise<void> {
    const text = await this.exportText({ format: 'tsv', tree: this.copyTree });
    if (text !== null) {
      await navigator.clipboard.writeText(text);
    }
  }

  protected willUpdate(changed: PropertyValues): void {
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
      this.emit<GridReshapeDetail>('lv-grid-reshape', { reason: 'filter' });
    }
    if (changed.has('groupBy')) {
      void store.setGroupBy(this.groupBy);
      this.emit<GridReshapeDetail>('lv-grid-reshape', { reason: 'group' });
    }
    if ((changed.has('columns') || changed.has('sort')) && this.calcsChanged()) {
      void store.setCalcs(this.calcs);
    }
    if (changed.has('sort') || changed.has('columns')) {
      void this.applySort();
    }
    if (
      changed.has('columns') &&
      itemsChanged(shownIds(this.columns), shownIds(changed.get('columns')))
    ) {
      this.emit<GridReshapeDetail>('lv-grid-reshape', { reason: 'columns' });
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
    } else if (changed.has('columns') || changed.has('marked') || changed.has('rowClass')) {
      this.view?.repaint();
    }
  }

  protected render(): TemplateResult {
    const columns = this.visibleColumns();
    const totals = this.data.snapshot?.totals ?? {};
    const footer = columns.some((column) => column.calc || column.footer !== undefined);
    const size = this.data.snapshot?.rows.size ?? 0;
    return html`<div
      class="scroller"
      role="treegrid"
      tabindex="0"
      aria-rowcount=${size + (footer ? 2 : 1)}
      aria-busy=${this.data.snapshot?.busy ?? false}
      style=${styleMap(this.tracks(columns))}
      ${ref(this.scrollerRef)}
      @keydown=${this.onKey}
    >
      <div class="busy"></div>
      <div class="row head" role="row" aria-rowindex="1">
        ${columns.map((column) => this.headerCell(column))}
      </div>
      ${
        size === 0 && !this.data.snapshot?.busy && this.placeholder !== null
          ? html`<div class="placeholder" role="status">${this.placeholder}</div>`
          : nothing
      }
      <div
        class="body"
        ${ref(this.bodyRef)}
        @mousedown=${this.onMouseDown}
        @click=${this.onClick}
        @contextmenu=${this.onContextMenu}
        @pointerover=${this.onHover}
        @pointerleave=${this.onLeave}
      ></div>
      ${
        footer
          ? html`<div class="row foot" role="row" aria-rowindex=${size + 2}>
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
      title=${column.description ?? column.title}
      aria-sort=${ariaSort}
      ?data-sortable=${column.sort !== undefined}
      @click=${(e: MouseEvent) => this.onHeaderClick(e, column)}
      @contextmenu=${(e: MouseEvent) =>
        this.emit<GridHeaderContextDetail>('lv-grid-header-context', {
          column: column.id,
          event: e,
        })}
    >
      <span class="title"
        >${column.title}${
          column.sort ? html`<span class="sorter" aria-hidden="true"></span>` : nothing
        }</span
      >
      ${
        column.resizable === false
          ? nothing
          : html`<span
              class="resize"
              @pointerdown=${(e: PointerEvent) => this.startResize(e, column)}
              @dblclick=${(e: MouseEvent) => this.fitColumn(e, column)}
            ></span>`
      }
    </div>`;
  }

  private onHeaderClick(e: MouseEvent, column: GridColumn<R>): void {
    if (!(e.target as Element).closest('.resize')) {
      this.cycleSort(column);
    }
  }

  /** Drags the header edge; pointer capture keeps the drag on the handle off its column. */
  private startResize(e: PointerEvent, column: GridColumn<R>): void {
    const handle = e.currentTarget as HTMLElement;
    const head = handle.parentElement;
    if (e.button !== 0 || !head) {
      return;
    }
    e.preventDefault();
    const from = head.getBoundingClientRect().width;
    const x = e.clientX;
    handle.setPointerCapture(e.pointerId);
    const move = (m: PointerEvent): void => this.setColumnWidth(column.id, from + m.clientX - x);
    const end = (): void => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      this.resized(column);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }

  /** Sizes a column to the widest of its header and its painted cells. */
  private fitColumn(e: MouseEvent, column: GridColumn<R>): void {
    const head = (e.currentTarget as HTMLElement).parentElement;
    const at = this.visibleColumns().indexOf(column);
    const rows = [...(this.bodyRef.value?.children ?? [])] as HTMLElement[];
    const cells = rows.flatMap((row) => {
      const cell = row.hidden ? undefined : row.children[at];
      return cell instanceof HTMLElement ? [cell] : [];
    });
    const widest = Math.max(...[head, ...cells].map((cell) => (cell ? naturalWidth(cell) : 0)));
    this.setColumnWidth(column.id, widest);
    this.resized(column);
  }

  private resized(column: GridColumn<R>): void {
    const width = this.widths.get(column.id);
    if (width !== undefined) {
      this.emit<GridColumnResizeDetail>('lv-grid-column-resize', { column: column.id, width });
    }
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

  /**
   * Collects the calcs of the shown columns, and of the sorted one, which orders the groups;
   * true when any differs from the last set. A hidden column's total is never read.
   */
  private calcsChanged(): boolean {
    const next: Record<string, NonNullable<GridColumn<R>['calc']>> = {};
    for (const column of this.columns) {
      if (column.calc && (!column.hidden || column.id === this.sort?.column)) {
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
    return shown(this.columns);
  }

  /**
   * One track per shown column, so header, rows and footer line up. They sit on the
   * scroller, not the host: a host's inline style belongs to whoever places it.
   */
  private tracks(columns: readonly GridColumn<R>[]): Record<string, string> {
    const widths = columns.map((column) => {
      const width = this.widths.get(column.id) ?? column.width;
      return typeof width === 'number' ? Math.max(width, minWidthOf(column)) : null;
    });
    const tracks = columns.map((column, i) => {
      const width = widths[i];
      return width === null || width === undefined
        ? `minmax(${minWidthOf(column)}px, 1fr)`
        : `${width}px`;
    });
    const minWidth = columns.reduce((sum, column, i) => sum + (widths[i] ?? minWidthOf(column)), 0);
    return { '--grid-cols': tracks.join(' '), '--grid-min-width': `${minWidth}px` };
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
      lines: this.rowLines ?? undefined,
      lineHeight: () => this.treeLineHeight(),
      rowIndexStart: 2,
      painter: litPainter(() => ({
        columns: this.columns,
        isSelected: (target) => sameTarget(this.selected, target),
        marked: this.marked,
        rowClass: this.rowClass,
      })),
    });
    this.view.setFind(this.found);
    this.requestUpdate();
  }

  /** The height a further line of tree cell text adds, from a hidden 1-line and 2-line cell. */
  private treeLineHeight(): number {
    const body = this.bodyRef.value;
    if (!body) {
      return 0;
    }
    const probe = document.createElement('div');
    probe.className = 'cell tree';
    probe.style.cssText = 'position: absolute; visibility: hidden; white-space: pre;';
    probe.textContent = 'x';
    body.append(probe);
    const one = probe.getBoundingClientRect().height;
    probe.textContent = 'x\nx';
    const two = probe.getBoundingClientRect().height;
    probe.remove();
    return two - one;
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
    const opened = (await this.store?.toggle(target, expanded)) ?? false;
    // Read the row after the toggle: the rows on screen can be older than the store's.
    const rows = this.store?.snapshot().rows;
    const entry = opened && rows ? rows.rowAt(rows.indexOf(target)) : undefined;
    if (entry !== undefined && !(entry instanceof Group)) {
      this.emit<GridRowDetail<R>>('lv-grid-expand', { row: entry });
    }
  }

  /** Whether the painted row at `index` shows whole, between the header and the totals. */
  private inView(index: number): boolean {
    const scroller = this.scrollerRef.value;
    const row = this.bodyRef.value?.querySelector<HTMLElement>(
      `:scope > [data-index="${index}"]:not([hidden])`,
    );
    if (!scroller || !row) {
      return false;
    }
    const box = row.getBoundingClientRect();
    const frame = scroller.getBoundingClientRect();
    const top = scroller.querySelector(':scope > .head')?.getBoundingClientRect().bottom;
    const bottom = scroller.querySelector(':scope > .foot')?.getBoundingClientRect().top;
    return box.top >= (top ?? frame.top) && box.bottom <= (bottom ?? frame.bottom);
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

  private isToggle(e: Event, index: number): boolean {
    return (
      this.targetAt(index) instanceof Group || !!(e.target as Element).closest('[data-toggle]')
    );
  }

  /** A second press on a twisty is another toggle, not a word to select. */
  private readonly onMouseDown = (e: MouseEvent): void => {
    const index = this.indexFrom(e);
    if (e.detail > 1 && index >= 0 && this.isToggle(e, index)) {
      e.preventDefault();
    }
  };

  private readonly onClick = (e: MouseEvent): void => {
    const index = this.indexFrom(e);
    if (index < 0) {
      return;
    }
    const target = this.targetAt(index);
    if (target === null) {
      return;
    }
    if (this.isToggle(e, index)) {
      void this.toggleAt(index);
    } else if (window.getSelection()?.type === 'Range') {
      // A drag that selected text is a copy in the making, not a click on a row.
      return;
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
