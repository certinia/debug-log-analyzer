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

function makeRow(top: number, height = 20) {
  const internal = {};
  return {
    getElement: () => ({ getBoundingClientRect: () => rect(top, height) }),
    _getSelf: () => internal,
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
    const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
    const table = {
      handlers,
      on: jest.fn((evt: string, fn: (...args: unknown[]) => void) => {
        (handlers[evt] ??= []).push(fn);
      }),
      element: { querySelector: jest.fn(() => holder) },
      getRows: jest.fn((type?: string) => {
        if (type === 'visible') {
          return [r1, r2, r3];
        }
        return [];
      }),
      rowManager: { getDisplayRows: () => [] },
      scrollToRow: jest.fn(() => Promise.resolve()),
    };

    const plugin = new ScrollAnchor(table as never);
    (plugin as unknown as { table: typeof table }).table = table;
    (plugin as unknown as { options: () => boolean }).options = () => true;
    plugin.initialize();

    handlers.renderStarted?.[0]?.();
    expect((plugin as unknown as { anchorRow: unknown }).anchorRow).toBe(r2);

    // Simulate Tabulator firing renderStarted a second time within the same
    // cycle (e.g. nested rerenders). The `!this.anchorRow` guard should make
    // this a no-op even though the visible set has changed.
    (table.getRows as jest.Mock).mockImplementation((...args: unknown[]) => {
      if (args[0] === 'visible') {
        return [r3, r2, r1]; // reversed
      }
      return [];
    });
    handlers.renderStarted?.[0]?.();
    expect((plugin as unknown as { anchorRow: unknown }).anchorRow).toBe(r2);
  });

  it('zeros stale paddingBottom when the last display row is in the rendered window', () => {
    const tableEl = { style: { paddingBottom: '80px' } };
    const holder = {
      scrollTop: 0,
      querySelector: jest.fn((sel: string) => (sel === '.tabulator-table' ? tableEl : null)),
    };
    // 3 rows total; vDomBottom = 2 (== rowsCount - 1) → last row is rendered.
    const renderer: Record<string, unknown> = { vDomBottom: 2, vDomBottomPad: 80 };
    const internalRows = [{}, {}, {}];
    const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
    const table = {
      handlers,
      on: jest.fn((evt: string, fn: (...args: unknown[]) => void) => {
        (handlers[evt] ??= []).push(fn);
      }),
      element: { querySelector: jest.fn(() => holder) },
      getRows: jest.fn(() => []),
      rowManager: { renderer, getDisplayRows: () => internalRows },
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

  it('leaves paddingBottom alone when the last display row is not yet rendered', () => {
    const tableEl = { style: { paddingBottom: '80px' } };
    const holder = {
      scrollTop: 0,
      querySelector: jest.fn((sel: string) => (sel === '.tabulator-table' ? tableEl : null)),
    };
    // 10 rows total; vDomBottom = 4 → there are rows below the window. The pad
    // is legitimately non-zero in this case; we must not touch it.
    const renderer: Record<string, unknown> = { vDomBottom: 4, vDomBottomPad: 120 };
    const internalRows = Array.from({ length: 10 }, () => ({}));
    const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
    const table = {
      handlers,
      on: jest.fn((evt: string, fn: (...args: unknown[]) => void) => {
        (handlers[evt] ??= []).push(fn);
      }),
      element: { querySelector: jest.fn(() => holder) },
      getRows: jest.fn(() => []),
      rowManager: { renderer, getDisplayRows: () => internalRows },
      scrollToRow: jest.fn(() => Promise.resolve()),
    };
    const plugin = new ScrollAnchor(table as never);
    (plugin as unknown as { table: typeof table }).table = table;
    (plugin as unknown as { options: () => boolean }).options = () => true;
    plugin.initialize();

    (plugin as unknown as { _resetStaleBottomPadding: () => void })._resetStaleBottomPadding();

    expect(tableEl.style.paddingBottom).toBe('80px');
    expect(renderer.vDomBottomPad).toBe(120);
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
      querySelector: jest.fn((sel: string) => (sel === '.tabulator-table' ? tableEl : null)),
      getBoundingClientRect: () => rect(0, 100),
    };
    const renderer: Record<string, unknown> = { vDomBottom: 0, vDomBottomPad: 200 };
    const internalRows = [{}];
    const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
    const table = {
      handlers,
      on: jest.fn((evt: string, fn: (...args: unknown[]) => void) => {
        (handlers[evt] ??= []).push(fn);
      }),
      element: { querySelector: jest.fn(() => holder) },
      getRows: jest.fn(() => []),
      rowManager: { renderer, getDisplayRows: () => internalRows },
      scrollToRow: jest.fn(() => Promise.resolve()),
    };
    const plugin = new ScrollAnchor(table as never);
    (plugin as unknown as { table: typeof table }).table = table;
    (plugin as unknown as { options: () => boolean }).options = () => true;
    plugin.initialize();

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
    const holder: {
      scrollTop: number;
      scrollHeight: number;
      clientHeight: number;
      querySelector: () => null;
    } = {
      scrollTop: 0,
      scrollHeight: 1000,
      clientHeight: 100,
      querySelector: () => null,
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
    const holder: {
      scrollTop: number;
      scrollHeight: number;
      clientHeight: number;
      querySelector: () => null;
    } = {
      scrollTop: 0,
      scrollHeight: 1000,
      clientHeight: 100,
      querySelector: () => null,
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
    // Anchor row offsetTop=130, holder.scrollTop=100 → captured offset = 30 (the
    // row's Y position inside the visible holder viewport).
    const r1Internal = {};
    const r2Internal = {};
    const r1 = {
      getElement: () => ({ offsetTop: 100, getBoundingClientRect: () => rect(50, 20) }),
      _getSelf: () => r1Internal,
    };
    const r2 = {
      getElement: () => ({ offsetTop: 130, getBoundingClientRect: () => rect(80, 40) }),
      _getSelf: () => r2Internal,
    };
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
      querySelector: () => null;
    } = {
      scrollTop: 100,
      scrollHeight: 5000,
      clientHeight: 100,
      getBoundingClientRect: () => rect(0, 100),
      querySelector: () => null,
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

  it('fallback: collapse case walks up getTreeParent to the nearest displayed ancestor', () => {
    // Anchor row was a child collapsed under a parent. Parent is displayed.
    const parentInternal = {};
    const childInternal = {};
    const parentComponent = {
      _getSelf: () => parentInternal,
      getTreeParent: () => false,
    };
    const childComponent = {
      _getSelf: () => childInternal,
      getTreeParent: () => parentComponent,
    };
    const { table, plugin } = setup();
    table.rowManager.getDisplayRows = () => [parentInternal] as never;

    const p = plugin as unknown as { anchorRow: unknown };
    p.anchorRow = childComponent;

    const resolved = (
      plugin as unknown as { _resolveAnchorRow: () => unknown }
    )._resolveAnchorRow();
    expect(resolved).toBe(parentComponent);
  });

  it('fallback: filter case picks the row at the captured display-rows index (clamped)', () => {
    // Anchor row was at display-index 50 pre-render. Post-render display set has
    // only 10 rows (filter removed most). Index clamped to 9 (length - 1).
    const internalRows = Array.from({ length: 10 }, (_, i) => ({ id: i }));
    const expectedComponent = { mark: 'expected' };
    (internalRows[9] as unknown as { getComponent: () => unknown }).getComponent = () =>
      expectedComponent;

    const anchorInternal = {};
    const anchorComponent = {
      _getSelf: () => anchorInternal,
      getTreeParent: () => false,
    };
    const { table, plugin } = setup();
    table.rowManager.getDisplayRows = () => internalRows as never;

    const p = plugin as unknown as { anchorRow: unknown; anchorDisplayIndex: number };
    p.anchorRow = anchorComponent;
    p.anchorDisplayIndex = 50;

    const resolved = (
      plugin as unknown as { _resolveAnchorRow: () => unknown }
    )._resolveAnchorRow();
    expect(resolved).toBe(expectedComponent);
  });

  it('fallback: filter case with exact index returns the row at that index', () => {
    const internalRows = Array.from({ length: 100 }, (_, i) => ({ id: i }));
    const expectedComponent = { mark: 'at-30' };
    (internalRows[30] as unknown as { getComponent: () => unknown }).getComponent = () =>
      expectedComponent;

    const anchorInternal = {};
    const anchorComponent = {
      _getSelf: () => anchorInternal,
      getTreeParent: () => false,
    };
    const { table, plugin } = setup();
    table.rowManager.getDisplayRows = () => internalRows as never;

    const p = plugin as unknown as { anchorRow: unknown; anchorDisplayIndex: number };
    p.anchorRow = anchorComponent;
    p.anchorDisplayIndex = 30;

    const resolved = (
      plugin as unknown as { _resolveAnchorRow: () => unknown }
    )._resolveAnchorRow();
    expect(resolved).toBe(expectedComponent);
  });

  it('fallback: returns null when no parent is displayed and display rows are empty', () => {
    const anchorInternal = {};
    const anchorComponent = {
      _getSelf: () => anchorInternal,
      getTreeParent: () => false,
    };
    const { table, plugin } = setup();
    table.rowManager.getDisplayRows = () => [] as never;

    const p = plugin as unknown as { anchorRow: unknown; anchorDisplayIndex: number };
    p.anchorRow = anchorComponent;
    p.anchorDisplayIndex = 5;

    const resolved = (
      plugin as unknown as { _resolveAnchorRow: () => unknown }
    )._resolveAnchorRow();
    expect(resolved).toBeNull();
  });
});
