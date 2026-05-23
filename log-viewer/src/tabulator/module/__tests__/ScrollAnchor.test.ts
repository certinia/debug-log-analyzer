/**
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
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
  parent?: MockRow | null;
}

interface MockRow {
  getElement: () => MockElement;
  getTreeParent: () => MockRow | false;
  _getSelf: () => unknown;
  __internal: object;
}

interface MockElement {
  getBoundingClientRect: () => ReturnType<typeof rect>;
  offsetTop: number;
}

function makeRow(opts: RowOpts = {}): MockRow {
  const top = opts.top ?? 0;
  const height = opts.height ?? 20;
  const elem: MockElement = {
    getBoundingClientRect: () => rect(top, height),
    offsetTop: opts.offsetTop ?? top,
  };
  const internal = {};
  return {
    __internal: internal,
    getElement: () => elem,
    getTreeParent: () => opts.parent ?? false,
    _getSelf: () => internal,
  };
}

interface MockHolder {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  getBoundingClientRect: () => ReturnType<typeof rect>;
}

interface SetupOpts {
  visibleRows?: MockRow[];
  displayRows?: MockRow[];
  holderScrollTop?: number;
  holderScrollHeight?: number;
  holderClientHeight?: number;
}

function setup(opts: SetupOpts = {}) {
  const holder: MockHolder = {
    scrollTop: opts.holderScrollTop ?? 200,
    scrollHeight: opts.holderScrollHeight ?? 1000,
    clientHeight: opts.holderClientHeight ?? 100,
    getBoundingClientRect: () => rect(0, opts.holderClientHeight ?? 100),
  };
  const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
  // ScrollAnchor delegates mid-table restore to renderer.setAnchor — the
  // seam VirtualVerticalRenderer exposes. Mock it as a jest.fn so we can
  // assert exact call args.
  const setAnchor = jest.fn((_row: unknown, _offset: number) => {});
  const renderer: Record<string, unknown> = { setAnchor };
  const displayInternals = (opts.displayRows ?? []).map((r) => r.__internal);
  const table = {
    handlers,
    on: jest.fn((evt: string, fn: (...args: unknown[]) => void) => {
      (handlers[evt] ??= []).push(fn);
    }),
    element: { querySelector: jest.fn(() => holder) },
    getRows: jest.fn((type?: string) => {
      if (type === 'visible') {
        return opts.visibleRows ?? [];
      }
      return opts.displayRows ?? opts.visibleRows ?? [];
    }),
    rowManager: {
      renderer,
      getDisplayRows: () => displayInternals,
    },
  };
  const plugin = new ScrollAnchor(table as never);
  (plugin as unknown as { table: typeof table }).table = table;
  (plugin as unknown as { options: () => boolean }).options = () => true;
  plugin.initialize();
  return { plugin, table, holder, setAnchor };
}

describe('ScrollAnchor', () => {
  it('captures the middle visible row at renderStarted', () => {
    const r1 = makeRow({ top: 0, height: 30 });
    const r2 = makeRow({ top: 30, height: 30 });
    const r3 = makeRow({ top: 60, height: 30 });
    const { table, plugin } = setup({
      visibleRows: [r1, r2, r3],
      displayRows: [r1, r2, r3],
      holderScrollTop: 500,
    });

    table.handlers.renderStarted?.[0]?.();

    expect(plugin.anchorRow).toBe(r2);
  });

  it('mid-table sort: delegates to renderer.setAnchor with captured offset', () => {
    // Pre-sort: row offsetTop=240, holder scrollTop=200 → captured viewport-Y = 40.
    const anchor = makeRow({ top: 40, height: 20, offsetTop: 240 });
    const { table, setAnchor } = setup({
      visibleRows: [anchor],
      displayRows: [anchor],
      holderScrollTop: 200,
      holderScrollHeight: 5000,
    });

    table.handlers.renderStarted?.[0]?.();
    table.handlers.renderComplete?.[0]?.();

    expect(setAnchor).toHaveBeenCalledTimes(1);
    expect(setAnchor).toHaveBeenCalledWith(anchor.__internal, 40);
  });

  it('returns the row whose cumulative visible height first crosses half of the holder height', () => {
    // holder height 100, target 50. r1 contributes 30 (running 30), r2 contributes 30
    // (running 60 — first row at/over 50), r3 never reached.
    const r1 = makeRow({ top: 0, height: 30 });
    const r2 = makeRow({ top: 30, height: 30 });
    const r3 = makeRow({ top: 60, height: 30 });
    const holder = { getBoundingClientRect: () => rect(0, 100) };

    const table = {
      on: jest.fn(),
      element: { querySelector: jest.fn() },
      getRows: jest.fn((type?: string) => {
        if (type === 'visible') {
          return [r1, r2, r3];
        }
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

  it('mid-table filter (anchor still visible): preserves exact viewport-Y', () => {
    // offsetTop=500, holder.scrollTop=490 → row sits 10px below the holder's
    // visible top. _captureAnchor records that exact offset and passes it
    // through to setAnchor unchanged.
    const anchor = makeRow({ top: 10, height: 20, offsetTop: 500 });
    const { table, setAnchor } = setup({
      visibleRows: [anchor],
      displayRows: [anchor],
      holderScrollTop: 490,
      holderScrollHeight: 5000,
    });

    table.handlers.renderStarted?.[0]?.();
    table.handlers.renderComplete?.[0]?.();

    expect(setAnchor).toHaveBeenCalledTimes(1);
    expect(setAnchor).toHaveBeenCalledWith(anchor.__internal, 10);
  });

  it('anchor filtered out without surviving ancestor: cedes to renderer default', () => {
    const rA = makeRow({ top: -40, height: 20, offsetTop: 0 });
    const anchor = makeRow({ top: 40, height: 20, offsetTop: 40 });
    const rC = makeRow({ top: 80, height: 20, offsetTop: 80 });

    const { table, holder, setAnchor } = setup({
      visibleRows: [anchor],
      displayRows: [rA, anchor, rC],
      holderScrollTop: 400,
    });

    table.handlers.renderStarted?.[0]?.();
    table.rowManager.getDisplayRows = () => [rA.__internal, rC.__internal];

    const scrollBefore = holder.scrollTop;
    table.handlers.renderComplete?.[0]?.();

    expect(setAnchor).not.toHaveBeenCalled();
    expect(holder.scrollTop).toBe(scrollBefore);
  });

  it('anchor filtered out, tree parent survives: delegates to setAnchor on parent', () => {
    const parent = makeRow({ top: 0, height: 20, offsetTop: 0 });
    const child = makeRow({ top: 20, height: 20, offsetTop: 20, parent });

    // scrollTop > boundaryThresholdPx (10) so wasAtTop doesn't trip.
    const { table, setAnchor } = setup({
      visibleRows: [child],
      displayRows: [parent, child],
      holderScrollTop: 200,
      holderScrollHeight: 5000,
    });

    table.handlers.renderStarted?.[0]?.();
    table.rowManager.getDisplayRows = () => [parent.__internal];
    table.handlers.renderComplete?.[0]?.();

    expect(setAnchor).toHaveBeenCalledTimes(1);
    expect(setAnchor).toHaveBeenCalledWith(parent.__internal, expect.any(Number));
  });

  it('was-at-top: snaps scrollTop to 0 instead of delegating', () => {
    const anchor = makeRow({ top: 10, height: 20 });
    const { table, holder, setAnchor } = setup({
      visibleRows: [anchor],
      displayRows: [anchor],
      holderScrollTop: 0,
    });

    table.handlers.renderStarted?.[0]?.();
    holder.scrollTop = 200;
    table.handlers.renderComplete?.[0]?.();

    expect(holder.scrollTop).toBe(0);
    expect(setAnchor).not.toHaveBeenCalled();
  });

  it('was-at-bottom: snaps to scrollHeight - clientHeight', () => {
    const anchor = makeRow({ top: 80, height: 20 });
    const { table, holder, setAnchor } = setup({
      visibleRows: [anchor],
      displayRows: [anchor],
      holderScrollTop: 900,
      holderScrollHeight: 1000,
      holderClientHeight: 100,
    });

    table.handlers.renderStarted?.[0]?.();
    table.handlers.renderComplete?.[0]?.();

    expect(holder.scrollTop).toBe(900);
    expect(setAnchor).not.toHaveBeenCalled();
  });

  it('single tree toggle skips restore (preserves scrollTop)', () => {
    const anchor = makeRow({ top: 40, height: 20 });
    const { table, holder, setAnchor } = setup({
      visibleRows: [anchor],
      displayRows: [anchor],
      holderScrollTop: 250,
    });

    table.handlers.dataTreeRowExpanded?.[0]?.();
    table.handlers.renderComplete?.[0]?.();

    expect(holder.scrollTop).toBe(250);
    expect(setAnchor).not.toHaveBeenCalled();
  });

  it('bulk tree toggle: second toggle clears skip flag, restore delegates', () => {
    const r1 = makeRow({ top: 0, height: 30 });
    const r2 = makeRow({ top: 30, height: 30, offsetTop: 30 });
    const r3 = makeRow({ top: 60, height: 30 });
    const { table, setAnchor } = setup({
      visibleRows: [r1, r2, r3],
      displayRows: [r1, r2, r3],
      holderScrollTop: 200,
    });

    table.handlers.dataTreeRowExpanded?.[0]?.();
    table.handlers.dataTreeRowExpanded?.[0]?.();
    table.handlers.renderStarted?.[0]?.();
    table.handlers.renderComplete?.[0]?.();

    // r2 middle visible row → captured. offsetTop=30 - scrollTop=200 = -170.
    expect(setAnchor).toHaveBeenCalledTimes(1);
    expect(setAnchor).toHaveBeenCalledWith(r2.__internal, -170);
  });
});
