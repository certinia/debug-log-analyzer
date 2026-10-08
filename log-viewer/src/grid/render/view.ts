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
import { capture, restore, type Restore, type ShownRow } from './anchor.js';
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
  /** False while the scroller has no height: a hidden tab, or detached. Nothing draws. */
  private visible = true;
  /** The browser drops `scrollTop` when the scroller's box goes, so it is put back on show. */
  private lastTop = 0;
  private pending: { rows: RowView<R>; toggled?: RowKey | Group<R> } | null = null;
  private pendingScroll: { index: number; align: 'center' | 'auto' } | null = null;
  /**
   * The place `setRows` kept, held while the rows around it are measured over the next
   * frames, until the user scrolls. virtual-core corrects only rows above the viewport.
   */
  private pin: Restore = null;
  /** The view's own last write to `scrollTop`; any other value is the user's scroll. */
  private pinnedTop = Number.NaN;
  private readonly unobserve: () => void;
  // Not virtual-core's: it unobserves a row's old element, which the pool gave to another row.
  private readonly rowObserver: ResizeObserver | null;
  private syncOffset = (): void => {};

  constructor(options: GridViewOptions<R>) {
    this.options = options;
    this.virtualizer = new Virtualizer<HTMLElement, HTMLElement>({
      count: 0,
      getScrollElement: () => options.scroller,
      estimateSize: () => options.rowHeight,
      overscan: options.overscan ?? 10,
      scrollToFn: elementScroll,
      observeElementRect,
      observeElementOffset: (instance, cb) => {
        let seen = Number.NaN;
        this.syncOffset = () => {
          const top = options.scroller.scrollTop;
          if (top === seen) {
            return;
          }
          seen = top;
          // Its own adjustments are known to it; each sync re-places every row after the change.
          const known = (instance.scrollOffset ?? 0) + instance.scrollAdjustments;
          if (Math.abs(top - known) >= 1.5) {
            cb(top, instance.isScrolling);
          }
        };
        return observeElementOffset(instance, cb);
      },
      onChange: () => this.schedule(),
    });
    this.unmount = this.virtualizer._didMount();
    this.virtualizer._willUpdate();

    const { scroller } = options;
    const onScroll = (): void => {
      if (this.visible && scroller.clientHeight > 0) {
        this.lastTop = scroller.scrollTop;
      }
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(([entry]) => this.setVisible((entry?.contentRect.height ?? 0) > 0));
    observer?.observe(scroller);
    this.rowObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver((entries) => {
            for (const entry of entries) {
              const el = entry.target as HTMLElement;
              this.measure(el, Math.round(entry.borderBoxSize[0]?.blockSize ?? 0));
            }
          });
    this.unobserve = () => {
      observer?.disconnect();
      this.rowObserver?.disconnect();
      scroller.removeEventListener('scroll', onScroll);
    };
  }

  /**
   * Shows `rows`. The user's place is kept: an edge they were at, else `toggled` where it
   * was, else the row across the middle of the viewport or its nearest shown ancestor.
   */
  setRows(rows: RowView<R>, toggled?: RowKey | Group<R>): void {
    if (!this.visible) {
      this.pending = { rows, toggled: toggled ?? this.pending?.toggled };
      return;
    }
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
      this.setPin(before && restore(before, rows, toggled));
      // Tall enough for the pinned place before the first paint, so the write is not clamped.
      this.options.body.style.height = `${this.virtualizer.getTotalSize()}px`;
      this.holdPin();
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
    if (!this.visible) {
      this.pendingScroll = { index, align };
      return;
    }
    this.setPin(null);
    this.virtualizer.scrollToIndex(index, { align });
  }

  /** Call when anything above the body, like the header, changes height. */
  remeasure(): void {
    if (!this.visible) {
      return;
    }
    this.layout(this.rows?.size ?? 0);
    this.draw();
  }

  /** The element painting the row at `index`, while it is on screen. */
  elementAt(index: number): HTMLElement | undefined {
    return this.painted.get(index);
  }

  /** Stops the view and removes its rows; the body can take a new view. */
  destroy(): void {
    this.unmount();
    this.unobserve();
    this.highlighter.clear();
    this.pending = null;
    this.pendingScroll = null;
    this.setPin(null);
    this.rows = null;
    this.painted.clear();
    this.spare.length = 0;
    this.stale.clear();
    this.options.body.replaceChildren();
  }

  private layout(count: number): void {
    const { body } = this.options;
    const margin = body.offsetTop;
    const v = this.virtualizer;
    if (v.options.count !== count || v.options.scrollMargin !== margin) {
      v.setOptions({ ...v.options, count, scrollMargin: margin, scrollPaddingStart: margin });
    }
  }

  /**
   * Reads the rows in view from the scroller, not from the virtualizer's window: on show
   * the virtualizer has not yet seen the restored position or the new height.
   */
  private captureNow(rows: RowView<R>) {
    const { scroller } = this.options;
    const scrollTop = scroller.scrollTop;
    const height = scroller.clientHeight;
    // Refreshes `measurementsCache` with the heights measured since the last draw.
    this.virtualizer.getVirtualItems();
    const items = this.virtualizer.measurementsCache;
    let lo = 0;
    let hi = items.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if ((items[mid]?.end ?? 0) > scrollTop) {
        hi = mid;
      } else {
        lo = mid + 1;
      }
    }
    const shown: ShownRow[] = [];
    for (let i = lo; i < items.length; i++) {
      const item = items[i];
      if (!item || item.start >= scrollTop + height) {
        break;
      }
      shown.push({ index: item.index, top: item.start - scrollTop, height: item.size });
    }
    return capture(
      { scrollTop, maxScrollTop: scroller.scrollHeight - height, height },
      shown,
      rows,
    );
  }

  /** On show: puts back the scroll position, then shows the rows that came while hidden. */
  private setVisible(visible: boolean): void {
    if (visible === this.visible) {
      return;
    }
    this.visible = visible;
    if (!visible) {
      return;
    }
    this.options.scroller.scrollTop = this.lastTop;
    const pending = this.pending;
    this.pending = null;
    if (pending) {
      this.setRows(pending.rows, pending.toggled);
    } else {
      this.remeasure();
    }
    const scroll = this.pendingScroll;
    this.pendingScroll = null;
    if (scroll) {
      this.scrollToIndex(scroll.index, scroll.align);
    }
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
    if (!this.visible) {
      return;
    }
    if (this.drawing) {
      this.again = true;
      return;
    }
    this.drawing = true;
    try {
      do {
        this.again = false;
        this.drawOnce();
        if (this.holdPin()) {
          this.again = true;
        }
      } while (this.again);
    } finally {
      this.drawing = false;
    }
  }

  private setPin(pin: GridView<R>['pin']): void {
    this.pin = pin;
    this.pinnedTop = this.options.scroller.scrollTop;
    // While pinned, the pin is the one correction; two would move the rows twice.
    this.virtualizer.shouldAdjustScrollPositionOnItemSizeChange = pin ? () => false : undefined;
  }

  /** Scrolls the pinned place back where it was. True if the scroll moved. */
  private holdPin(): boolean {
    const pin = this.pin;
    if (!pin) {
      return false;
    }
    const v = this.virtualizer;
    const { scroller } = this.options;
    // Read here, not on the scroll event: that comes after the frame, and a draw before it
    // would undo the user's scroll.
    if (Math.abs(scroller.scrollTop - this.pinnedTop) >= 1) {
      this.setPin(null);
      return false;
    }
    // Refreshes `measurementsCache` with the heights measured since the last draw.
    v.getVirtualItems();
    const top = !('edge' in pin)
      ? (v.measurementsCache[pin.index]?.start ?? Number.NaN) - pin.top
      : pin.edge === 'top'
        ? 0
        : v.getTotalSize() - scroller.clientHeight;
    if (!Number.isFinite(top) || Math.abs(scroller.scrollTop - top) < 1) {
      return false;
    }
    const was = scroller.scrollTop;
    // Set first: the scroll event of the write must not read as the user's.
    this.pinnedTop = top;
    scroller.scrollTop = top;
    this.pinnedTop = scroller.scrollTop;
    this.syncOffset();
    // A write past the end is clamped: unmoved, so drawing again would loop for ever.
    return Math.abs(scroller.scrollTop - was) >= 1;
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
      // A new observation reports the size even when it did not change, as for a new row.
      this.rowObserver?.unobserve(el);
      this.rowObserver?.observe(el);
      // While scrolling, a layout here on each draw cost frames; the observer's comes free.
      if (!v.isScrolling) {
        this.measure(el, Math.round(el.getBoundingClientRect().height));
      }
    }
  }

  private measure(el: HTMLElement, size: number): void {
    const index = Number(el.dataset.index);
    // A spare row, or a hidden tab, has no box: 0 is no row's height.
    if (size === 0 || this.painted.get(index) !== el) {
      return;
    }
    // A row resized above the fold moves scrollTop by the change, from the offset of the
    // last scroll event. A scrollTop write since then would be undone: give it the live one.
    this.syncOffset();
    this.virtualizer.resizeItem(index, size);
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
