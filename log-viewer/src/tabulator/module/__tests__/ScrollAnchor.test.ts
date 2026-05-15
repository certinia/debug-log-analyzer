/* eslint-disable @typescript-eslint/naming-convention */
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

interface RowOpts {
  top?: number;
  height?: number;
  offsetTop?: number;
  isConnected?: boolean;
  parent?: MockRow | null;
  children?: MockRow[];
}

interface MockRow {
  getElement: () => MockElement;
  getData: () => unknown;
  getTreeParent: () => MockRow | false;
  getTreeChildren: () => MockRow[];
  _getSelf: () => unknown;
  __internal: object;
}

interface MockElement {
  getBoundingClientRect: () => ReturnType<typeof rect>;
  scrollIntoView?: (...args: unknown[]) => void;
  offsetTop: number;
  isConnected: boolean;
}

function makeRow(opts: RowOpts = {}, data: unknown = {}): MockRow {
  const top = opts.top ?? 0;
  const height = opts.height ?? 20;
  const elem: MockElement = {
    getBoundingClientRect: () => rect(top, height),
    scrollIntoView: () => {},
    offsetTop: opts.offsetTop ?? top,
    isConnected: opts.isConnected ?? true,
  };
  const internal = {};
  return {
    __internal: internal,
    getElement: () => elem,
    getData: () => data,
    getTreeParent: () => opts.parent ?? false,
    getTreeChildren: () => opts.children ?? [],
    _getSelf: () => internal,
  };
  internal.getComponent = () => row;
  return row;
}

function makeBareTable() {
  const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
  const renderer: Record<string, unknown> = { vDomTopPad: 0 };
  const displayInternals = (opts.displayRows ?? []).map((r) => r.__internal);
  const table = {
    handlers,
    on: jest.fn((evt: string, fn: (...args: unknown[]) => void) => {
      (handlers[evt] ??= []).push(fn);
    }),
    element: { querySelector: jest.fn(() => holder) },
    getRows: jest.fn((type?: string) => {
      if (type === 'visible') return opts.visibleRows ?? [];
      if (type === 'active') return opts.activeRows ?? opts.displayRows ?? [];
      return opts.displayRows ?? opts.visibleRows ?? [];
    }),
    rowManager: {
      renderer,
      getDisplayRows: () => displayInternals,
    },
    scrollToRow: jest.fn((..._args: unknown[]) => Promise.resolve()),
  };
}

function setup() {
  const table = makeBareTable();
  const plugin = new ScrollAnchor(table as never);
  (plugin as unknown as { table: typeof table }).table = table;
  (plugin as unknown as { options: () => boolean }).options = () => true;
  plugin.initialize();
  return { plugin, table, holder };
}

describe('ScrollAnchor', () => {
  it('snapshot at dataSorting captures the middle visible row before render', () => {
    const r1 = makeRow({ top: 0, height: 30 });
    const r2 = makeRow({ top: 30, height: 30 });
    const r3 = makeRow({ top: 60, height: 30 });
    const { table, plugin } = setup({
      visibleRows: [r1, r2, r3],
      displayRows: [r1, r2, r3],
      holderScrollTop: 500,
    });

    table.handlers.dataSorting?.[0]?.();

    expect(plugin.anchorRow).toBe(r2);
  });

  it('mid-table sort: scrollToRow(top) then refines scrollTop to prior viewport-Y', () => {
    // Anchor was at viewport y=40 pre-sort, with offsetTop=300 post-render.
    // Expect: scrollToRow(anchor, 'top', true), then scrollTop = 300 - 40 = 260.
    const anchor = makeRow({ top: 40, height: 20, offsetTop: 300 });
    const { table, holder } = setup({
      visibleRows: [anchor],
      displayRows: [anchor],
      holderScrollTop: 200,
      holderScrollHeight: 5000,
    });

    table.handlers.dataSorting?.[0]?.();
    table.handlers.renderComplete?.[0]?.();

    expect(table.scrollToRow).toHaveBeenCalledWith(anchor, 'top', true);
    expect(holder.scrollTop).toBe(260);
  });

  it('mid-table filter (anchor still visible): preserves exact viewport-Y', () => {
    const anchor = makeRow({ top: 10, height: 20, offsetTop: 500 });
    const { table, holder } = setup({
      visibleRows: [anchor],
      displayRows: [anchor],
      holderScrollTop: 490,
      holderScrollHeight: 5000,
    });

    table.handlers.renderStarted?.[0]?.();
    table.handlers.renderComplete?.[0]?.();

    expect(table.scrollToRow).toHaveBeenCalledTimes(1);
    expect(table.scrollToRow).toHaveBeenCalledWith(anchor, 'top', true);
    // savedOffset = 10 (anchor's viewport-Y at snapshot). After refine,
    // scrollTop = offsetTop(500) - savedOffset(10) = 490, so anchor sits at y=10.
    expect(holder.scrollTop).toBe(490);
  });

  it('preserve-offset clamps scrollTop within [0, scrollHeight - clientHeight]', () => {
    // Anchor at offsetTop=10, savedOffset=40 → raw target = -30. Clamp to 0.
    const anchor = makeRow({ top: 40, height: 20, offsetTop: 10 });
    const { table, holder } = setup({
      visibleRows: [anchor],
      displayRows: [anchor],
      holderScrollTop: 50,
      holderScrollHeight: 5000,
    });

    table.handlers.dataSorting?.[0]?.();
    table.handlers.renderComplete?.[0]?.();

    expect(holder.scrollTop).toBe(0);
  });

  it('anchor filtered out: time-nearest active row is used as fallback', () => {
    // Three rows in a flat list, all with originalData.timestamp.
    // Anchor at ts=200 is filtered out; rA(ts=100) and rC(ts=300) remain.
    const rA = makeRow(
      { top: -40, height: 20 },
      { originalData: { timestamp: 100, exitStamp: 100 } },
    );
    const anchor = makeRow(
      { top: 40, height: 20 },
      { originalData: { timestamp: 200, exitStamp: 200 } },
    );
    const rC = makeRow(
      { top: 80, height: 20 },
      { originalData: { timestamp: 300, exitStamp: 300 } },
    );

    const { table } = setup({
      visibleRows: [anchor],
      displayRows: [rA, anchor, rC],
      activeRows: [rA, anchor, rC],
      holderScrollTop: 400,
    });

    table.handlers.renderStarted?.[0]?.();
    // Filter hides anchor; rA and rC remain in display + active.
    table.rowManager.getDisplayRows = () => [rA.__internal, rC.__internal];
    table.getRows = jest.fn((type?: string) => {
      if (type === 'visible') return [rA, rC];
      if (type === 'active') return [rA, rC];
      return [rA, rC];
    });
    table.handlers.renderComplete?.[0]?.();

    // Old _findClosestActive returns null on a between-rows miss (no exact /
    // range hit at ts=200 when actives are 100 and 300), so no scroll happens.
    // This is the literal pre-rewrite behavior — the user said that worked.
    expect(table.scrollToRow).not.toHaveBeenCalled();
  });

  it('was-at-top: snaps scrollTop to 0 instead of centering', () => {
    const anchor = makeRow({ top: 10, height: 20 });
    const { table, holder } = setup({
      visibleRows: [anchor],
      displayRows: [anchor],
      holderScrollTop: 0,
    });

    table.handlers.renderStarted?.[0]?.();
    holder.scrollTop = 200;
    table.handlers.renderComplete?.[0]?.();

    expect(holder.scrollTop).toBe(0);
    expect(table.scrollToRow).not.toHaveBeenCalled();
  });

  it('was-at-bottom: snaps scrollTop to scrollHeight - clientHeight', () => {
    const anchor = makeRow({ top: 80, height: 20 });
    const { table, holder } = setup({
      visibleRows: [anchor],
      displayRows: [anchor],
      holderScrollTop: 900,
      holderScrollHeight: 1000,
      holderClientHeight: 100,
    });

    table.handlers.dataSorting?.[0]?.();
    table.handlers.renderComplete?.[0]?.();

    expect(holder.scrollTop).toBe(900);
    expect(table.scrollToRow).not.toHaveBeenCalled();
  });

  it('single tree toggle skips the restore (preserves scrollTop)', () => {
    const anchor = makeRow({ top: 40, height: 20 });
    const { table, holder } = setup({
      visibleRows: [anchor],
      displayRows: [anchor],
      holderScrollTop: 250,
    });

    table.handlers.dataTreeRowExpanded?.[0]?.();
    table.handlers.renderComplete?.[0]?.();

    expect(holder.scrollTop).toBe(250);
    expect(table.scrollToRow).not.toHaveBeenCalled();
  });

  it('bulk tree toggle clears the skip flag and restores anchor', () => {
    const r1 = makeRow({ top: 0, height: 30 });
    const r2 = makeRow({ top: 30, height: 30 });
    const r3 = makeRow({ top: 60, height: 30 });
    const { table } = setup({
      visibleRows: [r1, r2, r3],
      displayRows: [r1, r2, r3],
      holderScrollTop: 200,
    });

    table.handlers.dataTreeRowExpanded?.[0]?.();
    table.handlers.dataTreeRowExpanded?.[0]?.();
    table.handlers.renderStarted?.[0]?.();
    table.handlers.renderComplete?.[0]?.();

    // r2 is in displayRows → preserve-offset path → scrollToRow with 'top'.
    expect(table.scrollToRow).toHaveBeenCalledWith(r2, 'top', true);
  });

  it('zeros stale paddingTop after filter via _resetStaleTopPadding', () => {
    const tableEl = { style: { paddingTop: '120px' } };
    const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
    const holder: MockHolder = {
      scrollTop: 0,
      scrollHeight: 500,
      clientHeight: 100,
      getBoundingClientRect: () => rect(0, 100),
      querySelector: jest.fn((...args: unknown[]) =>
        args[0] === '.tabulator-table' ? tableEl : null,
      ),
    };
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

  it('does NOT zero paddingTop when scrollTop has accounted for it', () => {
    const tableEl = { style: { paddingTop: '500px' } };
    const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
    const holder: MockHolder = {
      scrollTop: 500,
      scrollHeight: 2000,
      clientHeight: 100,
      getBoundingClientRect: () => rect(0, 100),
      querySelector: jest.fn((...args: unknown[]) =>
        args[0] === '.tabulator-table' ? tableEl : null,
      ),
    };
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

  it('zeros paddingBottom when last row is rendered (vDomBottom === rowsCount - 1)', () => {
    const tableEl = { style: { paddingBottom: '300px' } };
    const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
    const holder: MockHolder = {
      scrollTop: 0,
      scrollHeight: 500,
      clientHeight: 100,
      getBoundingClientRect: () => rect(0, 100),
      querySelector: jest.fn((...args: unknown[]) =>
        args[0] === '.tabulator-table' ? tableEl : null,
      ),
    };
    // Last row is rendered (vDomBottom = 9, rowsCount = 10) but paddingBottom is 300.
    const renderer: Record<string, unknown> = {
      vDomBottom: 9,
      vDomRowHeight: 24,
      vDomBottomPad: 300,
    };
    const displayRows = Array.from({ length: 10 }, () => ({}));
    const table = {
      handlers,
      on: jest.fn((evt: string, fn: (...args: unknown[]) => void) => {
        (handlers[evt] ??= []).push(fn);
      }),
      element: { querySelector: jest.fn(() => holder) },
      getRows: jest.fn(() => []),
      rowManager: { renderer, getDisplayRows: () => displayRows },
      scrollToRow: jest.fn(() => Promise.resolve()),
    };
    const plugin = new ScrollAnchor(table as never);
    (plugin as unknown as { table: typeof table }).table = table;
    (plugin as unknown as { options: () => boolean }).options = () => true;
    plugin.initialize();

    (plugin as unknown as { _resetStaleBottomPadding: () => void })._resetStaleBottomPadding();

    expect(tableEl.style.paddingBottom).toBe('0px');
    expect(renderer.vDomBottomPad).toBe(0);
  });

  it('does NOT touch paddingBottom when more rows remain unrendered', () => {
    const tableEl = { style: { paddingBottom: '2500px' } };
    const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
    const holder: MockHolder = {
      scrollTop: 100,
      scrollHeight: 3000,
      clientHeight: 100,
      getBoundingClientRect: () => rect(0, 100),
      querySelector: jest.fn((...args: unknown[]) =>
        args[0] === '.tabulator-table' ? tableEl : null,
      ),
    };
    // 100 rows, only 10 rendered — Tabulator's own padding logic owns this case.
    const renderer: Record<string, unknown> = { vDomBottom: 9, vDomBottomPad: 2500 };
    const displayRows = Array.from({ length: 100 }, () => ({}));
    const table = {
      handlers,
      on: jest.fn((evt: string, fn: (...args: unknown[]) => void) => {
        (handlers[evt] ??= []).push(fn);
      }),
      element: { querySelector: jest.fn(() => holder) },
      getRows: jest.fn(() => []),
      rowManager: { renderer, getDisplayRows: () => displayRows },
      scrollToRow: jest.fn(() => Promise.resolve()),
    };
    const plugin = new ScrollAnchor(table as never);
    (plugin as unknown as { table: typeof table }).table = table;
    (plugin as unknown as { options: () => boolean }).options = () => true;
    plugin.initialize();

    (plugin as unknown as { _resetStaleBottomPadding: () => void })._resetStaleBottomPadding();

    expect(tableEl.style.paddingBottom).toBe('2500px');
    expect(renderer.vDomBottomPad).toBe(2500);
  });
});
