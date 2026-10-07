/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import {
  elementScroll,
  observeElementOffset,
  observeElementRect,
  Virtualizer,
} from '@tanstack/virtual-core';

import { Group, type FindResult, type RowKey, type RowView } from '../core/index.js';
import { capture, restore, type ShownRow } from './anchor.js';
import { FindHighlighter } from './highlight.js';

/** Fills a row element. Render places it and sets its ARIA; the content is the caller's. */
export interface RowPainter<R> {
  /** Paints the row at `index` into `el`, which may still hold another row's content. */
  paint(el: HTMLElement, index: number, rows: RowView<R>): void;
}

export interface GridViewOptions<R> {
  /** The element that scrolls. Its first rows may be a sticky header. */
  scroller: HTMLElement;
  /** Holds the rows. Render sets its height and positions rows inside it. */
  body: HTMLElement;
  painter: RowPainter<R>;
  /** A row's height before it is measured. */
  rowHeight: number;
  /** Rows painted beyond each edge of the viewport. Default 10. */
  overscan?: number;
  /** The `aria-rowindex` of the first row. Default 1; 2 under a header row. */
  rowIndexStart?: number;
}

/** The find a view marks: its result, the pattern it counted with and the current match. */
export interface FindMarks<R> {
  result: FindResult<R>;
  pattern: RegExp;
  current: number;
}

/**
 * The rows on screen: a window of a {@link RowView}, painted into a pool of row elements
 * that are reused as the window moves. Heights are measured as rows are painted, and the
 * position the user was at is kept across a change to the rows.
 */
export class GridView<R extends object> {
  private readonly options: GridViewOptions<R>;
  private readonly virtualizer: Virtualizer<HTMLElement, HTMLElement>;
  private readonly unmount: () => void;
  private rows: RowView<R> | null = null;
  /** Painted rows by index; repainted only when the rows change or `repaint` asks. */
  private readonly painted = new Map<number, HTMLElement>();
  private readonly spare: HTMLElement[] = [];
  private stale = new Set<HTMLElement>();
  private drawing = false;
  private again = false;
  private queued = false;
  private readonly highlighter = new FindHighlighter();
  private find: FindMarks<R> | null = null;

  constructor(options: GridViewOptions<R>) {
    this.options = options;
    this.virtualizer = new Virtualizer<HTMLElement, HTMLElement>({
      count: 0,
      getScrollElement: () => options.scroller,
      estimateSize: () => options.rowHeight,
      overscan: options.overscan ?? 10,
      scrollToFn: elementScroll,
      observeElementRect,
      observeElementOffset,
      onChange: () => this.schedule(),
    });
    this.unmount = this.virtualizer._didMount();
    this.virtualizer._willUpdate();
  }

  /**
   * Shows `rows`. The user's place is kept: an edge they were at, else `toggled` where it
   * was, else the row across the middle of the viewport or its nearest shown ancestor.
   */
  setRows(rows: RowView<R>, toggled?: RowKey | Group<R>): void {
    const before = this.rows?.size ? this.captureNow(this.rows) : null;
    this.rows = rows;
    for (const el of this.painted.values()) {
      this.stale.add(el);
    }
    // Held, so the rows paint once, at the restored position.
    this.drawing = true;
    try {
      this.layout(rows.size);
      // Heights are kept by index, which a sort or toggle hands to other rows. Keying them
      // by row cost a key lookup per row on each measure, since virtual-core repositions
      // every row after a measured one: a fast scroll dropped half its frames.
      this.virtualizer.measure();
      const target = before && restore(before, rows, toggled);
      const { scroller } = this.options;
      if (target && 'edge' in target) {
        scroller.scrollTop =
          target.edge === 'top' ? 0 : this.virtualizer.getTotalSize() - scroller.clientHeight;
      } else if (target) {
        const item = this.virtualizer.measurementsCache[target.index];
        if (item) {
          scroller.scrollTop = item.start - target.top;
        }
      }
    } finally {
      this.drawing = false;
    }
    this.draw();
  }

  /** Paints every row on screen again: for a change the rows do not show, like selection. */
  repaint(): void {
    for (const el of this.painted.values()) {
      this.stale.add(el);
    }
    this.draw();
  }

  /** Marks find matches in the rows on screen, and in each row painted after. */
  setFind(find: FindMarks<R> | null): void {
    this.find = find;
    for (const el of this.painted.values()) {
      this.markFind(el);
    }
  }

  /** Scrolls the row at `index` into view: to the middle, or only as far as it must. */
  scrollToIndex(index: number, align: 'center' | 'auto' = 'center'): void {
    this.virtualizer.scrollToIndex(index, { align });
  }

  /** Call when anything above the body, like the header, changes height. */
  remeasure(): void {
    this.layout(this.rows?.size ?? 0);
    this.draw();
  }

  /** The element painting the row at `index`, while it is on screen. */
  elementAt(index: number): HTMLElement | undefined {
    return this.painted.get(index);
  }

  destroy(): void {
    this.unmount();
    this.highlighter.clear();
  }

  private layout(count: number): void {
    const { body } = this.options;
    const margin = body.offsetTop;
    const v = this.virtualizer;
    if (v.options.count !== count || v.options.scrollMargin !== margin) {
      v.setOptions({ ...v.options, count, scrollMargin: margin, scrollPaddingStart: margin });
    }
  }

  private captureNow(rows: RowView<R>) {
    const { scroller } = this.options;
    const scrollTop = scroller.scrollTop;
    const height = scroller.clientHeight;
    const shown: ShownRow[] = this.virtualizer
      .getVirtualItems()
      .filter((item) => item.end > scrollTop && item.start < scrollTop + height)
      .map((item) => ({ index: item.index, top: item.start - scrollTop, height: item.size }));
    return capture(
      { scrollTop, maxScrollTop: scroller.scrollHeight - height, height },
      shown,
      rows,
    );
  }

  /**
   * One draw for a burst of changes. virtual-core reports each resized row on its own, and
   * each report repositions every row after it; drawing on each cost most of a fast
   * scroll's frames. A microtask still runs before the frame paints.
   */
  private schedule(): void {
    if (this.queued) {
      return;
    }
    this.queued = true;
    queueMicrotask(() => {
      this.queued = false;
      this.draw();
    });
  }

  /** Paints the window. Measuring a row can move the window, so it loops until still. */
  private draw(): void {
    if (this.drawing) {
      this.again = true;
      return;
    }
    this.drawing = true;
    try {
      do {
        this.again = false;
        this.drawOnce();
      } while (this.again);
    } finally {
      this.drawing = false;
    }
  }

  private drawOnce(): void {
    const rows = this.rows;
    if (!rows) {
      return;
    }
    const v = this.virtualizer;
    const items = v.getVirtualItems();
    const wanted = new Set(items.map((item) => item.index));
    for (const [index, el] of this.painted) {
      if (!wanted.has(index) || index >= rows.size) {
        this.painted.delete(index);
        this.highlighter.unmark(el);
        el.hidden = true;
        this.spare.push(el);
      }
    }
    const margin = v.options.scrollMargin;
    const fresh: HTMLElement[] = [];
    for (const item of items) {
      let el = this.painted.get(item.index);
      if (!el) {
        el = this.spare.pop() ?? this.newRow();
        this.painted.set(item.index, el);
        this.stale.add(el);
      }
      if (this.stale.delete(el)) {
        this.paint(el, item.index, rows);
        fresh.push(el);
      }
      el.style.transform = `translateY(${item.start - margin}px)`;
    }
    this.options.body.style.height = `${v.getTotalSize()}px`;
    for (const el of fresh) {
      v.measureElement(el);
    }
  }

  private paint(el: HTMLElement, index: number, rows: RowView<R>): void {
    el.hidden = false;
    el.dataset.index = String(index);
    el.ariaRowIndex = String(index + (this.options.rowIndexStart ?? 1));
    el.ariaLevel = String(rows.depthAt(index) + 1);
    el.ariaExpanded = rows.hasChildrenAt(index) ? String(rows.isExpandedAt(index)) : null;
    this.options.painter.paint(el, index, rows);
    this.markFind(el);
  }

  private markFind(el: HTMLElement): void {
    const find = this.find;
    const index = Number(el.dataset.index);
    const entry = this.rows?.rowAt(index);
    const first =
      find && entry !== undefined && !(entry instanceof Group)
        ? find.result.firstMatchIn(entry)
        : -1;
    this.highlighter.mark(el, first, find?.pattern ?? null, find?.current ?? -1);
  }

  private newRow(): HTMLElement {
    const el = document.createElement('div');
    el.role = 'row';
    this.options.body.append(el);
    return el;
  }
}
