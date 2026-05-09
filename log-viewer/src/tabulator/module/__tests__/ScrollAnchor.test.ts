import { describe, expect, it, jest } from '@jest/globals';
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
  return {
    getElement: () => ({ getBoundingClientRect: () => rect(top, height) }),
  };
}

function makeBareTable() {
  const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
  return {
    handlers,
    on: jest.fn((evt: string, fn: (...args: unknown[]) => void) => {
      (handlers[evt] ??= []).push(fn);
    }),
    element: { querySelector: jest.fn() },
    getRows: jest.fn(() => []),
    rowManager: { getDisplayRows: () => [] },
    scrollToRow: jest.fn(() => Promise.resolve()),
  };
}

function setup() {
  const table = makeBareTable();
  const plugin = new ScrollAnchor(table as never);
  (plugin as unknown as { table: typeof table }).table = table;
  (plugin as unknown as { options: () => boolean }).options = () => true;
  plugin.initialize();
  return { plugin, table };
}

describe('ScrollAnchor', () => {
  it('returns the row whose cumulative visible height first crosses half of the holder height', () => {
    // holder height 100, target 50. r1 contributes 30 (running 30), r2 contributes 30
    // (running 60 — first row at/over 50), r3 never reached.
    const r1 = makeRow(0, 30);
    const r2 = makeRow(30, 30);
    const r3 = makeRow(60, 30);
    const holder = { getBoundingClientRect: () => rect(0, 100) };

    const table = {
      on: jest.fn(),
      element: { querySelector: jest.fn() },
      getRows: jest.fn((type?: string) => {
        if (type === 'visible') return [r1, r2, r3];
        return [];
      }),
    };

    const plugin = new ScrollAnchor(table as never);
    (plugin as unknown as { table: typeof table }).table = table;

    const found = (
      plugin as unknown as { _findMiddleVisibleRow: (h: unknown) => unknown }
    )._findMiddleVisibleRow(holder);
    expect(found).toBe(r2);
    // r3 should never be reached.
    void r3;
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

  it('captures the middle row in dataSorting (before Tabulator resets scrollTop)', () => {
    // Build a table with a holder + visible rows so dataSorting can run
    // _findMiddleVisibleRow successfully.
    const r1 = makeRow(0, 30);
    const r2 = makeRow(30, 30);
    const r3 = makeRow(60, 30);
    const holder = { getBoundingClientRect: () => rect(0, 100) };
    const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
    const table = {
      handlers,
      on: jest.fn((evt: string, fn: (...args: unknown[]) => void) => {
        (handlers[evt] ??= []).push(fn);
      }),
      element: { querySelector: jest.fn(() => holder) },
      getRows: jest.fn((type?: string) => {
        if (type === 'visible') return [r1, r2, r3];
        return [];
      }),
      rowManager: { getDisplayRows: () => [] },
      scrollToRow: jest.fn(() => Promise.resolve()),
    };

    const plugin = new ScrollAnchor(table as never);
    (plugin as unknown as { table: typeof table }).table = table;
    (plugin as unknown as { options: () => boolean }).options = () => true;
    plugin.initialize();

    // Sort starts — pre-sort middle row should be captured now (= r2).
    handlers.dataSorting?.[0]?.();
    expect((plugin as unknown as { anchorRow: unknown }).anchorRow).toBe(r2);

    // Tabulator now rebuilds DOM with sorted rows in a different order. If our
    // dataSorting capture didn't happen, renderStarted would capture the wrong
    // row. Simulate that by changing the visible set and firing renderStarted —
    // the guard `!this.anchorRow` should make this a no-op.
    (table.getRows as jest.Mock).mockImplementation((...args: unknown[]) => {
      if (args[0] === 'visible') return [r3, r2, r1]; // reversed
      return [];
    });
    handlers.renderStarted?.[0]?.();
    expect((plugin as unknown as { anchorRow: unknown }).anchorRow).toBe(r2);
  });

  it('zeros stale paddingTop after filter when scrollTop is less than paddingTop', () => {
    const tableEl = { style: { paddingTop: '120px' } };
    const holder = {
      scrollTop: 0,
      querySelector: jest.fn((sel: string) => (sel === '.tabulator-table' ? tableEl : null)),
    };
    const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
    const renderer: Record<string, unknown> = { vDomTopPad: 120 };
    const table = {
      handlers,
      on: jest.fn((evt: string, fn: (...args: unknown[]) => void) => {
        (handlers[evt] ??= []).push(fn);
      }),
      element: { querySelector: jest.fn(() => holder) },
      getRows: jest.fn(() => []),
      rowManager: { renderer, getDisplayRows: () => [] },
      scrollToRow: jest.fn(() => Promise.resolve()),
    };

    const plugin = new ScrollAnchor(table as never);
    (plugin as unknown as { table: typeof table }).table = table;
    (plugin as unknown as { options: () => boolean }).options = () => true;
    plugin.initialize();

    (plugin as unknown as { _resetStaleTopPadding: () => void })._resetStaleTopPadding();

    expect(tableEl.style.paddingTop).toBe('0px');
    expect(renderer.vDomTopPad).toBe(0);
  });

  it('captures wasAtTop when the user is at the scroll top', () => {
    const r1 = makeRow(0, 20);
    const r2 = makeRow(20, 20);
    const holder = {
      scrollTop: 0,
      scrollHeight: 1000,
      clientHeight: 100,
      getBoundingClientRect: () => rect(0, 100),
    };
    const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
    const table = {
      handlers,
      on: jest.fn((evt: string, fn: (...args: unknown[]) => void) => {
        (handlers[evt] ??= []).push(fn);
      }),
      element: { querySelector: jest.fn(() => holder) },
      getRows: jest.fn((type?: string) => (type === 'visible' ? [r1, r2] : [])),
      rowManager: { getDisplayRows: () => [] },
      scrollToRow: jest.fn(() => Promise.resolve()),
    };
    const plugin = new ScrollAnchor(table as never);
    (plugin as unknown as { table: typeof table }).table = table;
    (plugin as unknown as { options: () => boolean }).options = () => true;
    plugin.initialize();

    handlers.renderStarted?.[0]?.();

    expect((plugin as unknown as { wasAtTop: boolean }).wasAtTop).toBe(true);
    expect((plugin as unknown as { wasAtBottom: boolean }).wasAtBottom).toBe(false);
  });

  it('captures wasAtBottom when the user is at the scroll bottom', () => {
    const r1 = makeRow(0, 20);
    const r2 = makeRow(20, 20);
    const holder = {
      scrollTop: 900,
      scrollHeight: 1000,
      clientHeight: 100,
      getBoundingClientRect: () => rect(0, 100),
    };
    const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
    const table = {
      handlers,
      on: jest.fn((evt: string, fn: (...args: unknown[]) => void) => {
        (handlers[evt] ??= []).push(fn);
      }),
      element: { querySelector: jest.fn(() => holder) },
      getRows: jest.fn((type?: string) => (type === 'visible' ? [r1, r2] : [])),
      rowManager: { getDisplayRows: () => [] },
      scrollToRow: jest.fn(() => Promise.resolve()),
    };
    const plugin = new ScrollAnchor(table as never);
    (plugin as unknown as { table: typeof table }).table = table;
    (plugin as unknown as { options: () => boolean }).options = () => true;
    plugin.initialize();

    handlers.renderStarted?.[0]?.();

    expect((plugin as unknown as { wasAtBottom: boolean }).wasAtBottom).toBe(true);
    expect((plugin as unknown as { wasAtTop: boolean }).wasAtTop).toBe(false);
  });

  it('on renderComplete with wasAtTop, snaps scrollTop to 0 instead of centering', () => {
    const holder: { scrollTop: number; scrollHeight: number; clientHeight: number } = {
      scrollTop: 0,
      scrollHeight: 1000,
      clientHeight: 100,
    };
    const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
    const table = {
      handlers,
      on: jest.fn((evt: string, fn: (...args: unknown[]) => void) => {
        (handlers[evt] ??= []).push(fn);
      }),
      element: { querySelector: jest.fn(() => holder) },
      getRows: jest.fn(() => []),
      rowManager: { getDisplayRows: () => [] },
      scrollToRow: jest.fn(() => Promise.resolve()),
    };
    const plugin = new ScrollAnchor(table as never);
    (plugin as unknown as { table: typeof table }).table = table;
    (plugin as unknown as { options: () => boolean }).options = () => true;
    plugin.initialize();

    (plugin as unknown as { wasAtTop: boolean }).wasAtTop = true;
    holder.scrollTop = 200;
    handlers.renderComplete?.[0]?.();

    expect(holder.scrollTop).toBe(0);
    expect(table.scrollToRow).not.toHaveBeenCalled();
  });

  it('on renderComplete with wasAtBottom, snaps scrollTop to max instead of centering', () => {
    const holder: { scrollTop: number; scrollHeight: number; clientHeight: number } = {
      scrollTop: 0,
      scrollHeight: 1000,
      clientHeight: 100,
    };
    const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
    const table = {
      handlers,
      on: jest.fn((evt: string, fn: (...args: unknown[]) => void) => {
        (handlers[evt] ??= []).push(fn);
      }),
      element: { querySelector: jest.fn(() => holder) },
      getRows: jest.fn(() => []),
      rowManager: { getDisplayRows: () => [] },
      scrollToRow: jest.fn(() => Promise.resolve()),
    };
    const plugin = new ScrollAnchor(table as never);
    (plugin as unknown as { table: typeof table }).table = table;
    (plugin as unknown as { options: () => boolean }).options = () => true;
    plugin.initialize();

    (plugin as unknown as { wasAtBottom: boolean }).wasAtBottom = true;
    handlers.renderComplete?.[0]?.();

    expect(holder.scrollTop).toBe(900);
    expect(table.scrollToRow).not.toHaveBeenCalled();
  });

  it('does NOT zero paddingTop when scrollTop has accounted for it (legitimate state)', () => {
    const tableEl = { style: { paddingTop: '500px' } };
    const holder = {
      scrollTop: 500,
      querySelector: jest.fn((sel: string) => (sel === '.tabulator-table' ? tableEl : null)),
    };
    const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
    const renderer: Record<string, unknown> = { vDomTopPad: 500 };
    const table = {
      handlers,
      on: jest.fn((evt: string, fn: (...args: unknown[]) => void) => {
        (handlers[evt] ??= []).push(fn);
      }),
      element: { querySelector: jest.fn(() => holder) },
      getRows: jest.fn(() => []),
      rowManager: { renderer, getDisplayRows: () => [] },
      scrollToRow: jest.fn(() => Promise.resolve()),
    };

    const plugin = new ScrollAnchor(table as never);
    (plugin as unknown as { table: typeof table }).table = table;
    (plugin as unknown as { options: () => boolean }).options = () => true;
    plugin.initialize();

    (plugin as unknown as { _resetStaleTopPadding: () => void })._resetStaleTopPadding();

    expect(tableEl.style.paddingTop).toBe('500px');
    expect(renderer.vDomTopPad).toBe(500);
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
    // Holder top at y=50, anchor row top at y=80 → offset 30. r1 too small to be middle;
    // r2 covers half-height first.
    const r1 = makeRow(50, 20);
    const r2 = makeRow(80, 40);
    const holder = {
      scrollTop: 100,
      scrollHeight: 1000,
      clientHeight: 100,
      getBoundingClientRect: () => rect(50, 100),
    };
    const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
    const table = {
      handlers,
      on: jest.fn((evt: string, fn: (...args: unknown[]) => void) => {
        (handlers[evt] ??= []).push(fn);
      }),
      element: { querySelector: jest.fn(() => holder) },
      getRows: jest.fn((type?: string) => (type === 'visible' ? [r1, r2] : [])),
      rowManager: { getDisplayRows: () => [] },
      scrollToRow: jest.fn(() => Promise.resolve()),
    };
    const plugin = new ScrollAnchor(table as never);
    (plugin as unknown as { table: typeof table }).table = table;
    (plugin as unknown as { options: () => boolean }).options = () => true;
    plugin.initialize();

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
    const rowEl = { offsetTop: 500 };
    const r2: {
      getElement: () => unknown;
      getData: () => { originalData: { timestamp: number } };
      _getSelf: () => unknown;
    } = {
      getElement: () => rowEl,
      getData: () => ({ originalData: { timestamp: 0 } }),
      _getSelf: () => internalRow,
    };
    const holder: {
      scrollTop: number;
      scrollHeight: number;
      clientHeight: number;
      getBoundingClientRect: () => ReturnType<typeof rect>;
    } = {
      scrollTop: 100,
      scrollHeight: 5000,
      clientHeight: 100,
      getBoundingClientRect: () => rect(0, 100),
    };
    const renderer = {
      rows: jest.fn(() => [internalRow]),
      _virtualRenderFill: jest.fn(),
    };
    const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
    const table = {
      handlers,
      on: jest.fn((evt: string, fn: (...args: unknown[]) => void) => {
        (handlers[evt] ??= []).push(fn);
      }),
      element: { querySelector: jest.fn(() => holder) },
      getRows: jest.fn(() => []),
      rowManager: { renderer, getDisplayRows: () => [internalRow] },
      scrollToRow: jest.fn(() => Promise.resolve()),
    };
    const plugin = new ScrollAnchor(table as never);
    (plugin as unknown as { table: typeof table }).table = table;
    (plugin as unknown as { options: () => boolean }).options = () => true;
    plugin.initialize();

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
});
