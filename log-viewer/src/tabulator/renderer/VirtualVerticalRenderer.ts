/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { Renderer } from 'tabulator-tables';

/**
 * Variable-height vertical virtual renderer for Tabulator 6.4.0 — a
 * standalone replacement for stock `VirtualDomVertical` (uniform-height
 * model). Enable per table with `renderVertical: VirtualVerticalRenderer`.
 *
 * Coordinate model — two Fenwick trees:
 *   cumHeight(i) = fenwickMeasured.prefix(i)
 *                + fenwickUnmeasuredCount.prefix(i) × estimateHeight
 * giving O(log n) cumHeight/totalHeight/setHeight and O(log² n) findRowAt.
 * `estimateHeight` is calibrated once from the first painted window, then
 * frozen, and additionally locked per render call — the coordinate space
 * never shifts under the user (see estimateFrozen / _lockedEstimate).
 *
 * Render flow: scroll events coalesce into one `_scrollFrame` per paint
 * (velocity-gated fling deferral skips renders nobody could see), which
 * diff-renders the window — detach leavers, attach enterers via batched
 * read/write phases (one forced reflow per attach call) — then idle time
 * pre-warms cells just beyond the edges.
 *
 * Cross-module contracts: AnchoringPolicy drives `setAnchor`; the Find
 * module reads `vDomTop`/`vDomBottom`.
 */

/**
 * The display-row surface this renderer touches. Display rows are a UNION of
 * Tabulator `Row` objects and `PseudoRow`-backed group/calc rows: PseudoRows
 * implement the methods below as no-ops but LACK `initialized`,
 * `heightInitialized`, `deinitializeHeight`, and `data`, and their
 * `getHeight()` returns undefined — hence the optional members. PseudoRows
 * therefore flow through the attach pipeline untouched (no-op phases, no
 * Fenwick write — they stay estimate-priced, matching stock).
 */
interface RowInternals {
  initialized?: boolean;
  heightInitialized?: boolean;
  initialize: (force?: boolean, inFragment?: boolean) => void;
  calcHeight: (force?: boolean) => void;
  setCellHeight: () => void;
  clearCellHeight: () => void;
  rendered: () => void;
  getElement: () => HTMLElement;
  getHeight: () => number | undefined;
  // Row-only: clears heightInitialized + cached outerHeight so the next
  // attach re-measures from the DOM.
  deinitializeHeight?: () => void;
  // Row-only: the data OBJECT REFERENCE — a durable identity that survives
  // DataTree re-wrapping and in-place updateData, so it keys the height
  // cache without requiring an id field. Uncached rows are measured normally.
  data?: object;
}

/** Table options this renderer reads (set from typed app code). */
interface RendererOptions {
  scrollToRowPosition?: string;
  scrollToRowIfVisible?: boolean;
}

interface RendererBase {
  table: {
    rowManager: {
      element: HTMLElement;
      tableElement: HTMLElement;
      getDisplayRows: () => RowInternals[];
      scrollHorizontal: (left: number) => void;
      // Shows the placeholder when the display is empty; mirrored at the
      // end of rerenderRows like stock.
      tableEmpty?: () => void;
      // RowManager copies `options.renderVertical` here verbatim — a CLASS
      // reference that gets stringified into a DOM attribute. initialize()
      // overwrites it with the string 'virtual' (stock bug workaround).
      renderMode?: string;
    };
    options: RendererOptions;
  };
  elementVertical: HTMLElement;
  tableElement: HTMLElement;
  verticalFillMode: string;
  styleRow: (row: RowInternals, index: number) => void;
  // CoreFeature.dispatch → table.eventBus (internal event chain). Stock
  // fires 'render-virtual-fill' after every fill; GroupRows depends on it.
  dispatch: (event: string) => void;
}

const DEFAULT_ESTIMATE_HEIGHT = 30;
const OVERSCAN_MIN = 4;
const OVERSCAN_MAX = 16;

// Idle pre-warm: build cells for rows this far beyond each window edge
// during requestIdleCallback time, so scrolling into them pays only
// measurement. Keep SMALL (~1.5 windows/side): larger spans build thousands
// of never-visited cell trees whose GC churn caused warm-frame spikes.
const IDLE_PREWARM_SPAN_ROWS = 48;
// Stop a pre-warm slot when the idle deadline has less than this left.
const IDLE_PREWARM_MIN_REMAINING_MS = 2;
// Hard per-slot row cap, independent of the deadline: rIC callbacks are not
// preemptible, so an uncapped slot on a generous (up to 50ms) deadline
// blocks a scroll event into a dropped frame.
const IDLE_PREWARM_MAX_ROWS_PER_SLOT = 24;

// Minimum holder-width delta (px) that counts as a real resize (height
// invalidation); ignores subpixel retina jitter.
const RESIZE_WIDTH_THRESHOLD_PX = 1;
// Quiet period before the O(n) height-invalidation walk runs — the
// ResizeObserver fires per-pixel during a resize-handle drag.
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
  // String tags read directly by RowManager.
  renderMode = 'virtual';
  // 'fill': RowManager calls adjustTableSize() after renders so the container
  // sizes from the configured height/maxHeight.
  verticalFillMode = 'fill';

  // Coordinate model (see class doc). Positional — rebuilt on every
  // structural change.
  private fenwickMeasured = new Fenwick(0); // Σ measured heights (0 if unmeasured)
  private fenwickUnmeasuredCount = new Fenwick(0); // 1 per unmeasured row
  private measuredHeight: Float64Array = new Float64Array(0); // shadow for re-measure deltas
  private isMeasured: Uint8Array = new Uint8Array(0);
  // Durable heights keyed by data OBJECT REFERENCE (survives structural
  // rebuilds — rerenderRows re-seeds the positional index from here).
  // "Cleared" by reassignment on clearRows / width invalidation.
  private dataHeights = new WeakMap<object, number>();

  private estimateHeight = DEFAULT_ESTIMATE_HEIGHT;
  private measuredSum = 0;
  private measuredCount = 0;
  // INVARIANT: the estimate is calibrated once from the first painted window,
  // then frozen — a drifting mean re-prices every unmeasured row and lurches
  // the coordinate space by 100k+ px at scale. Reset only by clearRows.
  private estimateFrozen = false;

  // Per-render snapshot of estimateHeight honoured by _cumHeight, keeping all
  // probes within one render self-consistent. Null outside renders.
  private _lockedEstimate: number | null = null;

  // Rendered window, two views: vDomTop/vDomBottom are the stable post-render
  // snapshot (read externally — Find module, visibleRows); renderedRange is
  // the LIVE value _attachRanges reads mid-coverage-loop for insertion
  // points. Equal at rest; do not merge (mutated in place to avoid churn).
  private vDomTop = 0;
  private vDomBottom = -1; // inclusive; -1 = empty
  private renderedRange: { top: number; bottom: number } = { top: 0, bottom: -1 };

  private rowsCountCached = 0;

  // One scroll/render RAF slot (see _scheduleScrollRaf).
  private rafScheduled = false;

  // scrollTop seen by the previous _scrollFrame — the velocity reference for
  // fling deferral. NaN = none recent (treated as fast).
  private deferredScrollTop = NaN;

  // Pending rIC handle for the pre-warmer; cancelled on destroy/clearRows.
  private idlePrewarmHandle: number | null = null;

  // Last scrollLeft piped to scrollHorizontal (which writes DOM + dispatches
  // unconditionally — pipe only on change). NaN → first frame always pipes.
  private lastPipedScrollLeft = NaN;

  // Resize tracking: width change ⇒ text re-wraps ⇒ all heights stale;
  // unchanged dimensions ⇒ resize() must no-op (Tabulator calls it on every
  // restoreRedraw cascade, and a needless deferred render visibly shifts the
  // window a frame after a click paints).
  private lastClientWidth = 0;
  private lastClientHeight = 0;
  private resizeObserver: ResizeObserver | null = null;
  // Debounce for the O(n) invalidation walk — ResizeObserver fires per-pixel
  // during a handle drag.
  private resizeInvalidateTimer: ReturnType<typeof setTimeout> | null = null;
  private resizePendingInvalidate = false;

  // True while a user-scroll render runs. Gates the sticky-estimate rule
  // (no estimate flush mid-scroll — stock's vDomRowHeight behaves the same;
  // a mid-scroll mean shift either jumps or tugs against the user).
  private inScrollDrivenRender = false;

  // Stage 2c (TanStack scrollAdjustments): _setHeight accumulates
  // (real − priced) deltas for rows above the viewport top; the render
  // applies the sum to scrollTop so visible content stays pixel-pinned.
  private pendingScrollAdjust = 0;
  private renderVisTop = -1; // -1 = not in a scroll-driven render

  // INVARIANT: every programmatic scrollTop write goes through _setScrollTop,
  // which records the value here FIRST. scrollRows treats a matching scroll
  // event (±1px — browsers round fractional writes) as our echo and swallows
  // it instead of scheduling a redundant render. NaN = nothing pending
  // (NaN never equals a real scrollTop).
  private pendingProgrammaticScrollTop = NaN;

  // ---------------------------------------------------------------------------
  // Renderer lifecycle (called by RowManager)
  // ---------------------------------------------------------------------------

  /** RowManager lifecycle: one-time setup after construction. */
  initialize(): void {
    // Stock bug workaround: RowManager stores the renderVertical CLASS in
    // its renderMode field and later stringifies it into a DOM attribute.
    // Overwrite with the string before the first placeholder render —
    // initialize() runs immediately after the bad assignment.
    const self = this._self();
    self.table.rowManager.renderMode = this.renderMode;

    // Seed dimension caches so the first resize() only invalidates on a
    // real change.
    const holder = self.elementVertical;
    this.lastClientWidth = holder.clientWidth;
    this.lastClientHeight = holder.clientHeight;

    // ResizeObserver catches holder resizes tabulator's outer redraw misses
    // (sidebar toggle, flex parent resize without a window event).
    if (typeof ResizeObserver !== 'undefined' && this.resizeObserver === null) {
      this.resizeObserver = new ResizeObserver(() => {
        this.resize();
      });
      this.resizeObserver.observe(holder);
    }
  }

  /** RowManager lifecycle: release observers, timers, and idle callbacks. */
  destroy(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.resizeInvalidateTimer !== null) {
      clearTimeout(this.resizeInvalidateTimer);
      this.resizeInvalidateTimer = null;
    }
    this.resizePendingInvalidate = false;
    this._cancelIdlePrewarm();
  }

  clearRows(): void {
    const tableElement = this._self().tableElement;
    this._detachAllRendered();
    tableElement.style.paddingTop = '0';
    tableElement.style.paddingBottom = '0';
    this._resetHeightIndex(0);
    this.dataHeights = new WeakMap(); // new dataset: previous heights are meaningless
    this.deferredScrollTop = NaN;
    this._cancelIdlePrewarm();
    // Recalibrate the frozen estimate from the next dataset's first window;
    // estimateHeight itself stays as the seed.
    this.estimateFrozen = false;
    this._setScrollTop(0);
  }

  renderRows(): void {
    // Zero scrollTop only on a truly fresh render (post-clearRows / setData);
    // pipeline-driven re-renders that route through here keep their position.
    if (this.rowsCountCached === 0) {
      this._setScrollTop(0);
    }
    this._renderWindow();
  }

  /**
   * RowManager lifecycle: structural re-render (sort / filter / tree
   * toggle). Renders and retains relative position ONLY — anchoring policy
   * (which row to favour) lives in the AnchoringPolicy module, which applies
   * corrections via setAnchor after this returns, pre-paint.
   */
  rerenderRows(callback?: () => void): void {
    const self = this._self();
    const left = self.table.rowManager.element.scrollLeft;

    this._detachAllRendered();
    if (callback) {
      callback();
    }
    // Stage 2b: rebuild the positional index from the durable height cache
    // so previously-measured rows keep their real height across the change.
    const rowsAfter = self.table.rowManager.getDisplayRows();
    this._rebuildIndexFromCache(rowsAfter);
    // Rendered rows still re-measure on attach (confirming the seed);
    // off-screen rows keep the seeded value until they enter the window.
    for (const row of rowsAfter) {
      row.deinitializeHeight?.();
    }

    this._renderWindow();
    if (rowsAfter.length === 0) {
      self.table.rowManager.tableEmpty?.(); // show the placeholder, like stock
    }
    self.table.rowManager.scrollHorizontal(left); // stock-parity tail
  }

  /** Renderer contract (stock parity): sync horizontal scroll position. */
  scrollColumns(left: number): void {
    this._self().table.rowManager.scrollHorizontal(left);
  }

  /** RowManager lifecycle: holder scroll event (reads live scrollTop). */
  scrollRows(_top: number, _dir: boolean): void {
    const holder = this._self().elementVertical;
    const top = holder.scrollTop;

    // Echo suppression: a scroll event matching pendingProgrammaticScrollTop
    // is the browser echoing our own _setScrollTop write — the caller already
    // rendered, so a re-render here would visibly shift the window. ±1px
    // tolerance because browsers round fractional scrollTop writes. One-shot;
    // the NaN "nothing pending" case falls through naturally.
    if (Math.abs(top - this.pendingProgrammaticScrollTop) < 1) {
      this.pendingProgrammaticScrollTop = NaN;
      return;
    }
    this.pendingProgrammaticScrollTop = NaN;

    // Coalesce to one _scrollFrame per paint — only the latest scrollTop
    // matters by the next frame. A RAF requested inside a scroll handler
    // runs in the SAME rendering update, so this adds no latency.
    if (this.rafScheduled) {
      return;
    }
    this._scheduleScrollRaf(() => this._scrollFrame());
  }

  /**
   * One per-paint scroll step — RAF-coalesced by scrollRows, and
   * self-rescheduled while a fast fling is being deferred.
   *
   * Fast-fling deferral: while scrollTop moves faster than one viewport per
   * frame AND nothing rendered intersects the viewport, a render would be a
   * 100% window replacement discarded next frame — skip it and keep watching.
   * Velocity (not overlap alone) is the gate so a gesture that slows back to
   * readable speed renders immediately; delta 0 is the settle render. The
   * RAF stability check deliberately replaces `scrollend`, which never fires
   * while the scrollbar thumb is held still.
   *
   * Layout-read contract: ALL layout reads happen at frame entry, never
   * after `_renderWindow`'s DOM writes — a post-write read forces a full
   * style+layout flush per frame.
   */
  private _scrollFrame(): void {
    const holder = this._self().elementVertical;
    const scrollTop = holder.scrollTop;
    // Consumed in the tail, read here per the layout-read contract above.
    const scrollLeft = this._self().table.rowManager.element.scrollLeft;
    // ResizeObserver-maintained cache; live read only before the first
    // initialize()/resize() seeds it. The gate tolerates resize-lag.
    const clientHeight = this.lastClientHeight || holder.clientHeight;

    // Per-frame velocity. deferredScrollTop is NaN when no scroll frame ran
    // recently → delta NaN → `!(delta <= clientHeight)` treats it as fast.
    const delta = Math.abs(scrollTop - this.deferredScrollTop);
    this.deferredScrollTop = scrollTop;

    if (!(delta <= clientHeight) && this._zeroOverlap(scrollTop, clientHeight)) {
      // Scroll events stop once the position stops changing — the settle
      // check must self-schedule.
      this._scheduleScrollRaf(() => this._scrollFrame());
      return;
    }

    // Scroll-driven renders skip the estimate flush (sticky-estimate rule).
    this.inScrollDrivenRender = true;
    try {
      this._renderWindow();
    } finally {
      this.inScrollDrivenRender = false;
    }
    // Pipe horizontal scroll (stock parity) only when it actually changed —
    // Tabulator's scrollHorizontal writes DOM + dispatches unconditionally.
    if (scrollLeft !== this.lastPipedScrollLeft) {
      this.lastPipedScrollLeft = scrollLeft;
      this._self().table.rowManager.scrollHorizontal(scrollLeft);
    }
  }

  /** Book `fn` on the shared scroll RAF slot (see rafScheduled). */
  private _scheduleScrollRaf(fn: () => void): void {
    this.rafScheduled = true;
    requestAnimationFrame(() => {
      this.rafScheduled = false;
      fn();
    });
  }

  /**
   * The single way to write scrollTop programmatically: records the value in
   * `pendingProgrammaticScrollTop` FIRST so scrollRows suppresses the echoed
   * scroll event (see that field's comment for the 1px-tolerance rationale).
   */
  private _setScrollTop(top: number): void {
    this.pendingProgrammaticScrollTop = top;
    this._self().elementVertical.scrollTop = top;
  }

  /**
   * True when nothing currently rendered intersects the viewport at
   * `scrollTop` — the user is looking at pure padding and a render would
   * replace the entire window. Two binary searches (O(log² n)), no DOM
   * reads or writes. An empty rendered range counts as overlap (first
   * paint must render).
   */
  private _zeroOverlap(scrollTop: number, clientHeight: number): boolean {
    if (this.renderedRange.bottom < this.renderedRange.top) {
      return false;
    }
    const visTop = this._findRowAt(scrollTop);
    const visBottom = this._findRowAt(scrollTop + clientHeight);
    return visBottom < this.renderedRange.top || visTop > this.renderedRange.bottom;
  }

  /**
   * RowManager lifecycle + ResizeObserver entry: detect holder size changes.
   * Width change ⇒ debounced full height invalidation (text re-wraps);
   * during the drag we render with stale heights and snap correct on the
   * trailing edge.
   */
  resize(): void {
    const holder = this._self().elementVertical;
    const cw = holder.clientWidth;
    const widthChanged = Math.abs(cw - this.lastClientWidth) > RESIZE_WIDTH_THRESHOLD_PX;
    if (this.lastClientWidth !== 0 && widthChanged) {
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
    const ch = holder.clientHeight;
    // Same subpixel threshold for both dimensions — retina layout jitter
    // can wiggle clientHeight by 0.5px without anything meaningful changing.
    const heightChanged = Math.abs(ch - this.lastClientHeight) > RESIZE_WIDTH_THRESHOLD_PX;
    this.lastClientWidth = cw;
    this.lastClientHeight = ch;

    // No-op guard — see lastClientWidth/Height field comment.
    if (!widthChanged && !heightChanged && !this.resizePendingInvalidate) {
      return;
    }

    // A grown viewport can expose paddingBottom past the small overscan, and
    // tabulator does NOT auto-re-render fixedHeight tables on resize
    // (tabulator_esm.mjs:26875) — so render ourselves. RAF-deferred: the base
    // contract forbids SYNCHRONOUS rerenders here (tabulator_esm.mjs:23558),
    // and the shared slot collapses scroll-during-resize into one render.
    if (this.rafScheduled) {
      return;
    }
    this._scheduleScrollRaf(() => this._renderWindow());
  }

  /**
   * Invalidate every measured height (holder width changed → text wrap may
   * differ). The next render re-measures from the DOM; `estimateHeight`
   * stays as the seed. Also drops the durable cache and deinitializes every
   * row's height — without that, the heightInitialized fast path would feed
   * stale pre-resize heights back into the empty Fenwick.
   */
  private _invalidateMeasuredHeights(): void {
    this._resetHeightIndex(this.measuredHeight.length);
    this.dataHeights = new WeakMap();
    for (const row of this._self().table.rowManager.getDisplayRows()) {
      row.deinitializeHeight?.();
    }
  }

  /**
   * Scroll so `row` sits at the top of the holder (RowManager entry point).
   * Delegates to the anchor engine: gains clamping, the reconcile loop for
   * far unmeasured targets, and the DOM-truth snap.
   */
  scrollToRow(row: RowInternals): void {
    const idx = this._indexOfRow(row);
    if (idx < 0) {
      return;
    }
    this._anchorRowAt(idx, row, 0);
  }

  /**
   * Anchor a row at a given Y inside the holder — the single seam used by
   * the AnchoringPolicy module. Synchronous (no RAF), so the corrected
   * window is in the DOM on the same paint. Idempotent.
   */
  setAnchor(row: RowInternals, offsetFromHolderTop: number): void {
    const idx = this._indexOfRow(row);
    if (idx < 0) {
      return;
    }
    this._anchorRowAt(idx, row, offsetFromHolderTop);
  }

  /**
   * Scroll so the row at `index` sits at `align` ('start' | 'center' |
   * 'end', or an exact pixel offset from the holder top). Converges via the
   * reconcile engine even for never-measured targets.
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
   * Reconcile engine shared by scrollToRow / setAnchor / scrollToIndex.
   * One estimate-placed render can't reach a far row (the browser clamps
   * scrollTop to the current document height), so: place via cumHeight →
   * render → DOM-truth snap once the row is in the window, else re-place.
   * Bounded; bails when the window stops moving.
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
      this._setScrollTop(placed);
      this._renderWindow();

      const el = row.getElement();
      if (el && el.parentNode) {
        // Anchor is in the window → DOM-truth snap, converged.
        const desired = el.offsetTop - offsetFromHolderTop;
        const maxScrollPost = Math.max(0, elementVertical.scrollHeight - clientHeight);
        const corrected = Math.max(0, Math.min(desired, maxScrollPost));
        if (Math.abs(corrected - elementVertical.scrollTop) > 0.5) {
          this._setScrollTop(corrected);
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

  /** Renderer contract: is `row` nearer the window top than the bottom? */
  scrollToRowNearestTop(row: RowInternals): boolean {
    const idx = this._indexOfRow(row);
    if (idx < 0) {
      return true;
    }
    return Math.abs(this.vDomTop - idx) <= Math.abs(this.vDomBottom - idx);
  }

  /**
   * Renderer contract: scroll `row` to `position` ('top' | 'middle' |
   * 'bottom' | 'nearest'), honouring the scrollToRow* table options.
   */
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

      const self = this._self();
      const ev = self.elementVertical;
      const opts = self.table.options;

      const useIfVisible = ifVisible ?? opts.scrollToRowIfVisible;
      if (useIfVisible === false) {
        const rowTop = this._cumHeight(idx);
        const rowBottom = rowTop + this._heightOf(idx);
        if (rowTop >= ev.scrollTop && rowBottom <= ev.scrollTop + ev.clientHeight) {
          resolve();
          return;
        }
      }

      const rawPosition = position ?? opts.scrollToRowPosition ?? 'top';
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

  /** RowManager lifecycle: rows in the window (optionally overscan too). */
  visibleRows(includingBuffer?: boolean): RowInternals[] {
    const self = this._self();
    const all = self.table.rowManager.getDisplayRows();
    if (this.vDomBottom < this.vDomTop) {
      return [];
    }
    if (includingBuffer) {
      return all.slice(this.vDomTop, this.vDomBottom + 1);
    }
    const elementVertical = self.elementVertical;
    const top = elementVertical.scrollTop;
    const bottom = top + elementVertical.clientHeight;
    const result: RowInternals[] = [];
    // One Fenwick seed, then exact O(1) accumulation per row
    // (rowTop + heightOf(i) === cumHeight(i + 1) by construction).
    let rowTop = this._cumHeight(this.vDomTop);
    for (let i = this.vDomTop; i <= this.vDomBottom; i++) {
      const rowBottom = rowTop + this._heightOf(i);
      if (rowBottom > top && rowTop < bottom) {
        const row = all[i];
        if (row) {
          result.push(row);
        }
      }
      rowTop = rowBottom;
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

    // Lock the estimate for this render call (see _lockedEstimate);
    // try/finally so an exception still unlocks.
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
    // ResizeObserver-maintained cache instead of a live clientHeight read —
    // this runs on every scroll frame and clientHeight forces style+layout
    // when anything dirtied it earlier in the frame. Live read only before
    // the first initialize()/resize() has seeded the cache.
    const clientHeight =
      this.lastClientHeight > 0 ? this.lastClientHeight : elementVertical.clientHeight;

    if (rows.length === 0) {
      this._detachAllRendered();
      self.tableElement.style.paddingTop = '0';
      self.tableElement.style.paddingBottom = '0';
      // Stock dispatches after every fill, including empty ones — GroupRows
      // relies on it to set minWidth when no data rows are visible.
      self.dispatch('render-virtual-fill');
      return;
    }

    // Pre-render clamp: if the document shrunk (sort/filter), pull scrollTop
    // into range so findRowAt math is valid — and write it to the DOM, never
    // just locally. Bound choice: structural renders trust the model (DOM
    // hasn't reflowed yet); scroll-driven renders trust the DOM (clamping to
    // an undershooting estimate would bounce the user off the bottom).
    // Skipped entirely on scroll frames far from the end, where it provably
    // cannot trigger — saves the per-frame scrollHeight read.
    let scrollTop = elementVertical.scrollTop;
    if (!(this.inScrollDrivenRender && scrollTop + 2 * clientHeight <= this._totalHeight())) {
      const maxScroll = this.inScrollDrivenRender
        ? Math.max(0, elementVertical.scrollHeight - clientHeight)
        : Math.max(0, this._totalHeight() - clientHeight);
      if (scrollTop > maxScroll) {
        this._setScrollTop(maxScroll);
        scrollTop = maxScroll;
      }
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

    // Coverage iteration: if the locked estimate over-counted heights, the
    // rendered window may stop short of a viewport edge (blank padding shows).
    // Re-check both edges with the just-measured rows and extend; bounded,
    // converges in 1–2 passes. The locked estimate (not flushed mid-render)
    // keeps the padding math stable across iterations.
    const MAX_COVERAGE_ITER = 4;
    let coverageIter = 0;
    while (coverageIter++ < MAX_COVERAGE_ITER) {
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
            this.renderedRange.top = newTop;
            this.renderedRange.bottom = newBottom;
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
            // The OLD renderedRange.top must still be in place here —
            // _attachRanges uses it to route this range to insertBefore.
            const oldTop = newTop;
            this._attachRanges(rows, [[desired, oldTop - 1]], desired);
            newTop = desired;
            this.renderedRange.top = newTop;
            this.renderedRange.bottom = newBottom;
            extended = true;
          }
        }
      }

      if (!extended) {
        break;
      }
    }

    const paddingTop = this._cumHeight(newTop);
    // Force 0 at the last row — float drift in the subtraction would show
    // as a hairline gap at the very bottom.
    const paddingBottom =
      newBottom === lastIdx ? 0 : Math.max(0, this._totalHeight() - this._cumHeight(newBottom + 1));
    self.tableElement.style.paddingTop = `${paddingTop}px`;
    self.tableElement.style.paddingBottom = `${paddingBottom}px`;

    this.vDomTop = newTop;
    this.vDomBottom = newBottom;
    this.renderedRange.top = newTop;
    this.renderedRange.bottom = newBottom;

    // Stage 2c: absorb above-viewport measurement deltas into scrollTop so
    // visible content stays pinned (the scroll-up judder fix). The
    // scrollHeight read is an accepted necessary reflow — it must observe the
    // paddings just written — and is only paid when deltas actually occurred.
    if (this.renderVisTop >= 0) {
      if (this.pendingScrollAdjust !== 0) {
        const domMax = Math.max(0, elementVertical.scrollHeight - clientHeight);
        const corrected = Math.max(0, Math.min(scrollTop + this.pendingScrollAdjust, domMax));
        if (Math.abs(corrected - elementVertical.scrollTop) > 0.5) {
          this._setScrollTop(corrected);
        }
      }
      this.pendingScrollAdjust = 0;
      this.renderVisTop = -1;
    }

    // Sticky-estimate rule: flush only on structural renders, like stock's
    // vDomRowHeight (a mid-scroll mean shift would jump or tug the user).
    if (!this.inScrollDrivenRender) {
      this._flushEstimateUpdate();
    }

    // Stock-contract event: fired after every FILL (structural render, or a
    // scroll that fully replaced the window) but not after incremental
    // scroll ticks — GroupRows uses it to fix table minWidth when only
    // group headers are visible.
    if (!this.inScrollDrivenRender || this.lastDiffWasFill) {
      this._self().dispatch('render-virtual-fill');
    }

    // Build cells for rows just beyond the new window during idle time, so
    // the next scroll into them pays only measurement (cold first-attach
    // measured ~1.5-2.3× steady-state without this).
    this._scheduleIdlePrewarm();
  }

  // ---------------------------------------------------------------------------
  // Idle pre-warm — off-frame cell construction for rows near the window
  // ---------------------------------------------------------------------------

  private _cancelIdlePrewarm(): void {
    if (this.idlePrewarmHandle !== null && typeof cancelIdleCallback === 'function') {
      cancelIdleCallback(this.idlePrewarmHandle);
    }
    this.idlePrewarmHandle = null;
  }

  /**
   * (Re)schedule the idle pre-warmer. One callback in flight at a time; each
   * render re-schedules so the walker always starts from the CURRENT window
   * edges. No-op where requestIdleCallback is unavailable (jsdom/node tests)
   * — pre-warm is purely an optimization, never load-bearing.
   */
  private _scheduleIdlePrewarm(): void {
    if (typeof requestIdleCallback !== 'function') {
      return;
    }
    this._cancelIdlePrewarm();
    this.idlePrewarmHandle = requestIdleCallback((deadline) => {
      this.idlePrewarmHandle = null;
      this._idlePrewarm(deadline);
    });
  }

  /**
   * Build cells (off-DOM, inFragment flag) for rows beyond each window edge,
   * walking outward and alternating sides. Strictly construction — no
   * measurement, no Fenwick writes, so the coordinate space is untouched.
   * Deadline- and slot-capped; re-schedules itself while work remains.
   */
  private _idlePrewarm(deadline: IdleDeadline): void {
    if (this.renderedRange.bottom < this.renderedRange.top) {
      return;
    }
    const rows = this._self().table.rowManager.getDisplayRows();
    if (rows.length === 0) {
      return;
    }
    let below = this.renderedRange.bottom + 1;
    let above = this.renderedRange.top - 1;
    const belowMax = Math.min(rows.length - 1, this.renderedRange.bottom + IDLE_PREWARM_SPAN_ROWS);
    const aboveMin = Math.max(0, this.renderedRange.top - IDLE_PREWARM_SPAN_ROWS);
    let nextBelow = true;
    let built = 0;
    while (below <= belowMax || above >= aboveMin) {
      if (
        deadline.timeRemaining() < IDLE_PREWARM_MIN_REMAINING_MS ||
        built >= IDLE_PREWARM_MAX_ROWS_PER_SLOT
      ) {
        // Out of idle/slot budget with work remaining — continue next slot.
        this._scheduleIdlePrewarm();
        return;
      }
      let idx: number;
      if (nextBelow && below <= belowMax) {
        idx = below++;
      } else if (above >= aboveMin) {
        idx = above--;
      } else {
        idx = below++;
      }
      nextBelow = !nextBelow;
      const row = rows[idx];
      if (row && !row.initialized) {
        row.initialize(false, true);
        built++;
      }
    }
  }

  // Scratch buffers for _diffRender, reused across calls (it runs once per
  // scroll frame; fresh arrays per frame are avoidable GC churn).
  private detachRangesScratch: Array<[number, number]> = [];
  private attachRangesScratch: Array<[number, number]> = [];

  // True when the last _diffRender replaced the window from scratch (empty
  // before, or zero overlap) — the equivalent of stock's _virtualRenderFill,
  // which gates the 'render-virtual-fill' dispatch on scroll renders.
  private lastDiffWasFill = false;

  /**
   * Reconcile the rendered range to [newTop, newBottom]: detach rows that
   * left, attach (initialize + measure) rows that entered. estimateHeight is
   * never mutated here — see _flushEstimateUpdate.
   */
  private _diffRender(rows: RowInternals[], newTop: number, newBottom: number): void {
    const oldTop = this.renderedRange.top;
    const oldBottom = this.renderedRange.bottom;
    const oldEmpty = oldBottom < oldTop;
    const newEmpty = newBottom < newTop;
    this.lastDiffWasFill = false;

    if (oldEmpty && newEmpty) {
      return;
    }

    const detachRanges = this.detachRangesScratch;
    const attachRanges = this.attachRangesScratch;
    detachRanges.length = 0;
    attachRanges.length = 0;

    if (oldEmpty) {
      this.lastDiffWasFill = true;
      attachRanges.push([newTop, newBottom]);
    } else if (newEmpty) {
      detachRanges.push([oldTop, oldBottom]);
    } else if (newBottom < oldTop || newTop > oldBottom) {
      this.lastDiffWasFill = true;
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
        const el = row?.getElement();
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
   * Attach the rows in `ranges`: build cells off-DOM inside per-range
   * DocumentFragments (writes only — no flush between inserts), then run the
   * measurement phases ONCE over the union, reads and writes batched so the
   * whole call costs a single forced reflow:
   *
   *   A. rendered()        — per-cell callbacks; content mutations land
   *                          before measurement (first attach only on
   *                          scroll renders)
   *   B. clearCellHeight() — writes
   *   C. calcHeight(true)  — reads offsetHeight — THE layout flush
   *   D. setCellHeight()   — writes
   *   E. getHeight()       — cached from C, feeds the Fenwick
   */
  private _attachRanges(
    rows: RowInternals[],
    ranges: Array<[number, number]>,
    newTop: number,
  ): void {
    const self = this._self();
    const tableElement = self.tableElement;
    const allAttached: Array<{
      row: RowInternals;
      index: number;
      wasUninitialized: boolean;
      wasSettled: boolean;
    }> = [];

    for (const [from, to] of ranges) {
      const fragment = document.createDocumentFragment();
      const rangeStart = allAttached.length;

      for (let i = from; i <= to; i++) {
        const row = rows[i];
        if (!row) {
          continue;
        }
        const wasUninitialized = !row.initialized;
        // Parity classes only on first attach or structural renders: a
        // row's index — hence its even/odd class — is scroll-invariant, so
        // scroll re-attaches keep the class they already have.
        if (wasUninitialized || !this.inScrollDrivenRender) {
          self.styleRow(row, i);
        }
        // inFragment=true: cell construction off-DOM.
        if (wasUninitialized) {
          row.initialize(false, true);
        }
        const el = row.getElement();
        if (el.parentNode && el.parentNode !== fragment) {
          el.parentNode.removeChild(el);
        }
        fragment.appendChild(el);
        // Settled = measured AND height-initialized AT ATTACH TIME. Must be
        // captured here: Phase D (setCellHeight) flips heightInitialized to
        // true, so reading it in Phase E would also match rows that were
        // JUST re-measured and still need their Fenwick refresh.
        const wasSettled = row.heightInitialized === true && this.isMeasured[i] === 1;
        allAttached.push({ row, index: i, wasUninitialized, wasSettled });
      }

      if (allAttached.length === rangeStart) {
        continue;
      }

      // Insertion point. renderedRange/newTop are fixed for the whole call,
      // so per-range evaluation is order-independent: an above-window range
      // prepends via insertBefore(firstChild) whether it is processed
      // before or after a below-window range.
      const isAbove =
        from <= newTop && to < this.renderedRange.top && this.renderedRange.bottom >= 0;
      const insertAtTop = to < newTop || (newTop <= from && from < this.renderedRange.top);
      if (isAbove || (insertAtTop && tableElement.firstChild)) {
        tableElement.insertBefore(fragment, tableElement.firstChild);
      } else {
        tableElement.appendChild(fragment);
      }
    }

    if (allAttached.length === 0) {
      return;
    }

    // Phase A: rendered(). On scroll renders, first-attach only — cell DOM
    // persists across detach/attach, and re-dispatching cellRendered per
    // cell per frame was the biggest live-tick cost. Structural renders
    // fire for all rows, mirroring stock.
    for (const entry of allAttached) {
      if (!this.inScrollDrivenRender || entry.wasUninitialized) {
        entry.row.rendered();
      }
    }

    // Phases B–D, guarded by heightInitialized (measured rows fast-path).
    // Never skip for speed: unmeasured rows would render at un-normalized
    // heights AND leave the Fenwick out of sync with the real DOM stack.
    for (const entry of allAttached) {
      if (!entry.row.heightInitialized) {
        entry.row.clearCellHeight();
      }
    }
    for (const entry of allAttached) {
      if (!entry.row.heightInitialized) {
        entry.row.calcHeight(true);
      }
    }
    for (const entry of allAttached) {
      if (!entry.row.heightInitialized) {
        entry.row.setCellHeight();
      }
    }

    // Phase E: feed the height cache. row.getHeight() returns cached
    // outerHeight from Phase C — no new offsetHeight read, no extra reflow.
    // Settled rows (measured + height-initialized at attach time, i.e. the
    // B–D fast path) are skipped outright: their height can't have changed
    // without something clearing heightInitialized first (deinitializeHeight
    // / width invalidation), so _setHeight would just early-return anyway.
    // Rows re-seeded by the Stage 2b rebuild (isMeasured=1 but
    // heightInitialized false) still run — Phase C just re-measured them and
    // the Fenwick must pick up the fresh value.
    for (const entry of allAttached) {
      if (entry.wasSettled) {
        continue;
      }
      // PseudoRows (groups) return undefined here — they stay unmeasured
      // and estimate-priced, matching stock.
      const h = entry.row.getHeight();
      if (h !== undefined && h > 0) {
        this._setHeight(entry.index, h, entry.row.data);
      }
    }
  }

  private _detachAllRendered(): void {
    this._self().tableElement.replaceChildren();
    this.vDomTop = 0;
    this.vDomBottom = -1;
    this.renderedRange.top = 0;
    this.renderedRange.bottom = -1;
  }

  // ---------------------------------------------------------------------------
  // Heights — Fenwick-backed
  // ---------------------------------------------------------------------------

  /**
   * Reset the positional height index to "all rows unmeasured" for
   * `rowsCount` rows. Reallocates only on length change (in-place fill
   * otherwise — avoids GC on same-size resets). estimateHeight is untouched.
   */
  private _resetHeightIndex(rowsCount: number): void {
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
    // Unmeasured-count tree starts at 1 per row.
    this.fenwickUnmeasuredCount.bulkInitConstant(1);
    this.measuredSum = 0;
    this.measuredCount = 0;
    this.rowsCountCached = rowsCount;
  }

  /** Re-sync the height index to the current display-row count. */
  private _resyncToRowsCount(wipe: boolean): void {
    const rowsCount = this._self().table.rowManager.getDisplayRows().length;
    if (!wipe && this.measuredHeight.length === rowsCount) {
      return;
    }
    this._resetHeightIndex(rowsCount);
  }

  /**
   * Stage 2b: reset the positional index for the new display order, then seed
   * it from the durable data→height cache so previously-measured rows keep
   * their real height across sort/filter/tree toggles. Uncached rows stay on
   * the estimate until they enter the window.
   */
  private _rebuildIndexFromCache(rows: RowInternals[]): void {
    const rowsCount = rows.length;
    this._resetHeightIndex(rowsCount);

    // Direct first-measurement Fenwick writes (arrays were just zeroed).
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
   * Record a measurement: Fenwicks, running stats, and the durable cache.
   * Never mutates estimateHeight (deferred to `_flushEstimateUpdate` —
   * locked-estimate invariant).
   */
  private _setHeight(i: number, h: number, dataKey?: object): void {
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
    // Durable cache write only on first/changed measurements — unchanged
    // repeats already hold the right entry, and this is per-row hot-path.
    if (dataKey !== undefined) {
      this.dataHeights.set(dataKey, h);
    }
    // Stage 2c: above-viewport size deltas shift everything visible —
    // accumulate so the render pins content via scrollTop (see field).
    if (this.renderVisTop >= 0 && i < this.renderVisTop) {
      const prior = wasMeasured ? oldH : (this._lockedEstimate ?? this.estimateHeight);
      this.pendingScrollAdjust += h - prior;
    }
    if (wasMeasured) {
      this.fenwickMeasured.update(i, h - oldH);
      this.measuredSum += h - oldH;
    } else {
      this.fenwickMeasured.update(i, h);
      this.fenwickUnmeasuredCount.update(i, -1);
      this.isMeasured[i] = 1;
      this.measuredSum += h;
      this.measuredCount += 1;
    }
    this.measuredHeight[i] = h;
  }

  /** One-shot estimate calibration; no-op once frozen (see estimateFrozen). */
  private _flushEstimateUpdate(): void {
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
   * Index of the row at document Y — binary search over the cumHeight
   * oracle, O(log² n).
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
    // Largest i with cumHeight(i) ≤ y, then i-1 = the row containing y.
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
   * The per-row height (measured if known, else estimate). O(1) — reads the
   * shadow arrays, no Fenwick query. By construction,
   * `cumHeight(i) + heightOf(i) === cumHeight(i + 1)`.
   */
  private _heightOf(i: number): number {
    if (i < 0 || i >= this.measuredHeight.length) {
      return 0;
    }
    const est = this._lockedEstimate ?? this.estimateHeight;
    return this.isMeasured[i] === 1 ? (this.measuredHeight[i] ?? est) : est;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** Typed view of the fields the Renderer base class sets at runtime. */
  private _self(): RendererBase {
    return this as unknown as RendererBase;
  }

  /**
   * Adaptive overscan row count for the current viewport (~quarter viewport
   * of rows), clamped to [OVERSCAN_MIN, OVERSCAN_MAX]. Deliberately small —
   * render cost is linear in rendered rows; coverage iteration and idle
   * pre-warm absorb the cases a bigger buffer would.
   */
  private _resolveOverscanRows(clientHeight: number): number {
    const est = Math.max(1, this.estimateHeight);
    const adaptive = Math.round(clientHeight / 4 / est);
    return Math.max(OVERSCAN_MIN, Math.min(OVERSCAN_MAX, adaptive));
  }

  private _indexOfRow(row: RowInternals): number {
    return this._self().table.rowManager.getDisplayRows().indexOf(row);
  }
}
