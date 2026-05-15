import { describe, expect, it } from '@jest/globals';

import { VariableHeightVerticalRenderer } from '../VariableHeightVerticalRenderer';

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
  _setHeight: (i: number, h: number) => void;
  _heightOf: (i: number) => number;
  _cumHeight: (i: number) => number;
  _totalHeight: () => number;
  _findRowAt: (y: number) => number;
  _flushEstimateUpdate: () => void;
  _resyncToRowsCount: (wipe: boolean) => void;
  _resolveOverscanRows: (clientHeight: number) => number;
  // Access to the underlying mock table so tests can mutate options.
  table: { options: Record<string, unknown> };
}

function makeRenderer(rowsCount: number): RendererInternals {
  const Ctor = VariableHeightVerticalRenderer as unknown as new (table: unknown) => unknown;
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

describe('VariableHeightVerticalRenderer height bookkeeping', () => {
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

function makeRowStub(offsetTop: number, attached = true): RowStub {
  // `attached` controls Pass 2 (DOM-truth snap) reachability. setAnchor
  // tests want it true so Pass 2 runs and we exercise both passes.
  // rerenderRows anchor tests want it false: their row stubs can't
  // simulate the layout engine updating offsetTop after a re-render, so
  // letting Pass 2 read the stale stub offsetTop would corrupt Pass 1's
  // already-correct scrollTop.
  const el = {
    offsetTop,
    parentNode: attached ? { nodeType: 1 } : null,
    style: {},
  };
  return {
    initialized: false,
    heightInitialized: false,
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
  const Ctor = VariableHeightVerticalRenderer as unknown as new (table: unknown) => unknown;
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

describe('VariableHeightVerticalRenderer.setAnchor', () => {
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

// ─────────────────────────────────────────────────────────────────────────
// rerenderRows: scrollTop preservation
//
// Iteration 3 matches stock VirtualDomVertical's "scroll just stays" default
// (tabulator_esm.mjs:25247). The renderer does NOT write scrollTop during
// rerenderRows. Sort/filter/expand/collapse all preserve scrollTop by
// letting the browser keep it. Opt-in middle-row anchoring is provided by
// the ScrollAnchor module via setAnchor() — tested separately above.
//
// This test asserts the contract: scrollTop is unchanged after rerenderRows.
// ─────────────────────────────────────────────────────────────────────────

interface RerenderRenderer extends RendererForSetAnchor {
  vDomTop: number;
  vDomBottom: number;
  rerenderRows: (cb?: () => void) => void;
}

function makeRerenderRenderer(initialRows: RowStub[]): {
  r: RerenderRenderer;
  setDisplayRows: (next: RowStub[]) => void;
} {
  const tableElement = { style: { paddingTop: '0', paddingBottom: '0' }, firstChild: null };
  const elementVertical = {
    scrollTop: 0,
    clientHeight: 100,
    scrollHeight: 10000,
    clientWidth: 200,
  };
  let current: RowStub[] = initialRows;
  const table = {
    rowManager: {
      element: elementVertical,
      tableElement,
      getDisplayRows: () => current,
      scrollHorizontal: () => {},
    },
    columnManager: { element: {} },
    options: {},
    eventBus: { _events: {}, dispatch: () => {} },
  };
  const Ctor = VariableHeightVerticalRenderer as unknown as new (table: unknown) => unknown;
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
  };
}

describe('VariableHeightVerticalRenderer.rerenderRows scroll preservation', () => {
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
    // ScrollAnchor's job (opt-in), not the renderer's.
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
});
