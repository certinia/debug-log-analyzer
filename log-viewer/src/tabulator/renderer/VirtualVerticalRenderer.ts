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
 *
 * Optional debug logging:
 *   variableHeightRendererDebug: true   // logs every _renderWindow() call
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
const DEBUG_OPTION = 'variableHeightRendererDebug';
const OVERSCAN_OPTION = 'variableHeightOverscanRows';
const LEGACY_BUFFER_OPTION = 'renderVerticalBuffer';
const DEFAULT_DEBUG = true;
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

interface DiffStats {
  attached: number;
  detached: number;
  skippedNormalize: number;
  detachMs: number;
  attachInitMs: number;
  attachNormalizeMs: number;
  attachMeasureMs: number;
}

interface DebugSnapshot {
  scrollTop: number;
  vDomTop: number;
  vDomBottom: number;
  paddingTop: number;
  paddingBottom: number;
  totalHeight: number;
  rowsCount: number;
  measuredCount: number;
  estimateHeight: number;
  overscanRows: number;
  attached: number;
  detached: number;
  skippedNormalize: number;
  // Per-phase timing (in ms). Reported only when debug is enabled.
  findRowAtMs: number;
  detachMs: number;
  attachInitMs: number;
  attachNormalizeMs: number;
  attachMeasureMs: number;
  paddingMs: number;
  totalMs: number;
}

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

  private estimateHeight = DEFAULT_ESTIMATE_HEIGHT;
  private measuredSum = 0;
  private measuredCount = 0;

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
    this.measuredSum = 0;
    this.measuredCount = 0;
    this.vDomTop = 0;
    this.vDomBottom = -1;
    this.renderedRange = { top: 0, bottom: -1 };
    this.rowsCountCached = 0;
    this.pendingProgrammaticScrollTop = 0;
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
    // Mirror stock VirtualDomVertical.rerenderRows (tabulator_esm.mjs:25247).
    //
    // Step 1 — Capture an anchor row BEFORE detach. Stock walks
    // vDomTop..vDomBottom and picks the row whose offsetTop is closest to
    // scrollTop, then replays with `_virtualRenderFill(topRow, true,
    // topOffset)`. Our variable-height equivalent: walk renderedRange and
    // pick the same row, then call `setAnchor(row, offsetFromHolderTop)`
    // after re-rendering. Without this, scrollTop is preserved literally
    // but row indices shift after sort/filter/tree-toggle → the user sees
    // different content at the same Y (visible jump).
    const self = this._self();
    const elementVertical = self.elementVertical;
    const scrollTop = elementVertical.scrollTop;
    const left = self.table.rowManager.element.scrollLeft;
    const rowsBefore = self.table.rowManager.getDisplayRows();

    let anchorRow: RowInternals | null = null;
    let anchorOffsetFromHolderTop = 0;
    let bestAbsDiff = Infinity;
    for (let i = this.renderedRange.top; i <= this.renderedRange.bottom; i++) {
      const row = rowsBefore[i];
      if (!row) {
        continue;
      }
      const el = row.getElement?.();
      if (!el?.parentNode) {
        continue;
      }
      // `offsetTop - scrollTop` is the row's Y inside the holder, which
      // matches `setAnchor`'s `offsetFromHolderTop` parameter directly.
      // Stock computes `scrollTop - offsetTop` (the negation) and replays
      // via `_virtualRenderFill` — same captured information, opposite
      // sign convention.
      const diff = el.offsetTop - scrollTop;
      const abs = Math.abs(diff);
      if (abs < bestAbsDiff) {
        bestAbsDiff = abs;
        anchorRow = row;
        anchorOffsetFromHolderTop = diff;
      } else {
        // Monotone walk: rows are in DOM order so |diff| can only
        // increase past the closest match. Stock relies on the same break.
        break;
      }
    }

    this._detachAllRendered();
    if (callback) {
      callback();
    }
    // Sort/filter/expand: row count may or may not change, but row positions
    // certainly do — wipe Fenwick unconditionally.
    this._resyncToRowsCount(true);
    // After the Fenwick wipe every row must be flipped back to
    // heightInitialized=false so _attachRanges' Phase B–D actually re-measures
    // them. Without this the fast path takes over and the empty Fenwick is
    // never repopulated with real heights.
    const rowsAfter = self.table.rowManager.getDisplayRows();
    for (const row of rowsAfter) {
      row.deinitializeHeight?.();
    }

    if (rowsAfter.length === 0) {
      // Empty display: render once to clear paddings + DOM, then mirror
      // stock's `tableEmpty()` so the `.tabulator-placeholder` element
      // shows (tabulator_esm.mjs:25281).
      this._renderWindow();
      self.table.rowManager.tableEmpty?.();
    } else if (anchorRow && rowsAfter.indexOf(anchorRow) !== -1) {
      // Replay the anchor — variable-height equivalent of stock's
      // `_virtualRenderFill(topRow, true, topOffset)`. setAnchor's Pass 1
      // places via Fenwick cumHeight (consistent ruler), Pass 2 snaps via
      // DOM-truth offsetTop now that the anchor has measured heights.
      this.setAnchor(anchorRow, anchorOffsetFromHolderTop);
    } else {
      // Anchor row was filtered or collapsed out (or no anchor was
      // captured — e.g. first render). Fall back to a plain render
      // anchored at the browser-preserved scrollTop. Future improvement:
      // walk tree ancestors to find a surviving anchor.
      this._renderWindow();
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
    // redundant render that could fire AFTER estimateHeight has shifted
    // and visibly move the rendered window. One-shot — clear after
    // consuming. Exact value match is safe: even on a coincidental user
    // scroll to the same value, the suppressed render would have
    // produced an identical window.
    if (top === this.pendingProgrammaticScrollTop) {
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
      this._renderWindow();
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
   * (e.g. opt-in ScrollAnchor). After this call returns, the row's DOM
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
    const self = this._self();
    const elementVertical = self.elementVertical;
    const clientHeight = elementVertical.clientHeight;

    this._resyncToRowsCount(false);

    // Pass 1 — Fenwick-placed scrollTop, render.
    this._lockedEstimate = this.estimateHeight;
    try {
      const target = this._cumHeight(idx) - offsetFromHolderTop;
      const maxScroll = Math.max(0, this._totalHeight() - clientHeight);
      const pass1 = Math.max(0, Math.min(target, maxScroll));
      this.pendingProgrammaticScrollTop = pass1;
      elementVertical.scrollTop = pass1;
    } finally {
      this._lockedEstimate = null;
    }
    this._renderWindow();

    // Pass 2 — DOM-truth snap.
    const el = row.getElement?.();
    if (el && el.parentNode) {
      const desired = el.offsetTop - offsetFromHolderTop;
      const maxScrollPost = Math.max(0, elementVertical.scrollHeight - clientHeight);
      const corrected = Math.max(0, Math.min(desired, maxScrollPost));
      if (Math.abs(corrected - elementVertical.scrollTop) > 0.5) {
        this.pendingProgrammaticScrollTop = corrected;
        elementVertical.scrollTop = corrected;
        this._renderWindow();
      }
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

      const rowHeight = this._heightOf(idx);
      const offsetFromHolderTop =
        resolvedPosition === 'middle' || resolvedPosition === 'center'
          ? Math.max(0, (ev.clientHeight - rowHeight) / 2)
          : resolvedPosition === 'bottom'
            ? Math.max(0, ev.clientHeight - rowHeight)
            : 0;

      this.setAnchor(row, offsetFromHolderTop);
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
    const debug = this._debugEnabled();
    const tStart = debug ? performance.now() : 0;
    if (debug) {
      // eslint-disable-next-line no-console
      console.log(
        '[VHR] _renderWindow start, scrollTop:',
        this._self().elementVertical.scrollTop,
        'vDomTop:',
        this.vDomTop,
        'vDomBottom:',
        this.vDomBottom,
      );
    }
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
      this._renderWindowLocked(rows, debug, tStart);
    } finally {
      this._lockedEstimate = null;
    }
  }

  private _renderWindowLocked(rows: RowInternals[], debug: boolean, tStart: number): void {
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
    let scrollTop = elementVertical.scrollTop;
    const total = this._totalHeight();
    const maxScroll = Math.max(0, total - clientHeight);
    if (scrollTop > maxScroll) {
      this.pendingProgrammaticScrollTop = maxScroll;
      elementVertical.scrollTop = maxScroll;
      scrollTop = maxScroll;
    }

    // Row-domain window selection. Find the visible-row range first, then
    // expand by overscan on each side. Overscan is in ROWS (tanstack-virtual
    // model), not pixels — render cost is linear in rendered row count, so
    // capping the count directly is the right knob.
    const tFindStart = debug ? performance.now() : 0;
    const overscanRows = this._resolveOverscanRows(clientHeight);
    const lastIdx = rows.length - 1;
    const visTop = this._findRowAt(scrollTop);
    const visBottom = this._findRowAt(scrollTop + clientHeight);
    let newTop = Math.max(0, visTop - overscanRows);
    let newBottom = Math.min(lastIdx, visBottom + overscanRows);
    const findRowAtMs = debug ? performance.now() - tFindStart : 0;

    // Initial diff. Locked-estimate invariant keeps paddingTop = cumHeight
    // (newTop) stable against mid-render measurements at indices ≥ newTop.
    const diffStats = this._diffRender(rows, newTop, newBottom, debug);

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
            this._attachRanges(rows, [[newBottom + 1, desired]], newTop, debug, diffStats);
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
            this._attachRanges(rows, [[desired, oldTop - 1]], desired, debug, diffStats);
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

    const tPadStart = debug ? performance.now() : 0;
    const paddingTop = this._cumHeight(newTop);
    // When the window reaches the last row, force paddingBottom to 0
    // instead of trusting the subtraction. Across thousands of Fenwick
    // updates floating-point drift can leave a sub-pixel residual; the
    // user sees a hairline gap below the last row at the very bottom.
    const paddingBottom =
      newBottom === lastIdx ? 0 : Math.max(0, this._totalHeight() - this._cumHeight(newBottom + 1));
    self.tableElement.style.paddingTop = `${paddingTop}px`;
    self.tableElement.style.paddingBottom = `${paddingBottom}px`;
    const paddingMs = debug ? performance.now() - tPadStart : 0;

    this.vDomTop = newTop;
    this.vDomBottom = newBottom;
    this.renderedRange = { top: newTop, bottom: newBottom };

    // Estimate-drift compensation. _flushEstimateUpdate is about to shift
    // `estimateHeight` based on rows measured during this render. For any
    // next render whose newTop has unmeasured rows above it,
    // `cumHeight(newTop) = measuredAbove + unmeasuredAbove × estimate`
    // would shift by `Δ × unmeasuredAbove`. The browser preserves
    // scrollTop literally, so without compensation the user sees a
    // visible jump on the NEXT render (most painful after a large
    // scrollbar drag — many new measurements at once).
    //
    // Apply the delta atomically right now: bump paddingTop AND
    // scrollTop by the same amount so the visible content stays put.
    // Compute the new estimate inline (instead of after
    // _flushEstimateUpdate) because _cumHeight still respects the outer
    // `_lockedEstimate`; we use the Fenwick prefix sums directly.
    const oldEstimate = this.estimateHeight;
    const newEstimate =
      this.measuredCount > 0 ? Math.max(1, this.measuredSum / this.measuredCount) : oldEstimate;
    if (newEstimate !== oldEstimate) {
      const n = this.measuredHeight.length;
      const topIdx = Math.min(newTop, n);
      const measuredAbove = this.fenwickMeasured.prefixSum(topIdx);
      const unmeasuredAbove = this.fenwickUnmeasuredCount.prefixSum(topIdx);
      const newPaddingTop = measuredAbove + unmeasuredAbove * newEstimate;
      const delta = newPaddingTop - paddingTop;
      if (Math.abs(delta) > 0.5) {
        self.tableElement.style.paddingTop = `${newPaddingTop}px`;
        if (newBottom !== lastIdx) {
          const bottomIdx = Math.min(newBottom + 1, n);
          const totalMeasured = this.fenwickMeasured.prefixSum(n);
          const totalUnmeasured = this.fenwickUnmeasuredCount.prefixSum(n);
          const measuredBelow = totalMeasured - this.fenwickMeasured.prefixSum(bottomIdx);
          const unmeasuredBelow =
            totalUnmeasured - this.fenwickUnmeasuredCount.prefixSum(bottomIdx);
          const newPaddingBottom = Math.max(0, measuredBelow + unmeasuredBelow * newEstimate);
          self.tableElement.style.paddingBottom = `${newPaddingBottom}px`;
        }
        const adjusted = elementVertical.scrollTop + delta;
        this.pendingProgrammaticScrollTop = adjusted;
        elementVertical.scrollTop = adjusted;
      }
    }

    // End-of-render: now safe to update estimateHeight for next render.
    this._flushEstimateUpdate();

    if (debug) {
      // eslint-disable-next-line no-console
      console.log(
        '[VHR] _renderWindow end, scrollTop:',
        self.elementVertical.scrollTop,
        'vDomTop:',
        newTop,
        'vDomBottom:',
        newBottom,
      );
    }

    if (debug) {
      const snapshot: DebugSnapshot = {
        scrollTop,
        vDomTop: newTop,
        vDomBottom: newBottom,
        paddingTop,
        paddingBottom,
        totalHeight: this._totalHeight(),
        rowsCount: rows.length,
        measuredCount: this.measuredCount,
        estimateHeight: this.estimateHeight,
        overscanRows,
        attached: diffStats.attached,
        detached: diffStats.detached,
        skippedNormalize: diffStats.skippedNormalize,
        findRowAtMs,
        detachMs: diffStats.detachMs,
        attachInitMs: diffStats.attachInitMs,
        attachNormalizeMs: diffStats.attachNormalizeMs,
        attachMeasureMs: diffStats.attachMeasureMs,
        paddingMs,
        totalMs: performance.now() - tStart,
      };
      // eslint-disable-next-line no-console
      console.log('[VHR]', snapshot);
    }
  }

  /**
   * Reconcile current rendered range to [newTop, newBottom] by detaching
   * rows that left and attaching rows that entered. Returns counts.
   *
   * Newly-attached rows are initialized, normalized, and measured before
   * this function returns. Measurements feed the Fenwick trees and the
   * (measuredSum, measuredCount) running stats; estimateHeight is NOT
   * mutated here (see _flushEstimateUpdate, called at end of render).
   */
  private _diffRender(
    rows: RowInternals[],
    newTop: number,
    newBottom: number,
    debug: boolean,
  ): DiffStats {
    const stats: DiffStats = {
      attached: 0,
      detached: 0,
      skippedNormalize: 0,
      detachMs: 0,
      attachInitMs: 0,
      attachNormalizeMs: 0,
      attachMeasureMs: 0,
    };
    const oldTop = this.renderedRange.top;
    const oldBottom = this.renderedRange.bottom;
    const oldEmpty = oldBottom < oldTop;
    const newEmpty = newBottom < newTop;

    if (oldEmpty && newEmpty) {
      return stats;
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

    const tDetachStart = debug ? performance.now() : 0;
    for (const [from, to] of detachRanges) {
      for (let i = from; i <= to; i++) {
        const row = rows[i];
        const el = row?.getElement?.();
        if (el && el.parentNode) {
          el.parentNode.removeChild(el);
          stats.detached++;
        }
      }
    }
    if (debug) {
      stats.detachMs = performance.now() - tDetachStart;
    }

    if (attachRanges.length > 0) {
      this._attachRanges(rows, attachRanges, newTop, debug, stats);
    }

    return stats;
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
    debug: boolean,
    stats: DiffStats,
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
        stats.attached++;
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
      const tInitStart = debug ? performance.now() : 0;
      for (const entry of newlyAttached) {
        if (!entry.row.initialized) {
          entry.row.initialize();
        }
      }
      if (debug) {
        stats.attachInitMs += performance.now() - tInitStart;
      }

      // Phases B–D: clear/calc/setCellHeight — guarded by heightInitialized
      // so previously-measured rows (e.g. after sort) hit the fast path.
      // Always run, even during fast drag: skipping these makes rows render
      // at un-normalized natural heights, which (a) visibly shifts adjacent
      // rows and (b) leaves the row unmeasured in the Fenwick, so paddingTop
      // computed from cumHeight doesn't match the actual DOM height stack.
      const tNormStart = debug ? performance.now() : 0;
      for (const entry of newlyAttached) {
        if (!entry.row.heightInitialized) {
          entry.row.clearCellHeight();
        } else {
          stats.skippedNormalize++;
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
      if (debug) {
        stats.attachNormalizeMs += performance.now() - tNormStart;
      }

      // Phase E: rendered() — fires per-cell callbacks.
      for (const entry of newlyAttached) {
        entry.row.rendered();
      }

      // Phase F: feed the height cache. row.getHeight() returns cached
      // outerHeight from Phase C — no new offsetHeight read, no extra reflow.
      const tMeasStart = debug ? performance.now() : 0;
      for (const entry of newlyAttached) {
        const h = entry.row.getHeight();
        if (h > 0) {
          this._setHeight(entry.index, h);
        }
      }
      if (debug) {
        stats.attachMeasureMs += performance.now() - tMeasStart;
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
   * Record a measurement. Updates Fenwicks and running stats. Does NOT
   * mutate estimateHeight — that update is deferred to
   * `_flushEstimateUpdate()` (called at end of render), preserving the
   * locked-estimate invariant that makes single-pass rendering correct.
   */
  private _setHeight(i: number, h: number): void {
    if (i < 0 || i >= this.measuredHeight.length) {
      return;
    }
    if (!Number.isFinite(h) || h <= 0) {
      return;
    }
    const wasMeasured = this.isMeasured[i] === 1;
    const oldH = this.measuredHeight[i] ?? 0;
    if (wasMeasured && oldH === h) {
      return;
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
    if (this.measuredCount > 0) {
      this.estimateHeight = Math.max(1, this.measuredSum / this.measuredCount);
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

  private _debugEnabled(): boolean {
    const opt = this._self().table.options[DEBUG_OPTION];
    if (opt === false) {
      return false;
    }
    return opt === true || DEFAULT_DEBUG;
  }
}
