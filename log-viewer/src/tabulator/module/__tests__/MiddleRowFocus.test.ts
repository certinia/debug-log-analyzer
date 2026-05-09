import { describe, expect, it, jest } from '@jest/globals';
import { MiddleRowFocus } from '../MiddleRowFocus';

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
  const plugin = new MiddleRowFocus(table as never);
  (plugin as unknown as { table: typeof table }).table = table;
  (plugin as unknown as { options: () => boolean }).options = () => true;
  plugin.initialize();
  return { plugin, table };
}

describe('MiddleRowFocus', () => {
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

    const plugin = new MiddleRowFocus(table as never);
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

    const plugin = new MiddleRowFocus(table as never);
    (plugin as unknown as { table: typeof table }).table = table;
    (plugin as unknown as { options: () => boolean }).options = () => true;
    plugin.initialize();

    // Sort starts — pre-sort middle row should be captured now (= r2).
    handlers.dataSorting?.[0]?.();
    expect((plugin as unknown as { middleRow: unknown }).middleRow).toBe(r2);

    // Tabulator now rebuilds DOM with sorted rows in a different order. If our
    // dataSorting capture didn't happen, renderStarted would capture the wrong
    // row. Simulate that by changing the visible set and firing renderStarted —
    // the guard `!this.middleRow` should make this a no-op.
    (table.getRows as jest.Mock).mockImplementation((...args: unknown[]) => {
      if (args[0] === 'visible') return [r3, r2, r1]; // reversed
      return [];
    });
    handlers.renderStarted?.[0]?.();
    expect((plugin as unknown as { middleRow: unknown }).middleRow).toBe(r2);
  });

  it('zeros stale paddingTop after filter when scrollTop is less than paddingTop', () => {
    // Build a holder containing a .tabulator-table child whose style.paddingTop
    // simulates the inflated value Tabulator's rerenderRows leaves behind.
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

    const plugin = new MiddleRowFocus(table as never);
    (plugin as unknown as { table: typeof table }).table = table;
    (plugin as unknown as { options: () => boolean }).options = () => true;
    plugin.initialize();

    // Drive the workaround directly (rAF-free) — same code path the rAF schedules.
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
    const plugin = new MiddleRowFocus(table as never);
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
    // scrollHeight 1000, clientHeight 100 → max scrollTop = 900.
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
    const plugin = new MiddleRowFocus(table as never);
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
    const plugin = new MiddleRowFocus(table as never);
    (plugin as unknown as { table: typeof table }).table = table;
    (plugin as unknown as { options: () => boolean }).options = () => true;
    plugin.initialize();

    // Simulate post-snapshot state where wasAtTop is set.
    (plugin as unknown as { wasAtTop: boolean }).wasAtTop = true;
    holder.scrollTop = 200; // pretend Tabulator moved scrollTop during render
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
    const plugin = new MiddleRowFocus(table as never);
    (plugin as unknown as { table: typeof table }).table = table;
    (plugin as unknown as { options: () => boolean }).options = () => true;
    plugin.initialize();

    (plugin as unknown as { wasAtBottom: boolean }).wasAtBottom = true;
    handlers.renderComplete?.[0]?.();

    expect(holder.scrollTop).toBe(900); // 1000 - 100
    expect(table.scrollToRow).not.toHaveBeenCalled();
  });

  it('does NOT zero paddingTop when scrollTop has accounted for it (legitimate state)', () => {
    // Mid-table: scrollTop matches paddingTop, meaning the user has genuinely scrolled
    // past the rows the padding represents. Mitigation must leave this alone.
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

    const plugin = new MiddleRowFocus(table as never);
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

    // After the first toggle skip was armed; subsequent toggles cleared it.
    expect((plugin as unknown as { skipNextRender: boolean }).skipNextRender).toBe(false);
    expect((plugin as unknown as { toggleSeenInBurst: boolean }).toggleSeenInBurst).toBe(true);
  });
});
