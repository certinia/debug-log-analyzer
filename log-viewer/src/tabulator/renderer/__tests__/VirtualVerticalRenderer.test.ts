import { describe, expect, it, jest } from '@jest/globals';

import { VirtualVerticalRenderer } from '../VirtualVerticalRenderer';
import { seedHeightIndex, type HeightIndexInternals, type RowStubBase } from './rendererTestUtils';

// Node-env stub: row elements are plain offset objects, not real DOM.
type RowStub = RowStubBase<{ offsetTop: number; parentNode: object | null; style: object }>;

/**
 * The renderer's private height bookkeeping and scroll surface, reached by cast.
 * The Renderer base class constructor (tabulator_esm.mjs:23489) only needs the
 * minimal table `makeTable` builds.
 */
interface RendererInternals extends HeightIndexInternals {
  estimateHeight: number;
  _setHeight: (i: number, h: number, dataKey?: object) => void;
  _heightOf: (i: number) => number;
  _cumHeight: (i: number) => number;
  _totalHeight: () => number;
  _findRowAt: (y: number) => number;
  _flushEstimateUpdate: () => void;
  _rebuildIndexFromCache: (rows: Array<{ data?: object }>) => void;
  _resolveOverscanRows: (clientHeight: number) => number;
  setAnchor: (row: RowStub, offset: number) => void;
  scrollToIndex: (i: number, align?: unknown) => void;
  scrollToRowPosition: (
    row: RowStub,
    position: string | undefined,
    ifVisible: boolean | undefined,
  ) => Promise<void>;
  rerenderRows: (cb?: () => void) => void;
  initialize: () => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  elementVertical: any;
}

/**
 * A renderer over `rows`, its height index seeded for `seedCount` unmeasured
 * rows. `setDisplayRows` swaps what the pipeline hands back, as a sort or a
 * filter would.
 */
function makeTable(
  rows: RowStub[] = [],
  seedCount = rows.length,
): { r: RendererInternals; setDisplayRows: (next: RowStub[]) => void; tableEmpty: jest.Mock } {
  let current = rows;
  const tableEmpty = jest.fn();
  const table = {
    rowManager: {
      element: { scrollTop: 0, clientHeight: 100, scrollHeight: 10000, clientWidth: 200 },
      tableElement: {
        style: { paddingTop: '0', paddingBottom: '0' },
        firstChild: null,
        replaceChildren: () => {},
      },
      getDisplayRows: () => current,
      scrollHorizontal: () => {},
      tableEmpty,
    },
    columnManager: { element: {}, getWidth: () => 200 },
    options: {},
    eventBus: { _events: {}, dispatch: () => {} },
  };
  const Ctor = VirtualVerticalRenderer as unknown as new (table: unknown) => unknown;
  const r = new Ctor(table) as RendererInternals;
  seedHeightIndex(r, seedCount);
  return {
    r,
    setDisplayRows: (next) => {
      current = next;
    },
    tableEmpty,
  };
}

function makeRenderer(rowsCount: number): RendererInternals {
  return makeTable([], rowsCount).r;
}

function makeRowStub(offsetTop: number, attached = true, heightInitialized = true): RowStub {
  // `attached` controls Pass 2 (DOM-truth snap) reachability. setAnchor
  // tests want it true so Pass 2 runs and we exercise both passes.
  // rerenderRows anchor tests want it false: their row stubs can't
  // simulate the layout engine updating offsetTop after a re-render, so
  // letting Pass 2 read the stale stub offsetTop would corrupt Pass 1's
  // already-correct scrollTop.
  // `heightInitialized` defaults to true (a previously-measured row).
  // Pass false to simulate the row Tabulator's DataTree.expandRow /
  // collapseRow just reinitialize()'d — anchor capture should prefer
  // this row over the closest-to-scrollTop one.
  const el = {
    offsetTop,
    parentNode: attached ? { nodeType: 1 } : null,
    style: {},
  };
  return {
    initialized: false,
    heightInitialized,
    initialize: () => {},
    calcHeight: () => {},
    setCellHeight: () => {},
    clearCellHeight: () => {},
    rendered: () => {},
    getElement: () => el,
    getHeight: () => 0,
    deinitializeHeight: () => {},
  };
}

// Stub the DOM-bound _renderWindow on the instance so setAnchor's math
// path is testable in a node environment. setAnchor's contract is "place
// row at requested Y"; the render itself is covered by integration use.
function stubRenderWindow(r: RendererInternals): void {
  (r as unknown as { _renderWindow: () => void })._renderWindow = () => {};
}

/** `count` rows of `height`px, every one measured and the estimate flushed. */
function makeMeasured(
  count: number,
  height: number,
  attached = true,
): ReturnType<typeof makeTable> & { rows: RowStub[] } {
  const rows = Array.from({ length: count }, (_, i) => makeRowStub(i * height, attached));
  const built = makeTable(rows);
  for (let i = 0; i < count; i++) {
    built.r._setHeight(i, height);
  }
  built.r._flushEstimateUpdate();
  stubRenderWindow(built.r);
  return { ...built, rows };
}

describe('VirtualVerticalRenderer height bookkeeping', () => {
  it('uses estimateHeight for unmeasured rows', () => {
    const r = makeRenderer(10);
    expect(r._heightOf(0)).toBe(r.estimateHeight);
    expect(r._cumHeight(5)).toBe(5 * r.estimateHeight);
    expect(r._totalHeight()).toBe(10 * r.estimateHeight);
  });

  it('setHeight tracks running stats but does NOT mutate estimateHeight until _flushEstimateUpdate', () => {
    const r = makeRenderer(4);
    const baseEstimate = r.estimateHeight;
    r._setHeight(0, 50);
    expect(r.estimateHeight).toBe(baseEstimate); // locked during render
    r._setHeight(1, 100);
    expect(r.estimateHeight).toBe(baseEstimate); // still locked
    expect(r.measuredSum).toBe(150);
    expect(r.measuredCount).toBe(2);
    r._flushEstimateUpdate();
    expect(r.estimateHeight).toBe(75); // (50 + 100) / 2
    expect(r._heightOf(2)).toBe(75); // unmeasured row now uses new estimate
  });

  it('calibrates the estimate once then freezes it (Stage 2a — no later drift)', () => {
    // The estimate must NOT keep tracking the running mean. At scale a drifting
    // mean re-prices all unmeasured rows and lurches the coordinate space. After
    // the first flush it is frozen; measuring taller rows later does not move it.
    const r = makeRenderer(4);
    r._setHeight(0, 20);
    r._setHeight(1, 40);
    r._flushEstimateUpdate();
    expect(r.estimateHeight).toBe(30); // (20 + 40) / 2, calibrated + frozen

    // Later, much taller rows are measured (e.g. wrapped text deep in the tree).
    r._setHeight(2, 120);
    r._setHeight(3, 120);
    r._flushEstimateUpdate(); // frozen → no-op
    expect(r.estimateHeight).toBe(30); // unchanged — NOT the new mean (75)
  });

  it('persists measured heights by data object and remaps them on rebuild (Stage 2b)', () => {
    // Measure two rows keyed by their data-object references, then simulate a
    // structural change that reorders them (e.g. a sort, or a tree toggle that
    // shifts indices). The rebuild must re-seed each row's real height at its
    // NEW index from the durable data→height cache — not reset everything to
    // the estimate. Keying by object reference works without any id field:
    // Tabulator reuses the same data objects across expand/collapse and
    // updateData mutates them in place.
    const dataA = { name: 'a' };
    const dataB = { name: 'b' };
    const r = makeRenderer(2);
    r._setHeight(0, 50, dataA);
    r._setHeight(1, 80, dataB);
    expect(r.measuredCount).toBe(2);

    // Rows swap positions; both survive (same data-object references).
    r._rebuildIndexFromCache([{ data: dataB }, { data: dataA }]);

    expect(r.measuredCount).toBe(2); // NOT reset to 0
    expect(r._heightOf(0)).toBe(80); // dataB now at index 0
    expect(r._heightOf(1)).toBe(50); // dataA now at index 1
    expect(r._totalHeight()).toBe(130);
  });

  it('rebuild leaves unknown rows unmeasured (Stage 2b graceful fallback)', () => {
    const dataA = { name: 'a' };
    const r = makeRenderer(2);
    r._setHeight(0, 50, dataA);

    // One known data object, one never-measured data object, plus the
    // defensive no-data case is covered by rows without `.data` elsewhere —
    // unknown rows stay unmeasured and use the estimate.
    r._rebuildIndexFromCache([{ data: dataA }, { data: { name: 'new' } }]);

    expect(r.measuredCount).toBe(1);
    expect(r._heightOf(0)).toBe(50);
    expect(r._heightOf(1)).toBe(r.estimateHeight); // uncached → estimate
  });

  it('cumHeight and totalHeight reflect a mix of measured + estimated after flush', () => {
    const r = makeRenderer(5);
    r._setHeight(0, 10);
    r._setHeight(2, 60);
    r._flushEstimateUpdate();
    // estimateHeight = (10 + 60) / 2 = 35
    expect(r.estimateHeight).toBe(35);
    expect(r._cumHeight(0)).toBe(0);
    expect(r._cumHeight(1)).toBe(10);
    expect(r._cumHeight(2)).toBe(10 + 35); // row 1 unmeasured → 35
    expect(r._cumHeight(3)).toBe(10 + 35 + 60);
    expect(r._cumHeight(5)).toBe(10 + 35 + 60 + 35 + 35);
    const perRow = [0, 1, 2, 3, 4].reduce((sum, i) => sum + r._heightOf(i), 0);
    expect(r._totalHeight()).toBe(perRow);
  });

  it('cumHeight(j) for j ≤ i is unchanged by setHeight(i, h)', () => {
    const r = makeRenderer(5);
    r._setHeight(0, 20);
    r._setHeight(1, 30);
    r._flushEstimateUpdate();
    // Snapshot cumHeights for indices 1, 2, 3 BEFORE measuring row 3.
    const cum1Before = r._cumHeight(1);
    const cum2Before = r._cumHeight(2);
    const cum3Before = r._cumHeight(3);
    // Measure row 3. FenwickA updates at index 3, FenwickB decrements at
    // index 3. estimateHeight is NOT yet flushed (still uses old value).
    r._setHeight(3, 100);
    // cumHeight(j) for j ≤ 3 sums prefix[0..j), which excludes index 3.
    // So all three cumHeights are unchanged — the locked-estimate +
    // Fenwick-at-position-3 update only affects cumHeight(j) for j > 3.
    expect(r._cumHeight(1)).toBe(cum1Before);
    expect(r._cumHeight(2)).toBe(cum2Before);
    expect(r._cumHeight(3)).toBe(cum3Before);
    // cumHeight(4) DOES change: prefix[0..4) now includes the measured 100.
    expect(r._cumHeight(4)).toBe(cum3Before + 100);
  });

  it('findRowAt locates the row containing a given y', () => {
    const r = makeRenderer(5);
    r._setHeight(0, 20);
    r._setHeight(1, 40);
    r._setHeight(2, 60);
    r._setHeight(3, 30);
    r._setHeight(4, 50);
    r._flushEstimateUpdate();
    // cumHeight: 0, 20, 60, 120, 150, 200
    expect(r._findRowAt(0)).toBe(0);
    expect(r._findRowAt(19)).toBe(0);
    expect(r._findRowAt(20)).toBe(1);
    expect(r._findRowAt(59)).toBe(1);
    expect(r._findRowAt(60)).toBe(2);
    expect(r._findRowAt(119)).toBe(2);
    expect(r._findRowAt(120)).toBe(3);
    expect(r._findRowAt(149)).toBe(3);
    expect(r._findRowAt(150)).toBe(4);
    expect(r._findRowAt(1000)).toBe(4);
    expect(r._findRowAt(-100)).toBe(0);
  });

  it('setHeight is idempotent for the same value', () => {
    const r = makeRenderer(2);
    r._setHeight(0, 30);
    const sumAfterFirst = r.measuredSum;
    const countAfterFirst = r.measuredCount;
    r._setHeight(0, 30);
    expect(r.measuredSum).toBe(sumAfterFirst);
    expect(r.measuredCount).toBe(countAfterFirst);
  });

  it('setHeight overwrites previous measurement', () => {
    const r = makeRenderer(2);
    r._setHeight(0, 30);
    r._setHeight(0, 60);
    expect(r.measuredSum).toBe(60);
    expect(r.measuredCount).toBe(1);
    r._flushEstimateUpdate();
    expect(r.estimateHeight).toBe(60);
    expect(r._cumHeight(2)).toBe(60 + 60); // index 0 = 60, index 1 unmeasured = 60
  });

  it('ignores invalid heights', () => {
    const r = makeRenderer(2);
    r._setHeight(0, 0);
    r._setHeight(0, -5);
    r._setHeight(0, NaN);
    r._setHeight(99, 30); // out of range
    expect(r.measuredCount).toBe(0);
    expect(r._totalHeight()).toBe(2 * r.estimateHeight);
  });

  it('handles empty data gracefully', () => {
    const r = makeRenderer(0);
    expect(r._totalHeight()).toBe(0);
    expect(r._findRowAt(0)).toBe(0);
    expect(r._findRowAt(100)).toBe(0);
    expect(r._cumHeight(0)).toBe(0);
  });

  it('overscan: adaptive default scales with viewport but is clamped to [4, 16]', () => {
    const r = makeRenderer(50);
    // estimateHeight defaults to 30. Adaptive = round(clientHeight / 4 / 30).
    // Tiny viewport → clamp to min 4.
    expect(r._resolveOverscanRows(100)).toBe(4);
    // Normal viewport (600 / 4 / 30 = 5) → 5.
    expect(r._resolveOverscanRows(600)).toBe(5);
    // Tall viewport (1200 / 4 / 30 = 10) → 10.
    expect(r._resolveOverscanRows(1200)).toBe(10);
    // Huge viewport → clamp to max 16.
    expect(r._resolveOverscanRows(10000)).toBe(16);
  });
});

describe('VirtualVerticalRenderer.setAnchor', () => {
  it('places a row at the requested offset using DOM-truth offsetTop', () => {
    // 5 rows, all 50px tall; index 3's document Y = 150. To place it at
    // offsetFromHolderTop = 20, scrollTop should be 150 - 20 = 130.
    const { r, rows } = makeMeasured(5, 50);
    r.elementVertical.scrollHeight = r._totalHeight();

    r.setAnchor(rows[3]!, 20);

    expect(r.elementVertical.scrollTop).toBe(130);
  });

  it('clamps the requested anchor scrollTop into [0, maxScroll]', () => {
    // Anchor at index 0 with offset 100 would compute scrollTop = -100.
    const { r, rows } = makeMeasured(3, 40);
    r.elementVertical.scrollHeight = r._totalHeight();

    r.setAnchor(rows[0]!, 100);

    expect(r.elementVertical.scrollTop).toBe(0);
  });

  it('reconciles: retries placement until the anchor enters the window, then DOM-corrects', () => {
    // Stage 2d reconcile loop. Simulate the chicken-and-egg: the anchor row's
    // element is detached (outside the window) on the first render, and only
    // enters the window on the second render (its measurements grew the
    // document). The loop must retry, then DOM-truth snap once it's in.
    const { r, rows } = makeMeasured(3, 50);
    r.elementVertical.scrollHeight = 1000; // tall enough that 90 isn't clamped

    const anchor = rows[2]!;
    const el = anchor.getElement() as { parentNode: object | null; offsetTop: number };
    el.parentNode = null; // not in the window initially
    let renderCount = 0;
    (r as unknown as { _renderWindow: () => void })._renderWindow = () => {
      renderCount++;
      if (renderCount >= 2) {
        el.parentNode = { nodeType: 1 }; // second placement brings it into view
      }
    };

    r.setAnchor(anchor, 10);

    expect(renderCount).toBeGreaterThanOrEqual(2); // it retried, didn't give up
    // Converged to DOM-truth: offsetTop(100) − offset(10) = 90.
    expect(r.elementVertical.scrollTop).toBe(90);
  });

  it('is a no-op when the row is not in displayRows', () => {
    const { r } = makeMeasured(2, 40);
    r.elementVertical.scrollTop = 25;

    r.setAnchor(makeRowStub(999), 0);

    expect(r.elementVertical.scrollTop).toBe(25);
  });
});

describe('VirtualVerticalRenderer.scrollToIndex', () => {
  // 5 rows × 50px, clientHeight 100. cumHeight: 0, 50, 100, 150, 200.
  // scrollHeight set tall enough that the DOM-truth snap is not clamped.
  function makeAlignRenderer(): RendererInternals {
    const { r } = makeMeasured(5, 50);
    r.elementVertical.scrollHeight = 1000;
    return r;
  }

  it.each([
    ["'start': row top lands at the holder top", 'start', 150], // offsetTop(150) − 0
    ["'center': row is centered in the viewport", 'center', 125], // 150 − (100−50)/2
    ["'end': row bottom lands at the holder bottom", 'end', 100], // 150 − (100−50)
    ['numeric align: exact pixel offset from the holder top', 20, 130], // 150 − 20
  ])('%s', (_name, align, scrollTop) => {
    const r = makeAlignRenderer();
    r.scrollToIndex(3, align);
    expect(r.elementVertical.scrollTop).toBe(scrollTop);
  });

  it('is a no-op for an out-of-range index', () => {
    const r = makeAlignRenderer();
    r.elementVertical.scrollTop = 25;
    r.scrollToIndex(99);
    expect(r.elementVertical.scrollTop).toBe(25);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// rerenderRows: scroll preservation
//
// Stage 2d contract: rerenderRows renders at the browser-preserved scrollTop
// and retains relative position via the rebuilt height cache — it does NOT
// anchor. Anchoring (clicked row / middle row / edge snap) is the
// AnchoringPolicy module's job, tested in module/__tests__/AnchoringPolicy.
// ─────────────────────────────────────────────────────────────────────────

describe('VirtualVerticalRenderer.rerenderRows scroll preservation', () => {
  // The all-filtered row is a regression test for the iteration-1/2 bug: the
  // no-survivor branch in rerenderRows used to write scrollTop = 0 explicitly.
  // Iteration 3 deletes that branch — scrollTop must stay where it was, and the
  // browser will clamp downward if the new total scrollHeight is smaller.
  it.each([
    ['a sort (reorder)', 170, (rows: RowStub[]) => [...rows].reverse()],
    [
      'a filter (some rows removed)',
      250,
      (rows: RowStub[]) => [...rows.slice(0, 6), ...rows.slice(7)],
    ],
    [
      'a filter of every rendered row',
      200,
      (rows: RowStub[]) => [...rows.slice(0, 4), ...rows.slice(8)],
    ],
  ])('does not write scrollTop across %s', (_name, scrollTop, next) => {
    const { r, rows, setDisplayRows } = makeMeasured(10, 40, false);
    r.elementVertical.scrollTop = scrollTop;
    r.elementVertical.scrollHeight = r._totalHeight();

    setDisplayRows(next(rows));
    r.rerenderRows();

    // Stock-matching behavior: scrollTop preserved. Middle-row anchoring is
    // the AnchoringPolicy module's job (opt-in), not the renderer's.
    expect(r.elementVertical.scrollTop).toBe(scrollTop);
  });

  // Stock VirtualDomVertical.rerenderRows ends with
  // `this.table.rowManager.tableEmpty();` — this triggers RowManager's
  // placeholder display logic. Mirror that so filter/sort-to-empty shows
  // the `.tabulator-placeholder` element.
  it('calls rowManager.tableEmpty() when the new display is empty', () => {
    const { r, setDisplayRows, tableEmpty } = makeMeasured(3, 40, false);

    setDisplayRows([]);
    r.rerenderRows();

    expect(tableEmpty).toHaveBeenCalledTimes(1);
  });

  it('does NOT call tableEmpty() when the new display is non-empty', () => {
    const { r, tableEmpty } = makeMeasured(3, 40, false);

    r.rerenderRows();

    expect(tableEmpty).not.toHaveBeenCalled();
  });
});

describe('VirtualVerticalRenderer.scrollToRowPosition', () => {
  // 5 rows at 50px each, clientHeight = 100.
  // cumHeight: row0=0, row1=50, row2=100, row3=150, row4=200. Total = 250.
  function makePositionRenderer(scrollTop = 0): { r: RendererInternals; rows: RowStub[] } {
    const { r, rows } = makeMeasured(5, 50);
    r.elementVertical.scrollTop = scrollTop;
    r.elementVertical.scrollHeight = r._totalHeight();
    return { r, rows };
  }

  it.each([
    ["'top': places the row at the top of the viewport", 'top', 100],
    // offsetFromHolderTop = (100 - 50) / 2 = 25. scrollTop = 100 - 25 = 75.
    ["'center': places the row centered in the viewport", 'center', 75],
    // offsetFromHolderTop = 100 - 50 = 50. scrollTop = 100 - 50 = 50.
    ["'bottom': places the row flush with the viewport bottom", 'bottom', 50],
  ])('%s', async (_name, position, scrollTop) => {
    const { r, rows } = makePositionRenderer();
    await r.scrollToRowPosition(rows[2]!, position, true);
    expect(r.elementVertical.scrollTop).toBe(scrollTop);
  });

  // Row2 is at [100, 150]. Viewport [100, 200] holds it; viewport [0, 100] does not.
  it.each([
    ['skips scroll when row is already fully in view', 100],
    ['scrolls when row is outside the viewport', 0],
  ])('ifVisible=false: %s', async (_name, from) => {
    const { r, rows } = makePositionRenderer(from);
    await r.scrollToRowPosition(rows[2]!, 'top', false);
    expect(r.elementVertical.scrollTop).toBe(100);
  });

  it('rejects when the row is not in displayRows', () => {
    const { r } = makePositionRenderer();
    return expect(r.scrollToRowPosition(makeRowStub(999), 'top', true)).rejects.toThrow(
      'Scroll Error - Row not visible',
    );
  });
});

describe('VirtualVerticalRenderer.initialize stock-bug workaround', () => {
  it('overwrites rowManager.renderMode with the string "virtual"', () => {
    // Stock Tabulator's setRenderMode copies `renderVertical` (a class) into
    // rowManager.renderMode. That field is then stringified into the
    // placeholder element's `tabulator-render-mode` attribute. We overwrite
    // it with the string "virtual" inside initialize() to dodge the bug.
    const { r } = makeTable();
    // Simulate the bad state stock leaves us in: renderMode set to the
    // class reference instead of a string.
    r.table.rowManager.renderMode = VirtualVerticalRenderer;

    r.initialize();

    expect(r.table.rowManager.renderMode).toBe('virtual');
  });
});

describe('VirtualVerticalRenderer fast-fling scroll deferral', () => {
  interface DeferRenderer {
    scrollRows: (top: number, dir: boolean) => void;
    renderedRange: { top: number; bottom: number };
  }

  let rafQueue: Array<() => void>;
  const realRaf = globalThis.requestAnimationFrame;

  beforeEach(() => {
    rafQueue = [];
    (globalThis as { requestAnimationFrame: (cb: () => void) => number }).requestAnimationFrame = (
      cb: () => void,
    ) => {
      rafQueue.push(cb);
      return rafQueue.length;
    };
  });

  afterEach(() => {
    (
      globalThis as { requestAnimationFrame: typeof globalThis.requestAnimationFrame }
    ).requestAnimationFrame = realRaf;
  });

  function runNextRaf(): void {
    const cb = rafQueue.shift();
    expect(cb).toBeDefined();
    cb?.();
  }

  function makeDeferSetup(): {
    r: DeferRenderer;
    renderWindow: jest.Mock;
    holder: { scrollTop: number; clientHeight: number };
  } {
    // 1000 unmeasured rows at the default 30px estimate: row i sits at
    // y = i * 30. Viewport is 100px tall; rendered window is rows [0, 10].
    const rows = Array.from({ length: 1000 }, (_, i) => makeRowStub(i * 30, false));
    const { r: base } = makeTable(rows);
    const r = base as unknown as DeferRenderer;
    const renderWindow = jest.fn();
    (base as unknown as { _renderWindow: () => void })._renderWindow = renderWindow as () => void;
    r.renderedRange = { top: 0, bottom: 10 };
    return { r, renderWindow, holder: base.elementVertical };
  }

  it('defers a zero-overlap scroll, then renders once scrollTop is stable', () => {
    const { r, renderWindow, holder } = makeDeferSetup();
    // Row 600 (y=18000) is far outside the rendered window [0, 10].
    holder.scrollTop = 18000;
    r.scrollRows(18000, false);

    // Frame 1: deferred — no render, settle-watch RAF self-scheduled.
    runNextRaf();
    expect(renderWindow).not.toHaveBeenCalled();
    expect(rafQueue.length).toBe(1);

    // Frame 2: scrollTop unchanged → settled → full render fires.
    runNextRaf();
    expect(renderWindow).toHaveBeenCalledTimes(1);
    expect(rafQueue.length).toBe(0);
  });

  it('keeps deferring while scrollTop changes, rendering only at the final position', () => {
    const { r, renderWindow, holder } = makeDeferSetup();
    holder.scrollTop = 18000;
    r.scrollRows(18000, false);
    runNextRaf(); // defer at 18000

    holder.scrollTop = 24000; // still flinging, still zero overlap
    runNextRaf(); // defer at 24000
    expect(renderWindow).not.toHaveBeenCalled();

    runNextRaf(); // 24000 stable → settle render
    expect(renderWindow).toHaveBeenCalledTimes(1);
  });

  it('renders mid-gesture when the drag slows below one viewport per frame', () => {
    const { r, renderWindow, holder } = makeDeferSetup();
    // Fast: teleport far past the rendered window — defers.
    holder.scrollTop = 18000;
    r.scrollRows(18000, false);
    runNextRaf();
    expect(renderWindow).not.toHaveBeenCalled();

    // User slows down but keeps dragging: 50px/frame < 100px viewport.
    // Even though the rendered window [0, 10] is far behind (zero overlap),
    // readable speed must render — waiting for a full stop would leave the
    // viewport on blank padding for the rest of the gesture.
    holder.scrollTop = 18050;
    runNextRaf();
    expect(renderWindow).toHaveBeenCalledTimes(1);
  });

  it('renders immediately when the new window overlaps the rendered window', () => {
    const { r, renderWindow, holder } = makeDeferSetup();
    // Row 5 (y=150) is inside the rendered window [0, 10] — a slow drag.
    holder.scrollTop = 150;
    r.scrollRows(150, false);

    runNextRaf();
    expect(renderWindow).toHaveBeenCalledTimes(1);
    expect(rafQueue.length).toBe(0);
  });

  it('renders immediately when nothing is rendered yet', () => {
    const { r, renderWindow, holder } = makeDeferSetup();
    r.renderedRange = { top: 0, bottom: -1 };
    holder.scrollTop = 18000;
    r.scrollRows(18000, false);

    runNextRaf();
    expect(renderWindow).toHaveBeenCalledTimes(1);
  });

  it('pipes scrollHorizontal only when scrollLeft actually changes', () => {
    const { r, holder } = makeDeferSetup();
    const pipe = jest.fn();
    const internals = r as unknown as {
      table: { rowManager: { scrollHorizontal: jest.Mock; element: { scrollLeft?: number } } };
    };
    internals.table.rowManager.scrollHorizontal = pipe;

    // Tabulator's scrollHorizontal writes DOM + dispatches unconditionally,
    // so the renderer must skip the pipe when scrollLeft is unchanged.
    holder.scrollTop = 150; // overlaps rendered window → renders immediately
    r.scrollRows(150, false);
    runNextRaf();
    expect(pipe).toHaveBeenCalledTimes(1); // first frame always pipes

    // Small steps stay inside the rendered window (no fling deferral).
    holder.scrollTop = 200;
    r.scrollRows(200, false);
    runNextRaf();
    expect(pipe).toHaveBeenCalledTimes(1); // scrollLeft unchanged → skipped

    internals.table.rowManager.element.scrollLeft = 50;
    holder.scrollTop = 250;
    r.scrollRows(250, false);
    runNextRaf();
    expect(pipe).toHaveBeenCalledTimes(2); // horizontal change → piped
  });
});
