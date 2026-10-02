import { describe, expect, it, type Mock, vi } from 'vitest';
import { ScrollAnchor } from '../ScrollAnchor';

function rect(top: number, height: number) {
  return {
    top,
    bottom: top + height,
    left: 0,
    right: 0,
    width: 0,
    height,
    x: 0,
    y: top,
    toJSON: () => ({}),
  };
}

function makeRow(top: number, height = 20) {
  const internal = {};
  return {
    getElement: () => ({ getBoundingClientRect: () => rect(top, height) }),
    _getSelf: () => internal,
  };
}

/** A table whose holder, visible rows, renderer and display rows a test names. */
function setup({
  holder,
  visible = [],
  renderer,
  displayRows = [],
}: {
  holder?: object;
  visible?: unknown[];
  renderer?: Record<string, unknown>;
  displayRows?: unknown[];
} = {}) {
  const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
  const table = {
    handlers,
    on: vi.fn((evt: string, fn: (...args: unknown[]) => void) => {
      (handlers[evt] ??= []).push(fn);
    }),
    element: { querySelector: vi.fn(() => holder) },
    getRows: vi.fn((type?: string) => (type === 'visible' ? visible : [])),
    rowManager: { renderer, getDisplayRows: () => displayRows },
    scrollToRow: vi.fn(() => Promise.resolve()),
  };
  const plugin = new ScrollAnchor(table as never);
  (plugin as unknown as { table: typeof table }).table = table;
  (plugin as unknown as { options: () => boolean }).options = () => true;
  plugin.initialize();
  return { plugin, table, handlers };
}

/** The holder the padding resets read: the table element is its only child. */
function paddedHolder(scrollTop: number, style: Record<string, string>) {
  const tableEl = { style };
  const holder = {
    scrollTop,
    querySelector: vi.fn((sel: string) => (sel === '.tabulator-table' ? tableEl : null)),
  };
  return { tableEl, holder };
}

function anchorWithNoParent() {
  return { _getSelf: () => ({}), getTreeParent: () => false };
}

describe('ScrollAnchor', () => {
  it('returns the row whose cumulative visible height first crosses half of the holder height', () => {
    // holder height 100, target 50. r1 contributes 30 (running 30), r2 contributes 30
    // (running 60 — first row at/over 50), r3 never reached.
    const r1 = makeRow(0, 30);
    const r2 = makeRow(30, 30);
    const r3 = makeRow(60, 30);
    const holder = { getBoundingClientRect: () => rect(0, 100) };
    const { plugin } = setup({ visible: [r1, r2, r3] });

    const found = (
      plugin as unknown as { _findMiddleVisibleRow: (h: unknown) => unknown }
    )._findMiddleVisibleRow(holder);
    expect(found).toBe(r2);
  });

  it('skips the recenter on a single tree toggle (preserves scrollTop)', () => {
    const { table, plugin } = setup();

    table.handlers.dataTreeRowExpanded?.[0]?.();
    expect((plugin as unknown as { skipNextRender: boolean }).skipNextRender).toBe(true);

    // Pretend Tabulator runs its render cycle.
    table.handlers.renderStarted?.[0]?.();
    table.handlers.renderComplete?.[0]?.();

    // No scroll attempted; flag cleared.
    expect(table.scrollToRow).not.toHaveBeenCalled();
    expect((plugin as unknown as { skipNextRender: boolean }).skipNextRender).toBe(false);
  });

  it('captures the middle row in renderStarted and is idempotent within a render cycle', () => {
    // renderStarted is the single capture point. VariableHeightVerticalRenderer
    // preserves scrollTop across rerenderRows, so by the time renderStarted
    // fires the holder still reflects the pre-render state — capturing the
    // correct middle row. The capture must also be idempotent: a second
    // renderStarted within the same cycle must not overwrite the anchor.
    const r1 = makeRow(0, 30);
    const r2 = makeRow(30, 30);
    const r3 = makeRow(60, 30);
    const holder = { getBoundingClientRect: () => rect(0, 100) };
    const { plugin, table, handlers } = setup({ holder, visible: [r1, r2, r3] });

    handlers.renderStarted?.[0]?.();
    expect((plugin as unknown as { anchorRow: unknown }).anchorRow).toBe(r2);

    // Simulate Tabulator firing renderStarted a second time within the same
    // cycle (e.g. nested rerenders). The `!this.anchorRow` guard should make
    // this a no-op even though the visible set has changed.
    (table.getRows as Mock).mockImplementation((...args: unknown[]) => {
      if (args[0] === 'visible') {
        return [r3, r2, r1]; // reversed
      }
      return [];
    });
    handlers.renderStarted?.[0]?.();
    expect((plugin as unknown as { anchorRow: unknown }).anchorRow).toBe(r2);
  });

  // With the last display row in the rendered window the pad is stale; with rows
  // below the window it is legitimately non-zero, and must not be touched.
  it.each([
    [
      'zeros stale paddingBottom when the last display row is in the rendered window',
      3,
      2,
      80,
      '0px',
      0,
    ],
    [
      'leaves paddingBottom alone when the last display row is not yet rendered',
      10,
      4,
      120,
      '80px',
      120,
    ],
  ])('%s', (_name, rowCount, vDomBottom, pad, expectedStyle, expectedPad) => {
    const { tableEl, holder } = paddedHolder(0, { paddingBottom: '80px' });
    const renderer: Record<string, unknown> = { vDomBottom, vDomBottomPad: pad };
    const displayRows = Array.from({ length: rowCount }, () => ({}));
    const { plugin } = setup({ holder, renderer, displayRows });

    (plugin as unknown as { _resetStaleBottomPadding: () => void })._resetStaleBottomPadding();

    expect(tableEl.style.paddingBottom).toBe(expectedStyle);
    expect(renderer.vDomBottomPad).toBe(expectedPad);
  });

  it('resets paddings before the anchor restore in renderComplete (so scrollHeight is accurate for was-at-bottom)', () => {
    // wasAtBottom: scrollTop near max. Bottom-padding is stale → scrollHeight
    // is inflated. If the reset ran AFTER the restore, the boundary restore
    // would snap to the wrong (inflated) bottom. Verify the reset wins.
    const tableEl = { style: { paddingBottom: '200px', paddingTop: '0px' } };
    const holder = {
      scrollTop: 800,
      scrollHeight: 1000, // 800 + 200 stale pad
      clientHeight: 100,
      querySelector: vi.fn((sel: string) => (sel === '.tabulator-table' ? tableEl : null)),
      getBoundingClientRect: () => rect(0, 100),
    };
    const renderer: Record<string, unknown> = { vDomBottom: 0, vDomBottomPad: 200 };
    const { plugin, handlers } = setup({ holder, renderer, displayRows: [{}] });

    // Seed wasAtBottom directly; the renderComplete handler should run both
    // padding resets, then snap scrollTop to the corrected max.
    const p = plugin as unknown as { wasAtBottom: boolean };
    p.wasAtBottom = true;

    // Once the pad is zeroed the holder's scrollHeight reflects only content.
    Object.defineProperty(holder, 'scrollHeight', {
      get: () => (renderer.vDomBottomPad === 0 ? 800 : 1000),
    });

    handlers.renderComplete?.[0]?.();

    expect(tableEl.style.paddingBottom).toBe('0px');
    expect(renderer.vDomBottomPad).toBe(0);
    // scrollTop snapped to corrected max (800 - 100 = 700), not stale (1000 - 100 = 900).
    expect(holder.scrollTop).toBe(700);
  });

  // A filter can leave a top pad scrollTop never reached; a scrollTop that has
  // accounted for the pad is the legitimate state.
  it.each([
    ['zeros stale paddingTop after filter when scrollTop is less than paddingTop', 0, 120, 0],
    [
      'does NOT zero paddingTop when scrollTop has accounted for it (legitimate state)',
      500,
      500,
      500,
    ],
  ])('%s', (_name, scrollTop, pad, expectedPad) => {
    const { tableEl, holder } = paddedHolder(scrollTop, { paddingTop: `${pad}px` });
    const renderer: Record<string, unknown> = { vDomTopPad: pad };
    const { plugin } = setup({ holder, renderer });

    (plugin as unknown as { _resetStaleTopPadding: () => void })._resetStaleTopPadding();

    expect(tableEl.style.paddingTop).toBe(`${expectedPad}px`);
    expect(renderer.vDomTopPad).toBe(expectedPad);
  });

  it.each([
    ['wasAtTop when the user is at the scroll top', 0, true, false],
    ['wasAtBottom when the user is at the scroll bottom', 900, false, true],
  ])('captures %s', (_name, scrollTop, atTop, atBottom) => {
    const holder = {
      scrollTop,
      scrollHeight: 1000,
      clientHeight: 100,
      getBoundingClientRect: () => rect(0, 100),
    };
    const { plugin, handlers } = setup({ holder, visible: [makeRow(0, 20), makeRow(20, 20)] });

    handlers.renderStarted?.[0]?.();

    const p = plugin as unknown as { wasAtTop: boolean; wasAtBottom: boolean };
    expect(p.wasAtTop).toBe(atTop);
    expect(p.wasAtBottom).toBe(atBottom);
  });

  it.each([
    ['wasAtTop, snaps scrollTop to 0', 'wasAtTop', 0],
    ['wasAtBottom, snaps scrollTop to max', 'wasAtBottom', 900],
  ] as const)('on renderComplete with %s instead of centering', (_name, flag, expected) => {
    const holder = {
      scrollTop: 200,
      scrollHeight: 1000,
      clientHeight: 100,
      querySelector: () => null,
    };
    const { plugin, table, handlers } = setup({ holder });

    (plugin as unknown as Record<typeof flag, boolean>)[flag] = true;
    handlers.renderComplete?.[0]?.();

    expect(holder.scrollTop).toBe(expected);
    expect(table.scrollToRow).not.toHaveBeenCalled();
  });

  it('a second toggle in the same burst clears the skip flag (bulk recenter runs)', () => {
    const { table, plugin } = setup();

    // Synchronous burst — expand-all.
    table.handlers.dataTreeRowExpanded?.[0]?.();
    table.handlers.dataTreeRowExpanded?.[0]?.();
    table.handlers.dataTreeRowExpanded?.[0]?.();

    expect((plugin as unknown as { skipNextRender: boolean }).skipNextRender).toBe(false);
    expect((plugin as unknown as { toggleSeenInBurst: boolean }).toggleSeenInBurst).toBe(true);
  });

  it('captures the anchor offset within the holder for pixel-accurate restore', () => {
    // Anchor row offsetTop=130, holder.scrollTop=100 → captured offset = 30 (the
    // row's Y position inside the visible holder viewport).
    const r1 = {
      getElement: () => ({ offsetTop: 100, getBoundingClientRect: () => rect(50, 20) }),
      _getSelf: () => ({}),
    };
    const r2 = {
      getElement: () => ({ offsetTop: 130, getBoundingClientRect: () => rect(80, 40) }),
      _getSelf: () => ({}),
    };
    const holder = {
      scrollTop: 100,
      scrollHeight: 1000,
      clientHeight: 100,
      getBoundingClientRect: () => rect(50, 100),
    };
    const { plugin, handlers } = setup({ holder, visible: [r1, r2] });

    handlers.renderStarted?.[0]?.();

    expect((plugin as unknown as { anchorRow: unknown }).anchorRow).toBe(r2);
    expect(
      (plugin as unknown as { anchorOffsetFromHolderTop: number }).anchorOffsetFromHolderTop,
    ).toBe(30);
  });

  it('restores scrollTop synchronously in renderComplete (no awaits, no scrollToRow)', () => {
    // Pre-render: middle row sat at offset 30 from holder top. Post-render: same row
    // is at offsetTop 500 inside .tabulator-table → expected scrollTop = 500 - 30 = 470.
    // Crucially the assertion runs immediately after the renderComplete call — no await,
    // no rAF, no setTimeout. If the write were async this would still be the old value.
    const internalRow = { __internal: true };
    const r2 = {
      getElement: () => ({ offsetTop: 500 }),
      getData: () => ({ originalData: { timestamp: 0 } }),
      _getSelf: () => internalRow,
    };
    const holder = {
      scrollTop: 100,
      scrollHeight: 5000,
      clientHeight: 100,
      getBoundingClientRect: () => rect(0, 100),
      querySelector: () => null,
    };
    const renderer = {
      rows: vi.fn(() => [internalRow]),
      _virtualRenderFill: vi.fn(),
    };
    const { plugin, table, handlers } = setup({ holder, renderer, displayRows: [internalRow] });

    // Manually seed the captured anchor (skip dataSorting/renderStarted to keep test focused).
    const p = plugin as unknown as {
      anchorRow: typeof r2;
      anchorOffsetFromHolderTop: number;
    };
    p.anchorRow = r2;
    p.anchorOffsetFromHolderTop = 30;

    handlers.renderComplete?.[0]?.();

    expect(renderer._virtualRenderFill).toHaveBeenCalledWith(0, true);
    expect(holder.scrollTop).toBe(470);
    expect(table.scrollToRow).not.toHaveBeenCalled();
  });

  it('fallback: collapse case walks up getTreeParent to the nearest displayed ancestor', () => {
    // Anchor row was a child collapsed under a parent. Parent is displayed.
    const parentInternal = {};
    const parentComponent = {
      _getSelf: () => parentInternal,
      getTreeParent: () => false,
    };
    const childComponent = {
      _getSelf: () => ({}),
      getTreeParent: () => parentComponent,
    };
    const { plugin } = setup({ displayRows: [parentInternal] });

    const p = plugin as unknown as { anchorRow: unknown };
    p.anchorRow = childComponent;

    const resolved = (
      plugin as unknown as { _resolveAnchorRow: () => unknown }
    )._resolveAnchorRow();
    expect(resolved).toBe(parentComponent);
  });

  // An index past the end (a filter removed most rows) is clamped to the last row.
  it.each([
    ['picks the row at the captured display-rows index (clamped)', 10, 50, 9],
    ['with exact index returns the row at that index', 100, 30, 30],
  ])('fallback: filter case %s', (_name, rowCount, capturedIndex, expectedIndex) => {
    const displayRows = Array.from({ length: rowCount }, (_, i) => ({ id: i }));
    const expectedComponent = { mark: `at-${expectedIndex}` };
    (displayRows[expectedIndex] as unknown as { getComponent: () => unknown }).getComponent = () =>
      expectedComponent;
    const { plugin } = setup({ displayRows });

    const p = plugin as unknown as { anchorRow: unknown; anchorDisplayIndex: number };
    p.anchorRow = anchorWithNoParent();
    p.anchorDisplayIndex = capturedIndex;

    const resolved = (
      plugin as unknown as { _resolveAnchorRow: () => unknown }
    )._resolveAnchorRow();
    expect(resolved).toBe(expectedComponent);
  });

  it('fallback: returns null when no parent is displayed and display rows are empty', () => {
    const { plugin } = setup();

    const p = plugin as unknown as { anchorRow: unknown; anchorDisplayIndex: number };
    p.anchorRow = anchorWithNoParent();
    p.anchorDisplayIndex = 5;

    const resolved = (
      plugin as unknown as { _resolveAnchorRow: () => unknown }
    )._resolveAnchorRow();
    expect(resolved).toBeNull();
  });
});
