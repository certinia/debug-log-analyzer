import { describe, expect, it, jest } from '@jest/globals';

import { VirtualVerticalRenderer } from '../VirtualVerticalRenderer';

/**
 * Minimal Tabulator surface needed by the Renderer base class constructor
 * (tabulator_esm.mjs:23489). We don't exercise scroll/render here; we drive
 * the renderer's private height bookkeeping via cast access.
 */
function makeMockTable(): unknown {
  return {
    rowManager: {
      element: { scrollTop: 0, clientHeight: 0 },
      tableElement: { style: {}, firstChild: null },
      getDisplayRows: () => [],
      scrollHorizontal: () => {},
    },
    columnManager: { element: {} },
    options: {},
    eventBus: { _events: {}, dispatch: () => {} },
  };
}

interface FenwickLike {
  resize: (n: number) => void;
  resetZero: () => void;
  bulkInitConstant: (v: number) => void;
}

interface RendererInternals {
  measuredHeight: Float64Array;
  isMeasured: Uint8Array;
  fenwickMeasured: FenwickLike;
  fenwickUnmeasuredCount: FenwickLike;
  estimateHeight: number;
  measuredSum: number;
  measuredCount: number;
  rowsCountCached: number;
  _setHeight: (i: number, h: number, dataKey?: object) => void;
  _heightOf: (i: number) => number;
  _cumHeight: (i: number) => number;
  _totalHeight: () => number;
  _findRowAt: (y: number) => number;
  _flushEstimateUpdate: () => void;
  _resyncToRowsCount: (wipe: boolean) => void;
  _rebuildIndexFromCache: (rows: Array<{ data?: object }>) => void;
  _resolveOverscanRows: (clientHeight: number) => number;
  // Access to the underlying mock table so tests can mutate options.
  table: { options: Record<string, unknown> };
}

function makeRenderer(rowsCount: number): RendererInternals {
  const Ctor = VirtualVerticalRenderer as unknown as new (table: unknown) => unknown;
  const r = new Ctor(makeMockTable()) as RendererInternals;
  // Manually initialize per-row state for the requested row count. The
  // renderer's real init pathway is driven by RowManager via tableBuilt /
  // _resyncToRowsCount; we bypass it because our mock has zero display
  // rows.
  r.measuredHeight = new Float64Array(rowsCount);
  r.isMeasured = new Uint8Array(rowsCount);
  r.fenwickMeasured.resize(rowsCount);
  r.fenwickUnmeasuredCount.resize(rowsCount);
  r.fenwickUnmeasuredCount.bulkInitConstant(1);
  r.measuredSum = 0;
  r.measuredCount = 0;
  r.rowsCountCached = rowsCount;
  return r;
}

describe('VirtualVerticalRenderer height bookkeeping', () => {
  it('uses estimateHeight for unmeasured rows', () => {
    const r = makeRenderer(10);
    expect(r._heightOf(0)).toBe(r.estimateHeight);
    expect(r._cumHeight(5)).toBe(5 * r.estimateHeight);
    expect(r._totalHeight()).toBe(10 * r.estimateHeight);
  });

  it('setHeight does NOT mutate estimateHeight until _flushEstimateUpdate', () => {
    const r = makeRenderer(4);
    const baseEstimate = r.estimateHeight;
    r._setHeight(0, 50);
    expect(r.estimateHeight).toBe(baseEstimate); // locked during render
    r._setHeight(1, 100);
    expect(r.estimateHeight).toBe(baseEstimate); // still locked
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

  it('running stats track measurements even before estimate flush', () => {
    const r = makeRenderer(3);
    r._setHeight(0, 40);
    r._setHeight(1, 60);
    expect(r.measuredSum).toBe(100);
    expect(r.measuredCount).toBe(2);
  });

  it('cumHeight reflects mix of measured + estimated after flush', () => {
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

  it('totalHeight matches sum of heightOf across all rows', () => {
    const r = makeRenderer(8);
    const measurements: Array<[number, number]> = [
      [0, 20],
      [2, 50],
      [3, 35],
      [5, 80],
      [7, 25],
    ];
    for (const [i, h] of measurements) {
      r._setHeight(i, h);
    }
    r._flushEstimateUpdate();
    let expected = 0;
    for (let i = 0; i < 8; i++) {
      expected += r._heightOf(i);
    }
    expect(r._totalHeight()).toBeCloseTo(expected, 9);
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

  it('overscan: explicit option wins over adaptive', () => {
    const r = makeRenderer(50);
    r.table.options['variableHeightOverscanRows'] = 12;
    expect(r._resolveOverscanRows(600)).toBe(12);
    r.table.options['variableHeightOverscanRows'] = 0;
    expect(r._resolveOverscanRows(600)).toBe(0); // explicit 0 honoured
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

  it('overscan: legacy renderVerticalBuffer option is converted to row count', () => {
    const r = makeRenderer(50);
    // 300px / 30px estimate = 10 rows, within clamp.
    r.table.options['renderVerticalBuffer'] = 300;
    expect(r._resolveOverscanRows(600)).toBe(10);
    // Huge legacy buffer clamped to max.
    r.table.options['renderVerticalBuffer'] = 5000;
    expect(r._resolveOverscanRows(600)).toBe(16);
  });
});

interface RowStub {
  initialized: boolean;
  heightInitialized: boolean;
  initialize: () => void;
  normalizeHeight: () => void;
  calcHeight: () => void;
  setCellHeight: () => void;
  clearCellHeight: () => void;
  rendered: () => void;
  getElement: () => { offsetTop: number; parentNode: object | null; style: object };
  getHeight: () => number;
  deinitializeHeight?: () => void;
}

interface RendererForSetAnchor {
  setAnchor: (row: RowStub, offset: number) => void;
  scrollToRowPosition: (
    row: RowStub,
    position: string | undefined,
    ifVisible: boolean | undefined,
  ) => Promise<void>;
  scrollToRowNearestTop: (row: RowStub) => boolean;
  _cumHeight: (i: number) => number;
  _totalHeight: () => number;
  _setHeight: (i: number, h: number) => void;
  _flushEstimateUpdate: () => void;
  measuredHeight: Float64Array;
  isMeasured: Uint8Array;
  fenwickMeasured: FenwickLike;
  fenwickUnmeasuredCount: FenwickLike;
  measuredSum: number;
  measuredCount: number;
  rowsCountCached: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tableElement: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  elementVertical: any;
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
    normalizeHeight: () => {},
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
function stubRenderWindow(r: RendererForSetAnchor): void {
  (r as unknown as { _renderWindow: () => void })._renderWindow = () => {};
}

function makeRendererWithRows(rows: RowStub[]): RendererForSetAnchor {
  const tableElement = { style: { paddingTop: '0', paddingBottom: '0' }, firstChild: null };
  const elementVertical = {
    scrollTop: 0,
    clientHeight: 100,
    scrollHeight: 10000,
    clientWidth: 200,
  };
  const table = {
    rowManager: {
      element: elementVertical,
      tableElement,
      getDisplayRows: () => rows,
      scrollHorizontal: () => {},
    },
    columnManager: { element: {} },
    options: {},
    eventBus: { _events: {}, dispatch: () => {} },
  };
  const Ctor = VirtualVerticalRenderer as unknown as new (table: unknown) => unknown;
  const r = new Ctor(table) as RendererForSetAnchor;
  const n = rows.length;
  r.measuredHeight = new Float64Array(n);
  r.isMeasured = new Uint8Array(n);
  r.fenwickMeasured.resize(n);
  r.fenwickUnmeasuredCount.resize(n);
  r.fenwickUnmeasuredCount.bulkInitConstant(1);
  r.measuredSum = 0;
  r.measuredCount = 0;
  r.rowsCountCached = n;
  return r;
}

describe('VirtualVerticalRenderer.setAnchor', () => {
  it('places a row at the requested offset using DOM-truth offsetTop', () => {
    // 5 rows, all 50px tall; index 3's document Y = 150. To place it at
    // offsetFromHolderTop = 20, scrollTop should be 150 - 20 = 130.
    const rows = [
      makeRowStub(0),
      makeRowStub(50),
      makeRowStub(100),
      makeRowStub(150),
      makeRowStub(200),
    ];
    const r = makeRendererWithRows(rows);
    for (let i = 0; i < rows.length; i++) {
      r._setHeight(i, 50);
    }
    r._flushEstimateUpdate();
    r.elementVertical.scrollHeight = r._totalHeight();
    stubRenderWindow(r);

    r.setAnchor(rows[3] as unknown as RowStub, 20);

    expect(r.elementVertical.scrollTop).toBe(130);
  });

  it('clamps the requested anchor scrollTop into [0, maxScroll]', () => {
    // Anchor at index 0 with offset 100 would compute scrollTop = -100.
    const rows = [makeRowStub(0), makeRowStub(40), makeRowStub(80)];
    const r = makeRendererWithRows(rows);
    for (let i = 0; i < rows.length; i++) {
      r._setHeight(i, 40);
    }
    r._flushEstimateUpdate();
    r.elementVertical.scrollHeight = r._totalHeight();
    stubRenderWindow(r);

    r.setAnchor(rows[0] as unknown as RowStub, 100);

    expect(r.elementVertical.scrollTop).toBe(0);
  });

  it('reconciles: retries placement until the anchor enters the window, then DOM-corrects', () => {
    // Stage 2d reconcile loop. Simulate the chicken-and-egg: the anchor row's
    // element is detached (outside the window) on the first render, and only
    // enters the window on the second render (its measurements grew the
    // document). The loop must retry, then DOM-truth snap once it's in.
    const rows = [makeRowStub(0), makeRowStub(50), makeRowStub(100)];
    const r = makeRendererWithRows(rows);
    for (let i = 0; i < rows.length; i++) {
      r._setHeight(i, 50);
    }
    r._flushEstimateUpdate();
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

    r.setAnchor(anchor as unknown as RowStub, 10);

    expect(renderCount).toBeGreaterThanOrEqual(2); // it retried, didn't give up
    // Converged to DOM-truth: offsetTop(100) − offset(10) = 90.
    expect(r.elementVertical.scrollTop).toBe(90);
  });

  it('is a no-op when the row is not in displayRows', () => {
    const rows = [makeRowStub(0), makeRowStub(40)];
    const r = makeRendererWithRows(rows);
    r._setHeight(0, 40);
    r._setHeight(1, 40);
    r._flushEstimateUpdate();
    r.elementVertical.scrollTop = 25;
    stubRenderWindow(r);

    const stranger = makeRowStub(999);
    r.setAnchor(stranger, 0);

    expect(r.elementVertical.scrollTop).toBe(25);
  });
});

describe('VirtualVerticalRenderer.scrollToIndex', () => {
  // 5 rows × 50px, clientHeight 100. cumHeight: 0, 50, 100, 150, 200.
  // scrollHeight set tall enough that the DOM-truth snap is not clamped.
  function makeAlignRenderer() {
    const rows = [
      makeRowStub(0),
      makeRowStub(50),
      makeRowStub(100),
      makeRowStub(150),
      makeRowStub(200),
    ];
    const r = makeRendererWithRows(rows);
    for (let i = 0; i < rows.length; i++) {
      r._setHeight(i, 50);
    }
    r._flushEstimateUpdate();
    r.elementVertical.scrollHeight = 1000;
    stubRenderWindow(r);
    return r;
  }

  it("'start': row top lands at the holder top", () => {
    const r = makeAlignRenderer();
    (r as unknown as { scrollToIndex: (i: number, a?: unknown) => void }).scrollToIndex(3, 'start');
    expect(r.elementVertical.scrollTop).toBe(150); // offsetTop(150) − 0
  });

  it("'center': row is centered in the viewport", () => {
    const r = makeAlignRenderer();
    (r as unknown as { scrollToIndex: (i: number, a?: unknown) => void }).scrollToIndex(
      3,
      'center',
    );
    expect(r.elementVertical.scrollTop).toBe(125); // 150 − (100−50)/2
  });

  it("'end': row bottom lands at the holder bottom", () => {
    const r = makeAlignRenderer();
    (r as unknown as { scrollToIndex: (i: number, a?: unknown) => void }).scrollToIndex(3, 'end');
    expect(r.elementVertical.scrollTop).toBe(100); // 150 − (100−50)
  });

  it('numeric align: exact pixel offset from the holder top', () => {
    const r = makeAlignRenderer();
    (r as unknown as { scrollToIndex: (i: number, a?: unknown) => void }).scrollToIndex(3, 20);
    expect(r.elementVertical.scrollTop).toBe(130); // 150 − 20
  });

  it('is a no-op for an out-of-range index', () => {
    const r = makeAlignRenderer();
    r.elementVertical.scrollTop = 25;
    (r as unknown as { scrollToIndex: (i: number, a?: unknown) => void }).scrollToIndex(99);
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

interface RerenderRenderer extends RendererForSetAnchor {
  vDomTop: number;
  vDomBottom: number;
  rerenderRows: (cb?: () => void) => void;
}

function makeRerenderRenderer(initialRows: RowStub[]): {
  r: RerenderRenderer;
  setDisplayRows: (next: RowStub[]) => void;
  tableEmpty: jest.Mock;
} {
  const tableElement = { style: { paddingTop: '0', paddingBottom: '0' }, firstChild: null };
  const elementVertical = {
    scrollTop: 0,
    clientHeight: 100,
    scrollHeight: 10000,
    clientWidth: 200,
  };
  let current: RowStub[] = initialRows;
  const tableEmpty = jest.fn();
  const table = {
    rowManager: {
      element: elementVertical,
      tableElement,
      getDisplayRows: () => current,
      scrollHorizontal: () => {},
      tableEmpty,
    },
    columnManager: { element: {} },
    options: {},
    eventBus: { _events: {}, dispatch: () => {} },
  };
  const Ctor = VirtualVerticalRenderer as unknown as new (table: unknown) => unknown;
  const r = new Ctor(table) as RerenderRenderer;
  const n = initialRows.length;
  r.measuredHeight = new Float64Array(n);
  r.isMeasured = new Uint8Array(n);
  r.fenwickMeasured.resize(n);
  r.fenwickUnmeasuredCount.resize(n);
  r.fenwickUnmeasuredCount.bulkInitConstant(1);
  r.measuredSum = 0;
  r.measuredCount = 0;
  r.rowsCountCached = n;
  return {
    r,
    setDisplayRows: (next) => {
      current = next;
    },
    tableEmpty,
  };
}

describe('VirtualVerticalRenderer.rerenderRows scroll preservation', () => {
  it('does not write scrollTop across a sort (reorder)', () => {
    const oldRows: RowStub[] = Array.from({ length: 10 }, (_, i) => makeRowStub(i * 40, false));
    const { r, setDisplayRows } = makeRerenderRenderer(oldRows);
    for (let i = 0; i < 10; i++) {
      r._setHeight(i, 40);
    }
    r._flushEstimateUpdate();
    r.elementVertical.scrollTop = 170;
    r.elementVertical.scrollHeight = r._totalHeight();
    stubRenderWindow(r);

    // Simulate the pipeline reversing the order.
    setDisplayRows([...oldRows].reverse());

    r.rerenderRows();

    // Stock-matching behavior: scrollTop preserved. Middle-row anchoring is
    // the AnchoringPolicy module's job (opt-in), not the renderer's.
    expect(r.elementVertical.scrollTop).toBe(170);
  });

  it('does not write scrollTop across a filter (some rows removed)', () => {
    const oldRows: RowStub[] = Array.from({ length: 10 }, (_, i) => makeRowStub(i * 40, false));
    const { r, setDisplayRows } = makeRerenderRenderer(oldRows);
    for (let i = 0; i < 10; i++) {
      r._setHeight(i, 40);
    }
    r._flushEstimateUpdate();
    r.elementVertical.scrollTop = 250;
    r.elementVertical.scrollHeight = r._totalHeight();
    stubRenderWindow(r);

    // Filter out r6.
    setDisplayRows([...oldRows.slice(0, 6), ...oldRows.slice(7)]);

    r.rerenderRows();

    expect(r.elementVertical.scrollTop).toBe(250);
  });

  it('does not write scrollTop even when all rendered rows are filtered out', () => {
    // Regression test for the iteration-1/2 bug: the no-survivor branch in
    // rerenderRows used to write scrollTop = 0 explicitly. Iteration 3
    // deletes that branch — scrollTop must stay where it was, and the
    // browser will clamp downward if the new total scrollHeight is smaller.
    const oldRows: RowStub[] = Array.from({ length: 10 }, (_, i) => makeRowStub(i * 40, false));
    const { r, setDisplayRows } = makeRerenderRenderer(oldRows);
    for (let i = 0; i < 10; i++) {
      r._setHeight(i, 40);
    }
    r._flushEstimateUpdate();
    r.elementVertical.scrollTop = 200;
    r.elementVertical.scrollHeight = r._totalHeight();
    stubRenderWindow(r);

    // Filter removes ALL rendered rows.
    setDisplayRows([...oldRows.slice(0, 4), ...oldRows.slice(8)]);

    r.rerenderRows();

    expect(r.elementVertical.scrollTop).toBe(200);
  });

  it('calls rowManager.tableEmpty() when the new display is empty', () => {
    // Stock VirtualDomVertical.rerenderRows ends with
    // `this.table.rowManager.tableEmpty();` — this triggers RowManager's
    // placeholder display logic. Mirror that so filter/sort-to-empty shows
    // the `.tabulator-placeholder` element.
    const oldRows: RowStub[] = Array.from({ length: 3 }, (_, i) => makeRowStub(i * 40, false));
    const { r, setDisplayRows, tableEmpty } = makeRerenderRenderer(oldRows);
    for (let i = 0; i < 3; i++) {
      r._setHeight(i, 40);
    }
    r._flushEstimateUpdate();
    stubRenderWindow(r);

    // Filter to zero rows.
    setDisplayRows([]);

    r.rerenderRows();

    expect(tableEmpty).toHaveBeenCalledTimes(1);
  });

  it('does NOT call tableEmpty() when the new display is non-empty', () => {
    const oldRows: RowStub[] = Array.from({ length: 3 }, (_, i) => makeRowStub(i * 40, false));
    const { r, tableEmpty } = makeRerenderRenderer(oldRows);
    for (let i = 0; i < 3; i++) {
      r._setHeight(i, 40);
    }
    r._flushEstimateUpdate();
    stubRenderWindow(r);

    r.rerenderRows();

    expect(tableEmpty).not.toHaveBeenCalled();
  });
});

describe('VirtualVerticalRenderer.scrollToRowPosition', () => {
  // 5 rows at 50px each, clientHeight = 100.
  // cumHeight: row0=0, row1=50, row2=100, row3=150, row4=200. Total = 250.
  function makePositionRenderer(scrollTop = 0) {
    const rows = [
      makeRowStub(0),
      makeRowStub(50),
      makeRowStub(100),
      makeRowStub(150),
      makeRowStub(200),
    ];
    const r = makeRendererWithRows(rows);
    for (let i = 0; i < rows.length; i++) r._setHeight(i, 50);
    r._flushEstimateUpdate();
    r.elementVertical.scrollTop = scrollTop;
    r.elementVertical.scrollHeight = r._totalHeight();
    stubRenderWindow(r);
    return { r, rows };
  }

  it("'top': places the row at the top of the viewport", () => {
    const { r, rows } = makePositionRenderer();
    return r.scrollToRowPosition(rows[2]!, 'top', true).then(() => {
      expect(r.elementVertical.scrollTop).toBe(100);
    });
  });

  it("'center': places the row centered in the viewport", () => {
    // offsetFromHolderTop = (100 - 50) / 2 = 25. scrollTop = 100 - 25 = 75.
    const { r, rows } = makePositionRenderer();
    return r.scrollToRowPosition(rows[2]!, 'center', true).then(() => {
      expect(r.elementVertical.scrollTop).toBe(75);
    });
  });

  it("'bottom': places the row flush with the viewport bottom", () => {
    // offsetFromHolderTop = 100 - 50 = 50. scrollTop = 100 - 50 = 50.
    const { r, rows } = makePositionRenderer();
    return r.scrollToRowPosition(rows[2]!, 'bottom', true).then(() => {
      expect(r.elementVertical.scrollTop).toBe(50);
    });
  });

  it('ifVisible=false: skips scroll when row is already fully in view', () => {
    // Row2 is at [100, 150]. Viewport [100, 200] → fully visible.
    const { r, rows } = makePositionRenderer(100);
    return r.scrollToRowPosition(rows[2]!, 'top', false).then(() => {
      expect(r.elementVertical.scrollTop).toBe(100);
    });
  });

  it('ifVisible=false: scrolls when row is outside the viewport', () => {
    // Row2 is at [100, 150]. Viewport [0, 100] → not visible.
    const { r, rows } = makePositionRenderer(0);
    return r.scrollToRowPosition(rows[2]!, 'top', false).then(() => {
      expect(r.elementVertical.scrollTop).toBe(100);
    });
  });

  it('rejects when the row is not in displayRows', () => {
    const { r } = makePositionRenderer();
    const stranger = makeRowStub(999);
    return expect(r.scrollToRowPosition(stranger, 'top', true)).rejects.toBe(
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
    const rowManager: {
      element: { scrollTop: number; clientHeight: number; clientWidth: number };
      tableElement: { style: object; firstChild: null };
      getDisplayRows: () => unknown[];
      scrollHorizontal: () => void;
      renderMode: unknown;
    } = {
      element: { scrollTop: 0, clientHeight: 0, clientWidth: 200 },
      tableElement: { style: {}, firstChild: null },
      getDisplayRows: () => [],
      scrollHorizontal: () => {},
      // Simulate the bad state stock leaves us in: renderMode set to the
      // class reference instead of a string.
      renderMode: VirtualVerticalRenderer,
    };
    const table = {
      rowManager,
      columnManager: { element: {} },
      options: {},
      eventBus: { _events: {}, dispatch: () => {} },
    };
    const Ctor = VirtualVerticalRenderer as unknown as new (table: unknown) => {
      initialize: () => void;
    };
    const r = new Ctor(table);
    r.initialize();

    expect(rowManager.renderMode).toBe('virtual');
  });
});
