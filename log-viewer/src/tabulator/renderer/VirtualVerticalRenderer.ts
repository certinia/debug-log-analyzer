/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { Renderer } from 'tabulator-tables';

/**
 * Variable-height-aware vertical virtual renderer for Tabulator 6.4.0.
 *
 * Replaces tabulator's stock `VirtualDomVertical` (uniform-row-height model)
 * with a renderer that models per-row heights via two Fenwick trees:
 *
 *   cumHeight(i) = fenwickMeasured.prefix(i)
 *                + fenwickUnmeasuredCount.prefix(i) × estimateHeight
 *
 * The first tree sums measured row heights; the second counts unmeasured
 * rows. Together they give O(log n) `cumHeight(i)`, `totalHeight()`, and
 * `setHeight()`; `findRowAt(y)` is O(log² n) binary search over `cumHeight`.
 *
 * `estimateHeight` is locked for the duration of a single `_renderWindow()`
 * call — measurements update the Fenwick trees and running stats but do not
 * mutate `estimateHeight` until end-of-render. This makes paddingTop math
 * stable across the render (mid-render measurements provably can't change
 * `cumHeight(newTop)` because Fenwick updates are at indices ≥ newTop), so
 * single-pass is correct — no iteration loop, no convergence cap.
 *
 * `scrollRows` is RAF-coalesced: browser scroll events accumulate into one
 * `_renderWindow()` call per paint, keeping content rendering at native 60 Hz
 * regardless of scroll-event frequency.
 *
 * Pass as a class reference to the table option:
 *   renderVertical: VirtualVerticalRenderer
 */

interface RowInternals {
  initialized: boolean;
  heightInitialized: boolean;
  initialize: (force?: boolean, inFragment?: boolean) => void;
  normalizeHeight: (force?: boolean) => void;
  calcHeight: (force?: boolean) => void;
  setCellHeight: () => void;
  clearCellHeight: () => void;
  rendered: () => void;
  getElement: () => HTMLElement;
  getHeight: () => number;
  // Tabulator internal: clears heightInitialized + outerHeight so the next
  // calcHeight()/setCellHeight() pass re-measures from the DOM. Used by
  // stock VirtualDomVertical.rerenderRows and by our resize-driven height
  // invalidation (width-change wraps text differently → all heights stale).
  deinitializeHeight?: () => void;
  // Tabulator stores the row's data object on `.data`. The OBJECT REFERENCE
  // is a durable identity: DataTree's `generateChildren` creates new Row
  // wrappers on each expand but around the SAME child data objects, and
  // `Row.updateData` mutates `this.data` in place rather than replacing it
  // (tabulator_esm.mjs). So `row.data` keys the Stage 2b height cache without
  // requiring any id field — Tabulator's `options.index` ("id") is optional
  // and nothing guarantees the data carries one. Defensively optional: a row
  // without a data object is simply not cached and measured normally.
  data?: object;
}

interface RendererBase {
  table: {
    rowManager: {
      element: HTMLElement;
      tableElement: HTMLElement;
      getDisplayRows: () => RowInternals[];
      scrollHorizontal: (left: number) => void;
      // Tabulator internal: shows the placeholder element when the display
      // is empty (tabulator_esm.mjs RowManager). Stock VirtualDomVertical
      // calls this at the end of rerenderRows; we mirror that.
      tableEmpty?: () => void;
      // Tabulator internal: RowManager copies `options.renderVertical` into
      // this field at setRenderMode time (tabulator_esm.mjs:26706). When
      // `renderVertical` is a class, this becomes a class reference and
      // gets stringified into the `.tabulator-placeholder` element's
      // `tabulator-render-mode` attribute (tabulator_esm.mjs:26804). We
      // overwrite it with the string `'virtual'` in `initialize()`.
      renderMode?: string;
    };
    options: Record<string, unknown>;
  };
  elementVertical: HTMLElement;
  tableElement: HTMLElement;
  verticalFillMode: string;
  styleRow: (row: RowInternals, index: number) => void;
}

const DEFAULT_ESTIMATE_HEIGHT = 30;
const OVERSCAN_OPTION = 'variableHeightOverscanRows';
const LEGACY_BUFFER_OPTION = 'renderVerticalBuffer';
const OVERSCAN_MIN = 4;
const OVERSCAN_MAX = 16;

// Minimum holder-width delta (px) that counts as a real resize and invalidates
// measured row heights. Ignores subpixel layout jitter on retina displays.
const RESIZE_WIDTH_THRESHOLD_PX = 1;
// Idle period after the last resize event before we fire the O(n)
// `_invalidateMeasuredHeights` walk. During a resize-handle drag the
// ResizeObserver fires per-pixel (~60 Hz); without debouncing the deinit
// walk runs once per frame, far more expensive than the actual render.
const RESIZE_INVALIDATE_DEBOUNCE_MS = 120;

/**
 * Standard 1-indexed Fenwick (Binary Indexed) tree over a Float64Array.
 * Exposes 0-indexed external operations (so caller sees [0, n) row indices).
 *
 *   update(i, delta)        — adds delta at position i. O(log n).
 *   prefixSum(count)        — returns Σ values[0..count). O(log n).
 *   bulkInitConstant(value) — sets values[i] = value for all i. O(n).
 *   resetZero()             — sets all values to 0. O(n).
 *
 * The internal `tree` array is length n + 1; index 0 is unused.
 */
class Fenwick {
  private tree: Float64Array;
  private n: number;

  constructor(n: number) {
    this.n = n;
    this.tree = new Float64Array(n + 1);
  }

  size(): number {
    return this.n;
  }

  resize(n: number): void {
    this.n = n;
    this.tree = new Float64Array(n + 1);
  }

  resetZero(): void {
    this.tree.fill(0);
  }

  /**
   * Initialize as if `values[i] = value` for all i in [0, n). Uses the
   * identity `tree[i] = lowbit(i) × value` for constant arrays — O(n)
   * once, no n × log n cost.
   */
  bulkInitConstant(value: number): void {
    this.tree[0] = 0;
    for (let i = 1; i <= this.n; i++) {
      this.tree[i] = (i & -i) * value;
    }
  }

  update(i0: number, delta: number): void {
    if (delta === 0) {
      return;
    }
    let i = i0 + 1;
    while (i <= this.n) {
      this.tree[i] = (this.tree[i] ?? 0) + delta;
      i += i & -i;
    }
  }

  /** Σ values[0..count). count clamped to [0, n]. */
  prefixSum(count: number): number {
    let i = count;
    if (i > this.n) {
      i = this.n;
    } else if (i <= 0) {
      return 0;
    }
    let s = 0;
    while (i > 0) {
      s += this.tree[i] ?? 0;
      i -= i & -i;
    }
    return s;
  }
}

export class VirtualVerticalRenderer extends Renderer {
  // String tags read directly by RowManager (tabulator_esm.mjs:26706, :26855).
  renderMode = 'virtual';
  // 'fill' tells RowManager to call adjustTableSize() after our renders so the
  // container takes its size from the configured height/maxHeight.
  verticalFillMode = 'fill';

  // Fenwick A: sum of measured heights. For unmeasured rows the entry is 0.
  private fenwickMeasured = new Fenwick(0);
  // Fenwick B: count of unmeasured rows. Starts at 1 per row; goes to 0 when
  // that row is measured.
  private fenwickUnmeasuredCount = new Fenwick(0);
  // Shadow of measured per-row heights, used by setHeight to compute the
  // Fenwick delta on re-measurement. 0 for unmeasured rows.
  private measuredHeight: Float64Array = new Float64Array(0);
  // Whether each row has been measured. Uint8 because we only need 0/1.
  private isMeasured: Uint8Array = new Uint8Array(0);
  // Stage 2b: durable measured heights keyed by the row's DATA OBJECT
  // REFERENCE (not index, not an id field — Tabulator does not guarantee an
  // id). The data object survives expand/collapse (DataTree re-wraps the same
  // child data objects) and `updateData` (mutates in place), so it is a
  // stable identity for ANY Tabulator data. The Fenwick/index arrays above
  // are positional and rebuilt on every structural change; this cache
  // survives them: `rerenderRows` re-seeds the index arrays from here, so
  // rows measured once keep their real height across expand/collapse/sort/
  // filter instead of resetting to the estimate. WeakMap → entries are
  // garbage-collected with their data objects; "cleared" by reassignment on
  // `clearRows` (new dataset) and `_invalidateMeasuredHeights` (width change
  // → wrapping differs → heights stale).
  private dataHeights = new WeakMap<object, number>();

  private estimateHeight = DEFAULT_ESTIMATE_HEIGHT;
  private measuredSum = 0;
  private measuredCount = 0;
  // Stage 2a: the estimate is calibrated ONCE from the first painted window's
  // real measurements, then frozen. A drifting running mean is catastrophic at
  // scale — applied to all unmeasured rows via `_cumHeight`, a sub-0.1px change
  // re-prices hundreds of thousands of rows and swings `totalHeight` by 100k+
  // px mid-operation (relocating the window thousands of rows). A fixed
  // estimate keeps the coordinate space stable across renders; per-row measured
  // heights still refine accuracy locally via the Fenwick. Reset on `clearRows`
  // so a new dataset recalibrates.
  private estimateFrozen = false;

  // Snapshot of `estimateHeight` taken at the start of `_renderWindow` and
  // honoured by `_cumHeight` until the call returns. Keeps every cumHeight
  // probe inside one render call self-consistent even though `_setHeight`
  // mutates `measuredSum`/`measuredCount` during attach. Null outside a
  // render call so `_cumHeight` reads the live value (e.g. test helpers).
  private _lockedEstimate: number | null = null;

  private vDomTop = 0;
  private vDomBottom = -1; // inclusive; -1 = empty range
  private renderedRange: { top: number; bottom: number } = { top: 0, bottom: -1 };

  private rowsCountCached = 0;

  // RAF coalescing for scrollRows.
  private rafScheduled = false;

  // Width-change detection for resize-driven height invalidation. Text wrap
  // shifts when the holder width changes → all measured heights are stale.
  private lastClientWidth = 0;
  // Track clientHeight too so resize() can no-op when neither dimension
  // changed. Tabulator calls renderer.resize() from adjustTableSize on every
  // restoreRedraw cascade (e.g. after a plain row click); without this guard
  // we'd schedule a RAF _renderWindow that runs ONE FRAME later — visibly
  // shifting the rendered window after the click has already painted.
  private lastClientHeight = 0;
  private resizeObserver: ResizeObserver | null = null;
  // Debounce state for `_invalidateMeasuredHeights`. The deinit walk is O(n)
  // across every display row; firing it per-pixel of a resize-handle drag
  // dominates per-frame cost. We mark `resizePendingInvalidate=true` on
  // every width-change resize() and only run the walk once after
  // RESIZE_INVALIDATE_DEBOUNCE_MS of quiet.
  private resizeInvalidateTimer: ReturnType<typeof setTimeout> | null = null;
  private resizePendingInvalidate = false;

  // Set true while a `_renderWindow` triggered by user scrolling is running.
  // Used by `_renderWindowLocked` to skip `_flushEstimateUpdate` during
  // scrolls — matches stock VirtualDomVertical's sticky `vDomRowHeight`.
  // Without this, scrolling into rows whose heights differ from the current
  // estimate mid-scroll causes either a visible jump (no compensation) or a
  // tugged-against-user-input feel (the B5 compensation attempt that this
  // flag replaces).
  private inScrollDrivenRender = false;

  // Stage 2c: above-viewport measurement compensation (TanStack
  // `scrollAdjustments`). During a scroll-driven render, rows prepended above
  // the viewport get measured; each (real − previously-priced) delta would
  // shift all visible content by that amount. `_setHeight` accumulates the
  // deltas for rows above the viewport-top row (`renderVisTop`, set per
  // render); `_renderWindowLocked` applies the sum to scrollTop at the end of
  // the render so visible content stays pixel-stable. Mirrors stock
  // `_addTopRow`'s `vDomTopPad -= paddingAdjust` and TanStack's
  // `shouldAdjustScrollPositionOnItemSizeChange` default.
  private pendingScrollAdjust = 0;
  private renderVisTop = -1; // -1 = not in a scroll-driven render

  // Last scrollTop value we wrote programmatically (setAnchor / scrollToRow /
  // pre-render clamp / clearRows zero-out). When the browser's resulting
  // `scroll` event routes back into scrollRows() and `holder.scrollTop`
  // matches this value, the event is ours — suppress the settle timer + RAF
  // re-render that would otherwise fire 120 ms later with a freshly-flushed
  // estimateHeight and visibly shift the rendered window. Set to NaN when
  // there is no pending programmatic write (NaN !== anything, including
  // itself — safer than `null` because it can never equal a real scrollTop).
  private pendingProgrammaticScrollTop = NaN;

  // ---------------------------------------------------------------------------
  // Renderer lifecycle (called by RowManager)
  // ---------------------------------------------------------------------------

  initialize(): void {
    // Stock Tabulator bug workaround: when `renderVertical` is a class (as
    // with this renderer) RowManager sets its `renderMode` field to the
    // class reference itself (tabulator_esm.mjs:26706, inside
    // `setRenderMode`). That field is later written to the
    // `.tabulator-placeholder` element's `tabulator-render-mode` attribute
    // (tabulator_esm.mjs:26804), which stringifies the class — producing
    // garbage like `class VirtualVerticalRenderer ...` in the DOM.
    // Overwrite with the string `'virtual'` here, before the first
    // placeholder render. Our `initialize()` runs immediately after the
    // bad assignment (tabulator_esm.mjs:26709), so this is the earliest
    // safe point.
    const self = this._self();
    self.table.rowManager.renderMode = this.renderMode;

    // Seed lastClientWidth so the first real resize() call sees a meaningful
    // prev value and only invalidates on actual width changes.
    const holder = self.elementVertical;
    this.lastClientWidth = holder.clientWidth;
    this.lastClientHeight = holder.clientHeight;

    // ResizeObserver catches every holder resize, including ones tabulator's
    // outer redraw misses (sidebar toggle, flex parent resize without window
    // event). Routes through resize() so the width-change branch fires.
    if (typeof ResizeObserver !== 'undefined' && this.resizeObserver === null) {
      this.resizeObserver = new ResizeObserver(() => {
        this.resize();
      });
      this.resizeObserver.observe(holder);
    }
  }

  destroy(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.resizeInvalidateTimer !== null) {
      clearTimeout(this.resizeInvalidateTimer);
      this.resizeInvalidateTimer = null;
    }
    this.resizePendingInvalidate = false;
  }

  clearRows(): void {
    const tableElement = this._self().tableElement;
    while (tableElement.firstChild) {
      tableElement.removeChild(tableElement.firstChild);
    }
    tableElement.style.paddingTop = '0';
    tableElement.style.paddingBottom = '0';
    this.fenwickMeasured = new Fenwick(0);
    this.fenwickUnmeasuredCount = new Fenwick(0);
    this.measuredHeight = new Float64Array(0);
    this.isMeasured = new Uint8Array(0);
    this.dataHeights = new WeakMap(); // new dataset: previous heights are meaningless
    this.measuredSum = 0;
    this.measuredCount = 0;
    this.vDomTop = 0;
    this.vDomBottom = -1;
    this.renderedRange = { top: 0, bottom: -1 };
    this.rowsCountCached = 0;
    this.pendingProgrammaticScrollTop = 0;
    // New dataset: recalibrate the frozen estimate from its first window. Keep
    // the current estimateHeight as the seed until that first flush lands.
    this.estimateFrozen = false;
    this._self().elementVertical.scrollTop = 0;
    // Keep estimateHeight — useful seed for the next dataset.
  }

  renderRows(): void {
    // Only zero scrollTop on a truly fresh render — no prior rendered state.
    // After clearRows() (Tabulator's clear callback) rowsCountCached is 0,
    // so this guard cleanly distinguishes fresh-mount / setData from a
    // pipeline-driven re-render that routes through renderRows() instead
    // of rerenderRows() (renderMode-dependent in Tabulator core).
    if (this.rowsCountCached === 0) {
      this.pendingProgrammaticScrollTop = 0;
      this._self().elementVertical.scrollTop = 0;
    }
    this._renderWindow();
  }

  rerenderRows(callback?: () => void): void {
    // Renderer contract (Stage 2d): render + retain relative position ONLY.
    // Anchoring policy — which row to favour (clicked / middle / edge) — lives
    // in the AnchoringPolicy module, driven by the renderStarted /
    // renderComplete / dataTreeRow* events that bracket this call. With the
    // durable height cache rebuilt below (Stage 2b), a tree toggle leaves all
    // above-viewport cumHeight identical, so rendering at the browser-
    // preserved scrollTop already keeps the viewport stable; the policy
    // applies corrections on top, synchronously before paint.
    const self = this._self();
    const left = self.table.rowManager.element.scrollLeft;

    this._detachAllRendered();
    if (callback) {
      callback();
    }
    // Sort/filter/toggle changes row positions (and maybe count). Stage 2b:
    // rebuild the positional Fenwick from the durable data→height cache so
    // rows measured before keep their real height — `cumHeight`/`totalHeight`
    // stay accurate instead of resetting to the estimate.
    const rowsAfter = self.table.rowManager.getDisplayRows();
    this._rebuildIndexFromCache(rowsAfter);
    // Rendered rows still re-measure via _attachRanges Phase B–D (confirms /
    // refreshes the seeded height); off-screen cached rows keep their seeded
    // value until they next enter the window.
    for (const row of rowsAfter) {
      row.deinitializeHeight?.();
    }

    this._renderWindow();
    if (rowsAfter.length === 0) {
      // Empty display: mirror stock's `tableEmpty()` so the
      // `.tabulator-placeholder` element shows (tabulator_esm.mjs:25281).
      self.table.rowManager.tableEmpty?.();
    }

    // Mirror stock VirtualDomVertical.rerenderRows tail (tabulator_esm.mjs:25285):
    // sync horizontal scroll after vertical re-render.
    self.table.rowManager.scrollHorizontal(left);
  }

  scrollRows(_top: number, _dir: boolean): void {
    const holder = this._self().elementVertical;
    const top = holder.scrollTop;

    // Suppress scroll events triggered by our own programmatic scrollTop
    // writes (setAnchor / scrollToRow / pre-render clamp / clearRows /
    // renderRows zero-out). Each of those callers already re-rendered
    // synchronously; the echoed scroll event would just schedule a
    // redundant render that could fire AFTER state has shifted and
    // visibly move the rendered window (verified: a 1837px LayoutShift
    // attributable to this RAF in a tree-collapse profile capture).
    //
    // Use a 1 px tolerance, NOT exact equality. setAnchor's scrollTop
    // computations (`el.offsetTop - offsetFromHolderTop`,
    // `cumHeight(idx) - offset`) produce fractional values; browsers
    // round scrollTop on write (integer on most, 0.5 px on retina), so
    // the echoed scroll event reads a rounded value while
    // `pendingProgrammaticScrollTop` holds the unrounded original →
    // exact equality misses → suppression fails. One-shot — clear after
    // consuming. NaN naturally falls through (Math.abs(NaN) is NaN,
    // NaN < 1 is false), so the "no pending" case is not suppressed.
    if (Math.abs(top - this.pendingProgrammaticScrollTop) < 1) {
      this.pendingProgrammaticScrollTop = NaN;
      return;
    }
    this.pendingProgrammaticScrollTop = NaN;

    // RAF-coalesce: browser scroll events during a drag fire faster than the
    // paint rate. Doing a full _renderWindow per event is wasted work — only
    // the latest event's scrollTop matters by the next paint. Cap to one
    // render per RAF tick. Stock VirtualDomVertical doesn't need RAF
    // coalescing because its per-event op is one incremental add/remove;
    // ours is a from-scratch window render.
    if (this.rafScheduled) {
      return;
    }
    this.rafScheduled = true;
    requestAnimationFrame(() => {
      this.rafScheduled = false;
      // Mark this render as scroll-driven so _renderWindowLocked skips the
      // estimate flush. try/finally ensures the flag clears even if the
      // render throws.
      this.inScrollDrivenRender = true;
      try {
        this._renderWindow();
      } finally {
        this.inScrollDrivenRender = false;
      }
      // Mirror stock VirtualDomVertical.scrollRows: pipe horizontal scroll
      // through to the column manager (tabulator_esm.mjs:25288).
      const left = this._self().table.rowManager.element.scrollLeft;
      this._self().table.rowManager.scrollHorizontal(left);
    });
  }

  resize(): void {
    // Width change → text wrap differs → all measured heights are stale.
    // Stock VirtualDomVertical survives this because tabulator's outer
    // redraw(true) path calls rerenderRows() which calls deinitializeHeight()
    // on every rendered row. That path isn't guaranteed to fire on every
    // layout-affecting CSS change (sidebar toggle, flex parent resize without
    // window event), so our ResizeObserver routes here unconditionally and
    // we detect the width change ourselves.
    const cw = this._self().elementVertical.clientWidth;
    if (
      this.lastClientWidth !== 0 &&
      Math.abs(cw - this.lastClientWidth) > RESIZE_WIDTH_THRESHOLD_PX
    ) {
      // Defer the O(n) deinit walk to the trailing edge of the resize
      // gesture. During the drag, render with stale measurements — wraps may
      // be off by a line or two but it's not visible at 60 Hz, and the
      // trailing invalidate + re-render snaps everything correct once the
      // user releases.
      this.resizePendingInvalidate = true;
      if (this.resizeInvalidateTimer !== null) {
        clearTimeout(this.resizeInvalidateTimer);
      }
      this.resizeInvalidateTimer = setTimeout(() => {
        this.resizeInvalidateTimer = null;
        if (this.resizePendingInvalidate) {
          this.resizePendingInvalidate = false;
          this._invalidateMeasuredHeights();
          this._renderWindow();
        }
      }, RESIZE_INVALIDATE_DEBOUNCE_MS);
    }
    const ch = this._self().elementVertical.clientHeight;
    // Same subpixel threshold for both dimensions — retina layout jitter
    // can wiggle clientHeight by 0.5px without anything meaningful changing.
    const widthChanged = Math.abs(cw - this.lastClientWidth) > RESIZE_WIDTH_THRESHOLD_PX;
    const heightChanged = Math.abs(ch - this.lastClientHeight) > RESIZE_WIDTH_THRESHOLD_PX;
    this.lastClientWidth = cw;
    this.lastClientHeight = ch;

    // No-op guard: Tabulator calls renderer.resize() from adjustTableSize on
    // every restoreRedraw cascade (including plain row clicks). If neither
    // dimension actually changed AND no width-driven invalidate is pending,
    // there is nothing for the renderer to do — the previously-painted
    // window is still correct. Without this guard the RAF below schedules
    // a from-scratch _renderWindow that fires one paint later, visibly
    // shifting the rendered window after the click has already painted.
    if (!widthChanged && !heightChanged && !this.resizePendingInvalidate) {
      return;
    }

    // Window/container resize: the viewport may have grown past the
    // previously-rendered region. Our overscan (4–16 rows) is intentionally
    // small — much smaller than stock VirtualDomVertical's full-viewport
    // buffer — so a resize that enlarges the viewport easily exposes
    // paddingBottom as blank space below the rendered window. For fixedHeight
    // tables (height: '100%') tabulator's adjustTableSize does NOT auto-
    // trigger a re-render (tabulator_esm.mjs:26875 gates the resize-redraw
    // on !fixedHeight), so we have to do it ourselves.
    //
    // The Renderer base contract says "DO NOT RERENDER IN THIS FUNCTION"
    // (tabulator_esm.mjs:23558) — meaning synchronously. RAF-defer is safe
    // and also guarantees DOM measurements (clientHeight, scrollHeight) have
    // settled past whatever style writes adjustTableSize did before calling
    // resize(). Reusing `rafScheduled` collapses scroll-during-resize into a
    // single render per paint.
    if (this.rafScheduled) {
      return;
    }
    this.rafScheduled = true;
    requestAnimationFrame(() => {
      this.rafScheduled = false;
      this._renderWindow();
    });
  }

  /**
   * Wipe the height cache so the next render re-measures every row from the
   * DOM. Called when the holder width changes (text wrap may shift) or any
   * other event invalidates previously measured heights. Keeps
   * `estimateHeight` as a starting seed.
   *
   * Also flips currently-rendered rows back to `heightInitialized=false` via
   * Tabulator's `Row.deinitializeHeight()`, so the next `_attachRanges` Phase
   * B-D path measures them — without this, the guard at Phase B short-
   * circuits and we'd never feed heights back into the empty Fenwick.
   */
  private _invalidateMeasuredHeights(): void {
    this.measuredHeight.fill(0);
    this.isMeasured.fill(0);
    // Width changed → text wraps differently → every cached height is stale.
    // Drop the durable cache too (WeakMap → reassign), else the next rerender
    // would re-seed stale pre-resize heights.
    this.dataHeights = new WeakMap();
    this.fenwickMeasured.resetZero();
    this.fenwickUnmeasuredCount.resetZero();
    this.fenwickUnmeasuredCount.bulkInitConstant(1);
    this.measuredSum = 0;
    this.measuredCount = 0;
    // Every row — not just currently rendered — must be flipped back to
    // heightInitialized=false. Otherwise the Phase B–D guard in _attachRanges
    // takes the fast path for previously-rendered rows that enter the window
    // later, feeding stale (pre-width-change) heights back into the Fenwick.
    const rows = this._self().table.rowManager.getDisplayRows();
    for (const row of rows) {
      row.deinitializeHeight?.();
    }
  }

  scrollToRow(row: RowInternals): void {
    const idx = this._indexOfRow(row);
    if (idx < 0) {
      return;
    }
    this._resyncToRowsCount(false);
    const target = this._cumHeight(idx);
    this.pendingProgrammaticScrollTop = target;
    this._self().elementVertical.scrollTop = target;
    // Render synchronously — programmatic scrolls need to land before the
    // next user input. (Bypass the RAF coalescing in scrollRows.)
    this._renderWindow();
  }

  /**
   * Public: declaratively anchor a row at a given Y inside the holder.
   *
   * Single seam between this renderer and any external anchoring module
   * (e.g. opt-in AnchoringPolicy). After this call returns, the row's DOM
   * element sits at `offsetFromHolderTop` pixels from the top of the
   * holder, and the rendered window is in DOM.
   *
   * Two-pass implementation mirrors rerenderRows: Pass 1 places via Fenwick
   * cumHeight (consistent ruler), Pass 2 snaps via DOM-truth offsetTop now
   * that the anchor has measured heights.
   *
   * Idempotent. Bypasses RAF coalescing so external callers can guarantee
   * the corrected window is in DOM on the same paint — no 1-frame flash.
   */
  setAnchor(row: RowInternals, offsetFromHolderTop: number): void {
    const idx = this._indexOfRow(row);
    if (idx < 0) {
      return;
    }
    this._anchorRowAt(idx, row, offsetFromHolderTop);
  }

  /**
   * Public: scroll so the row at `index` sits at `align` inside the holder —
   * 'start' (top edge), 'center', 'end' (bottom edge), or a number for an
   * exact pixel offset from the holder top. Converges via the reconcile
   * engine even when the target row has never been measured. The index+align
   * face of the same primitive `setAnchor` exposes for row-object callers.
   */
  scrollToIndex(index: number, align: 'start' | 'center' | 'end' | number = 'start'): void {
    const row = this._self().table.rowManager.getDisplayRows()[index];
    if (!row) {
      return;
    }
    this._anchorRowAt(index, row, this._alignToOffset(index, align));
  }

  private _alignToOffset(idx: number, align: 'start' | 'center' | 'end' | number): number {
    if (typeof align === 'number') {
      return align;
    }
    const clientHeight = this._self().elementVertical.clientHeight;
    const rowHeight = this._heightOf(idx);
    if (align === 'center') {
      return Math.max(0, (clientHeight - rowHeight) / 2);
    }
    if (align === 'end') {
      return Math.max(0, clientHeight - rowHeight);
    }
    return 0;
  }

  /**
   * Reconcile engine (TanStack-style) shared by setAnchor / scrollToIndex.
   *
   * A single estimate-placed render can't reach a far row: the browser clamps
   * scrollTop to the CURRENT document height, which is only tall enough once
   * rows near the target render and grow the document. So we iterate: place
   * via Fenwick cumHeight → render → if the anchor row is now in the window,
   * DOM-truth snap and stop; else (its measurements just grew the document /
   * refined cumHeight) re-place and render again. Bounded; bail if the window
   * stops moving (no new info, so further iterations can't help). Each
   * iteration's render locks the estimate internally; post-2a calibration the
   * estimate is frozen anyway, so every iteration shares one ruler.
   */
  private _anchorRowAt(idx: number, row: RowInternals, offsetFromHolderTop: number): void {
    const self = this._self();
    const elementVertical = self.elementVertical;
    const clientHeight = elementVertical.clientHeight;

    this._resyncToRowsCount(false);

    const MAX_RECONCILE = 4;
    let prevTop = -2;
    let prevBottom = -2;
    for (let i = 0; i < MAX_RECONCILE; i++) {
      this._lockedEstimate = this.estimateHeight;
      let placed: number;
      try {
        const target = this._cumHeight(idx) - offsetFromHolderTop;
        const maxScroll = Math.max(0, this._totalHeight() - clientHeight);
        placed = Math.max(0, Math.min(target, maxScroll));
      } finally {
        this._lockedEstimate = null;
      }
      this.pendingProgrammaticScrollTop = placed;
      elementVertical.scrollTop = placed;
      this._renderWindow();

      const el = row.getElement?.();
      if (el && el.parentNode) {
        // Anchor is in the window → DOM-truth snap, converged.
        const desired = el.offsetTop - offsetFromHolderTop;
        const maxScrollPost = Math.max(0, elementVertical.scrollHeight - clientHeight);
        const corrected = Math.max(0, Math.min(desired, maxScrollPost));
        if (Math.abs(corrected - elementVertical.scrollTop) > 0.5) {
          this.pendingProgrammaticScrollTop = corrected;
          elementVertical.scrollTop = corrected;
          this._renderWindow();
        }
        break;
      }
      // Anchor still outside the window. If the window didn't move since the
      // last iteration, the coordinate space is stable and re-placing would
      // land identically — stop to avoid a pointless extra render.
      if (this.renderedRange.top === prevTop && this.renderedRange.bottom === prevBottom) {
        break;
      }
      prevTop = this.renderedRange.top;
      prevBottom = this.renderedRange.bottom;
    }
  }

  scrollToRowNearestTop(row: RowInternals): boolean {
    const idx = this._indexOfRow(row);
    if (idx < 0) {
      return true;
    }
    return Math.abs(this.vDomTop - idx) <= Math.abs(this.vDomBottom - idx);
  }

  scrollToRowPosition(
    row: RowInternals,
    position: string | undefined,
    ifVisible: boolean | undefined,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const idx = this._indexOfRow(row);
      if (idx < 0) {
        reject('Scroll Error - Row not visible');
        return;
      }

      const ev = this._self().elementVertical;
      const opts = this._self().table.options;

      const useIfVisible = ifVisible ?? (opts['scrollToRowIfVisible'] as boolean | undefined);
      if (useIfVisible === false) {
        const rowTop = this._cumHeight(idx);
        const rowBottom = this._cumHeight(idx + 1);
        if (rowTop >= ev.scrollTop && rowBottom <= ev.scrollTop + ev.clientHeight) {
          resolve();
          return;
        }
      }

      const rawPosition = position ?? (opts['scrollToRowPosition'] as string | undefined) ?? 'top';
      const resolvedPosition =
        rawPosition === 'nearest'
          ? this.scrollToRowNearestTop(row)
            ? 'top'
            : 'bottom'
          : rawPosition;

      const align =
        resolvedPosition === 'middle' || resolvedPosition === 'center'
          ? 'center'
          : resolvedPosition === 'bottom'
            ? 'end'
            : 'start';
      this.scrollToIndex(idx, align);
      resolve();
    });
  }

  visibleRows(includingBuffer?: boolean): RowInternals[] {
    const all = this._self().table.rowManager.getDisplayRows();
    if (this.vDomBottom < this.vDomTop) {
      return [];
    }
    if (includingBuffer) {
      return all.slice(this.vDomTop, this.vDomBottom + 1);
    }
    const elementVertical = this._self().elementVertical;
    const top = elementVertical.scrollTop;
    const bottom = top + elementVertical.clientHeight;
    const result: RowInternals[] = [];
    for (let i = this.vDomTop; i <= this.vDomBottom; i++) {
      const rowTop = this._cumHeight(i);
      const rowBottom = this._cumHeight(i + 1);
      if (rowBottom > top && rowTop < bottom) {
        const row = all[i];
        if (row) {
          result.push(row);
        }
      }
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // Core render path
  // ---------------------------------------------------------------------------

  private _renderWindow(): void {
    const self = this._self();
    const rows = self.table.rowManager.getDisplayRows();

    if (this.rowsCountCached !== rows.length) {
      this._resyncToRowsCount(true);
    }

    // Lock the estimate for the lifetime of this render call. Without this,
    // mid-render measurements (via _setHeight inside _attachRanges) shift
    // `estimateHeight` and every subsequent _cumHeight probe re-prices the
    // unmeasured-row region with a different unit cost — _totalHeight drifts,
    // paddingBottom drifts, and the scroll container's geometry mutates under
    // the user. Use try/finally so a thrown exception still unlocks.
    this._lockedEstimate = this.estimateHeight;
    try {
      this._renderWindowLocked(rows);
    } finally {
      this._lockedEstimate = null;
    }
  }

  private _renderWindowLocked(rows: RowInternals[]): void {
    const self = this._self();
    const elementVertical = self.elementVertical;
    const clientHeight = elementVertical.clientHeight;

    if (rows.length === 0) {
      this._detachAllRendered();
      self.tableElement.style.paddingTop = '0';
      self.tableElement.style.paddingBottom = '0';
      this.vDomTop = 0;
      this.vDomBottom = -1;
      this.renderedRange = { top: 0, bottom: -1 };
      return;
    }

    // Clamp scrollTop if the document just shrunk (sort/filter typically
    // does this). Browser will eventually clamp on its own, but doing it up
    // front means our findRowAt math operates on a valid scrollTop.
    //
    // Stage 2c: the bound depends on the render type. On STRUCTURAL renders
    // the DOM hasn't reflowed the shrink yet, so the model `_totalHeight()` is
    // the truth and the proactive clamp is correct. On SCROLL-driven renders
    // the DOM is the truth: the browser already guarantees
    // `scrollTop ≤ scrollHeight − clientHeight`, and clamping to a possibly-
    // undershooting estimate total instead yanks the user back from a
    // genuinely scrollable region on every wheel tick (the bottom "bounce").
    let scrollTop = elementVertical.scrollTop;
    const maxScroll = this.inScrollDrivenRender
      ? Math.max(0, elementVertical.scrollHeight - clientHeight)
      : Math.max(0, this._totalHeight() - clientHeight);
    if (scrollTop > maxScroll) {
      this.pendingProgrammaticScrollTop = maxScroll;
      elementVertical.scrollTop = maxScroll;
      scrollTop = maxScroll;
    }

    // Row-domain window selection. Find the visible-row range first, then
    // expand by overscan on each side. Overscan is in ROWS (tanstack-virtual
    // model), not pixels — render cost is linear in rendered row count, so
    // capping the count directly is the right knob.
    const overscanRows = this._resolveOverscanRows(clientHeight);
    const lastIdx = rows.length - 1;
    const visTop = this._findRowAt(scrollTop);
    const visBottom = this._findRowAt(scrollTop + clientHeight);
    let newTop = Math.max(0, visTop - overscanRows);
    let newBottom = Math.min(lastIdx, visBottom + overscanRows);

    // Stage 2c: arm the above-viewport measurement accumulator for this
    // render. Only scroll-driven renders compensate — structural renders are
    // anchor-corrected by setAnchor's reconcile instead.
    this.pendingScrollAdjust = 0;
    this.renderVisTop = this.inScrollDrivenRender ? visTop : -1;

    // Initial diff. Locked-estimate invariant keeps paddingTop = cumHeight
    // (newTop) stable against mid-render measurements at indices ≥ newTop.
    this._diffRender(rows, newTop, newBottom);

    // Coverage iteration. If the locked estimate over-counted row heights
    // (e.g. after a dataTree expand introduces a swarm of shorter children),
    // the initial render may not reach the viewport bottom — `cumHeight
    // (newBottom + 1)` ends up less than `scrollTop + clientHeight` and the
    // remaining viewport shows the paddingBottom spacer (a visible blank).
    // Symmetric case at the top when user is scrolled down.
    //
    // After the initial diff, flush the running estimate so the unmeasured
    // region's cumHeight contribution is more accurate, then re-check both
    // edges. If a side falls short, extend it by one attach pass. Bounded at
    // MAX_COVERAGE_ITER; convergence is typically 1–2 in practice.
    const MAX_COVERAGE_ITER = 4;
    let coverageIter = 0;
    while (coverageIter++ < MAX_COVERAGE_ITER) {
      // No mid-render _flushEstimateUpdate: the locked estimate (see entry of
      // _renderWindow) is what makes paddingTop/Bottom math stable across
      // iterations. The single end-of-render flush below picks up the new
      // measurements for the next render.
      let extended = false;
      const viewportBottomY = scrollTop + clientHeight;

      if (newBottom < lastIdx) {
        const renderedBottomY = this._cumHeight(newBottom + 1);
        if (renderedBottomY < viewportBottomY) {
          const refinedVisBottom = this._findRowAt(viewportBottomY);
          const desired = Math.min(lastIdx, refinedVisBottom + overscanRows);
          if (desired > newBottom) {
            this._attachRanges(rows, [[newBottom + 1, desired]], newTop);
            newBottom = desired;
            this.renderedRange = { top: newTop, bottom: newBottom };
            extended = true;
          }
        }
      }

      if (newTop > 0) {
        const renderedTopY = this._cumHeight(newTop);
        if (renderedTopY > scrollTop) {
          const refinedVisTop = this._findRowAt(scrollTop);
          const desired = Math.max(0, refinedVisTop - overscanRows);
          if (desired < newTop) {
            // _attachRanges reads renderedRange.top/bottom to choose
            // insertBefore vs appendChild. With the OLD renderedRange.top
            // still in place, the `to < renderedRange.top` check correctly
            // routes the new range to insertBefore.
            const oldTop = newTop;
            this._attachRanges(rows, [[desired, oldTop - 1]], desired);
            newTop = desired;
            this.renderedRange = { top: newTop, bottom: newBottom };
            extended = true;
          }
        }
      }

      if (!extended) {
        break;
      }
    }

    const paddingTop = this._cumHeight(newTop);
    // When the window reaches the last row, force paddingBottom to 0
    // instead of trusting the subtraction. Across thousands of Fenwick
    // updates floating-point drift can leave a sub-pixel residual; the
    // user sees a hairline gap below the last row at the very bottom.
    const paddingBottom =
      newBottom === lastIdx ? 0 : Math.max(0, this._totalHeight() - this._cumHeight(newBottom + 1));
    self.tableElement.style.paddingTop = `${paddingTop}px`;
    self.tableElement.style.paddingBottom = `${paddingBottom}px`;

    this.vDomTop = newTop;
    this.vDomBottom = newBottom;
    this.renderedRange = { top: newTop, bottom: newBottom };

    // Stage 2c: apply the above-viewport measurement compensation accumulated
    // by `_setHeight` during this render. Rows prepended above the fold whose
    // real height differs from what the coordinate space priced shift all
    // visible content by the summed delta — absorb it into scrollTop so the
    // content the user is looking at stays pinned (the scroll-up judder fix).
    // No re-render: the shift is within the overscan buffer; the echoed scroll
    // event is suppressed via pendingProgrammaticScrollTop.
    if (this.renderVisTop >= 0) {
      if (this.pendingScrollAdjust !== 0) {
        const domMax = Math.max(0, elementVertical.scrollHeight - clientHeight);
        const corrected = Math.max(0, Math.min(scrollTop + this.pendingScrollAdjust, domMax));
        if (Math.abs(corrected - elementVertical.scrollTop) > 0.5) {
          this.pendingProgrammaticScrollTop = corrected;
          elementVertical.scrollTop = corrected;
        }
      }
      this.pendingScrollAdjust = 0;
      this.renderVisTop = -1;
    }

    // Flush estimate only on non-scroll-driven renders. Stock's
    // `vDomRowHeight` is the same way — updated inside `_virtualRenderFill`
    // but NOT during incremental `scrollRows` ops. Doing it differently
    // means: user scrolls into rows whose heights differ from the current
    // estimate, the mean shifts mid-scroll, cumHeight for the new window
    // shifts in lockstep, and scrollTop has to either visibly jump (no
    // compensation) or get tugged against the user's input (compensation).
    // Sticky estimate during scrolls sidesteps both: paddings only change
    // due to actual per-row Fenwick updates (small deltas, no aggregate
    // shift). The flush still happens on structural renders so the one-shot
    // calibration (Stage 2a) lands; after that it is frozen and this is a
    // no-op either way.
    if (!this.inScrollDrivenRender) {
      this._flushEstimateUpdate();
    }
  }

  /**
   * Reconcile current rendered range to [newTop, newBottom] by detaching
   * rows that left and attaching rows that entered.
   *
   * Newly-attached rows are initialized, normalized, and measured before
   * this function returns. Measurements feed the Fenwick trees and the
   * (measuredSum, measuredCount) running stats; estimateHeight is NOT
   * mutated here (see _flushEstimateUpdate, called at end of render).
   */
  private _diffRender(rows: RowInternals[], newTop: number, newBottom: number): void {
    const oldTop = this.renderedRange.top;
    const oldBottom = this.renderedRange.bottom;
    const oldEmpty = oldBottom < oldTop;
    const newEmpty = newBottom < newTop;

    if (oldEmpty && newEmpty) {
      return;
    }

    const detachRanges: Array<[number, number]> = [];
    const attachRanges: Array<[number, number]> = [];

    if (oldEmpty) {
      attachRanges.push([newTop, newBottom]);
    } else if (newEmpty) {
      detachRanges.push([oldTop, oldBottom]);
    } else if (newBottom < oldTop || newTop > oldBottom) {
      detachRanges.push([oldTop, oldBottom]);
      attachRanges.push([newTop, newBottom]);
    } else {
      if (newTop > oldTop) {
        detachRanges.push([oldTop, newTop - 1]);
      } else if (newTop < oldTop) {
        attachRanges.push([newTop, oldTop - 1]);
      }
      if (newBottom < oldBottom) {
        detachRanges.push([newBottom + 1, oldBottom]);
      } else if (newBottom > oldBottom) {
        attachRanges.push([oldBottom + 1, newBottom]);
      }
    }

    for (const [from, to] of detachRanges) {
      for (let i = from; i <= to; i++) {
        const row = rows[i];
        const el = row?.getElement?.();
        if (el && el.parentNode) {
          el.parentNode.removeChild(el);
        }
      }
    }

    if (attachRanges.length > 0) {
      this._attachRanges(rows, attachRanges, newTop);
    }
  }

  /**
   * Attach the rows in `ranges`. Each range gets its own DocumentFragment
   * to batch DOM writes. After insertion, rows go through five phased
   * passes that batch reads and writes separately (matching tabulator's
   * own `_quickNormalizeRowHeight` pattern at tabulator_esm.mjs:25808):
   *
   *   A. initialize()      — writes (generate cells if needed)
   *   B. clearCellHeight() — writes (reset stale per-cell heights)
   *   C. calcHeight(true)  — reads offsetHeight, sets row.outerHeight
   *   D. setCellHeight()   — writes (equalize cells to row height)
   *   E. rendered()        — fires per-cell render callbacks
   *
   * Then a final pass reads `row.getHeight()` (returns the cached
   * `outerHeight` from C — no new offsetHeight read, no extra reflow)
   * and feeds the height cache via `_setHeight`.
   *
   * For a 30-row attach this is ~1 layout flush total instead of ~30 in
   * the previous per-row interleaved version.
   */
  private _attachRanges(
    rows: RowInternals[],
    ranges: Array<[number, number]>,
    newTop: number,
  ): void {
    const self = this._self();
    const tableElement = self.tableElement;

    for (const [from, to] of ranges) {
      const fragment = document.createDocumentFragment();
      const newlyAttached: Array<{ row: RowInternals; index: number }> = [];

      for (let i = from; i <= to; i++) {
        const row = rows[i];
        if (!row) {
          continue;
        }
        self.styleRow(row, i);
        const el = row.getElement();
        if (el.parentNode && el.parentNode !== fragment) {
          el.parentNode.removeChild(el);
        }
        fragment.appendChild(el);
        newlyAttached.push({ row, index: i });
      }

      if (newlyAttached.length === 0) {
        continue;
      }

      // Insertion point.
      const isAbove =
        from <= newTop && to < this.renderedRange.top && this.renderedRange.bottom >= 0;
      const insertAtTop = to < newTop || (newTop <= from && from < this.renderedRange.top);
      if (isAbove || (insertAtTop && tableElement.firstChild)) {
        tableElement.insertBefore(fragment, tableElement.firstChild);
      } else {
        tableElement.appendChild(fragment);
      }

      // Phase A: initialize (writes only).
      for (const entry of newlyAttached) {
        if (!entry.row.initialized) {
          entry.row.initialize();
        }
      }

      // Phases B–D: clear/calc/setCellHeight — guarded by heightInitialized
      // so previously-measured rows (e.g. after sort) hit the fast path.
      // Always run, even during fast drag: skipping these makes rows render
      // at un-normalized natural heights, which (a) visibly shifts adjacent
      // rows and (b) leaves the row unmeasured in the Fenwick, so paddingTop
      // computed from cumHeight doesn't match the actual DOM height stack.
      for (const entry of newlyAttached) {
        if (!entry.row.heightInitialized) {
          entry.row.clearCellHeight();
        }
      }
      for (const entry of newlyAttached) {
        if (!entry.row.heightInitialized) {
          entry.row.calcHeight(true);
        }
      }
      for (const entry of newlyAttached) {
        if (!entry.row.heightInitialized) {
          entry.row.setCellHeight();
        }
      }

      // Phase E: rendered() — fires per-cell callbacks.
      for (const entry of newlyAttached) {
        entry.row.rendered();
      }

      // Phase F: feed the height cache. row.getHeight() returns cached
      // outerHeight from Phase C — no new offsetHeight read, no extra reflow.
      for (const entry of newlyAttached) {
        const h = entry.row.getHeight();
        if (h > 0) {
          this._setHeight(entry.index, h, entry.row.data);
        }
      }
    }
  }

  private _detachAllRendered(): void {
    const tableElement = this._self().tableElement;
    while (tableElement.firstChild) {
      tableElement.removeChild(tableElement.firstChild);
    }
    this.vDomTop = 0;
    this.vDomBottom = -1;
    this.renderedRange = { top: 0, bottom: -1 };
    // Note: _lastTopRow is NOT cleared here. rerenderRows() calls this
    // detach as part of its tear-down, but needs _lastTopRow as the
    // anchor for the subsequent reposition. clearRows() handles the
    // "really empty" case.
  }

  // ---------------------------------------------------------------------------
  // Heights — Fenwick-backed
  // ---------------------------------------------------------------------------

  private _resyncToRowsCount(wipe: boolean): void {
    const rowsCount = this._self().table.rowManager.getDisplayRows().length;
    const lengthChanged = this.measuredHeight.length !== rowsCount;
    if (!wipe && !lengthChanged) {
      return;
    }
    this.rowsCountCached = rowsCount;
    if (lengthChanged) {
      this.measuredHeight = new Float64Array(rowsCount);
      this.isMeasured = new Uint8Array(rowsCount);
      this.fenwickMeasured.resize(rowsCount);
      this.fenwickUnmeasuredCount.resize(rowsCount);
    } else {
      this.measuredHeight.fill(0);
      this.isMeasured.fill(0);
      this.fenwickMeasured.resetZero();
      this.fenwickUnmeasuredCount.resetZero();
    }
    // Initial state: all rows unmeasured. FenwickA all zeros (already);
    // FenwickB filled with 1s (count of unmeasured per row = 1).
    this.fenwickUnmeasuredCount.bulkInitConstant(1);
    this.measuredSum = 0;
    this.measuredCount = 0;
    // Keep estimateHeight as a starting point for the new dataset.
  }

  /**
   * Stage 2b: rebuild the positional index arrays + Fenwick from the durable
   * id→height cache for the new display order. Replaces the
   * `_resyncToRowsCount(true)` wipe in `rerenderRows`: rows whose height was
   * measured before (and survive the structural change) keep their real
   * height, so `cumHeight`/`totalHeight` stay accurate instead of resetting to
   * the estimate. Rows with no cached height (new, or never rendered) stay
   * unmeasured and fall back to the estimate until they enter the window.
   */
  private _rebuildIndexFromCache(rows: RowInternals[]): void {
    const rowsCount = rows.length;
    if (this.measuredHeight.length !== rowsCount) {
      this.measuredHeight = new Float64Array(rowsCount);
      this.isMeasured = new Uint8Array(rowsCount);
      this.fenwickMeasured.resize(rowsCount);
      this.fenwickUnmeasuredCount.resize(rowsCount);
    } else {
      this.measuredHeight.fill(0);
      this.isMeasured.fill(0);
      this.fenwickMeasured.resetZero();
      this.fenwickUnmeasuredCount.resetZero();
    }
    this.fenwickUnmeasuredCount.bulkInitConstant(1);
    this.measuredSum = 0;
    this.measuredCount = 0;
    this.rowsCountCached = rowsCount;

    // Seed each row whose data object has a cached height. Direct
    // first-measurement Fenwick writes (arrays were just zeroed).
    for (let i = 0; i < rowsCount; i++) {
      const dataKey = rows[i]?.data;
      if (dataKey === undefined) {
        continue;
      }
      const h = this.dataHeights.get(dataKey);
      if (h === undefined || h <= 0) {
        continue;
      }
      this.fenwickMeasured.update(i, h);
      this.fenwickUnmeasuredCount.update(i, -1);
      this.isMeasured[i] = 1;
      this.measuredHeight[i] = h;
      this.measuredSum += h;
      this.measuredCount += 1;
    }
  }

  /**
   * Record a measurement. Updates Fenwicks and running stats. Does NOT
   * mutate estimateHeight — that update is deferred to
   * `_flushEstimateUpdate()` (called at end of render), preserving the
   * locked-estimate invariant that makes single-pass rendering correct.
   */
  private _setHeight(i: number, h: number, dataKey?: object): void {
    if (i < 0 || i >= this.measuredHeight.length) {
      return;
    }
    if (!Number.isFinite(h) || h <= 0) {
      return;
    }
    // Persist to the durable data→height cache (Stage 2b) regardless of
    // whether this is a first or repeat measurement, so the value survives the
    // next structural rebuild. No-op when the row has no data object.
    if (dataKey !== undefined) {
      this.dataHeights.set(dataKey, h);
    }
    const wasMeasured = this.isMeasured[i] === 1;
    const oldH = this.measuredHeight[i] ?? 0;
    if (wasMeasured && oldH === h) {
      return;
    }
    // Stage 2c: a row ABOVE the viewport-top row changed size relative to what
    // the coordinate space priced it at (the locked estimate for a first
    // measurement, the previous height for a re-measurement). Everything
    // visible shifts by that delta — accumulate it; the render applies the sum
    // to scrollTop so visible content stays pinned.
    if (this.renderVisTop >= 0 && i < this.renderVisTop) {
      const prior = wasMeasured ? oldH : (this._lockedEstimate ?? this.estimateHeight);
      this.pendingScrollAdjust += h - prior;
    }
    if (wasMeasured) {
      // Re-measurement: adjust FenwickA by delta. FenwickB unchanged.
      this.fenwickMeasured.update(i, h - oldH);
      this.measuredSum += h - oldH;
    } else {
      // First measurement: add h to FenwickA, subtract 1 from FenwickB.
      this.fenwickMeasured.update(i, h);
      this.fenwickUnmeasuredCount.update(i, -1);
      this.isMeasured[i] = 1;
      this.measuredSum += h;
      this.measuredCount += 1;
    }
    this.measuredHeight[i] = h;
  }

  private _flushEstimateUpdate(): void {
    // Calibrate once from the first painted window's measurements, then freeze.
    // After freezing this is a no-op: the estimate never drifts again, so the
    // coordinate space stays stable across scrolls and structural changes.
    if (this.estimateFrozen) {
      return;
    }
    if (this.measuredCount > 0) {
      this.estimateHeight = Math.max(1, this.measuredSum / this.measuredCount);
      this.estimateFrozen = true;
    }
  }

  /**
   * cumHeight(i) = Σ heights[0..i)
   *             = fenwickMeasured.prefix(i)
   *             + fenwickUnmeasuredCount.prefix(i) × estimateHeight
   */
  private _cumHeight(i: number): number {
    if (i <= 0) {
      return 0;
    }
    const n = this.measuredHeight.length;
    const ci = i > n ? n : i;
    const est = this._lockedEstimate ?? this.estimateHeight;
    return this.fenwickMeasured.prefixSum(ci) + this.fenwickUnmeasuredCount.prefixSum(ci) * est;
  }

  private _totalHeight(): number {
    return this._cumHeight(this.measuredHeight.length);
  }

  /**
   * Return the largest row index i in [0, n-1] with cumHeight(i) ≤ y.
   * Implemented as binary search over the cumHeight oracle. Each oracle
   * call is O(log n) (two Fenwick prefix sums + a multiply), so the
   * overall cost is O(log² n) — for 100K rows about 300 ops vs 100K ops
   * for the previous O(n) prefix rebuild.
   */
  private _findRowAt(y: number): number {
    const n = this.measuredHeight.length;
    if (n === 0) {
      return 0;
    }
    if (y <= 0) {
      return 0;
    }
    if (y >= this._totalHeight()) {
      return n - 1;
    }
    // Find largest i with cumHeight(i) ≤ y, then return i-1 (the row at y).
    // Same convention as the previous prefix-array binary search.
    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this._cumHeight(mid) <= y) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return Math.max(0, lo - 1);
  }

  /**
   * Test helper: the per-row height (measured if known, else estimate).
   * Used by unit tests; not on the hot path.
   */
  private _heightOf(i: number): number {
    if (i < 0 || i >= this.measuredHeight.length) {
      return 0;
    }
    return this.isMeasured[i] === 1
      ? (this.measuredHeight[i] ?? this.estimateHeight)
      : this.estimateHeight;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private _self(): RendererBase {
    return this as unknown as RendererBase;
  }

  /**
   * Resolve the overscan row count for the current viewport. Reads the
   * explicit `variableHeightOverscanRows` option first, falls back to the
   * legacy `renderVerticalBuffer` pixel option (converted via the current
   * estimate), and finally to an adaptive default based on viewport height
   * clamped to [OVERSCAN_MIN, OVERSCAN_MAX].
   */
  private _resolveOverscanRows(clientHeight: number): number {
    const opts = this._self().table.options;
    const explicit = opts[OVERSCAN_OPTION];
    if (typeof explicit === 'number' && explicit >= 0 && Number.isFinite(explicit)) {
      return Math.max(0, Math.floor(explicit));
    }
    const legacyPx = opts[LEGACY_BUFFER_OPTION];
    if (typeof legacyPx === 'number' && legacyPx > 0) {
      const est = Math.max(1, this.estimateHeight);
      return Math.max(OVERSCAN_MIN, Math.min(OVERSCAN_MAX, Math.round(legacyPx / est)));
    }
    const est = Math.max(1, this.estimateHeight);
    const adaptive = Math.round(clientHeight / 4 / est);
    return Math.max(OVERSCAN_MIN, Math.min(OVERSCAN_MAX, adaptive));
  }

  private _indexOfRow(row: RowInternals): number {
    return this._self().table.rowManager.getDisplayRows().indexOf(row);
  }
}
