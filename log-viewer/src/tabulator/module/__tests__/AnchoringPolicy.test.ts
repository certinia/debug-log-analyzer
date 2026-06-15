/**
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it, jest } from '@jest/globals';

import { AnchoringPolicy } from '../AnchoringPolicy';

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
  // The policy delegates restores to renderer.setAnchor — the seam
  // VirtualVerticalRenderer exposes. Mock it to assert exact call args.
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
  const plugin = new AnchoringPolicy(table as never);
  (plugin as unknown as { table: typeof table }).table = table;
  (plugin as unknown as { options: () => boolean }).options = () => true;
  plugin.initialize();
  return { plugin, table, holder, setAnchor };
}

/** Let queued microtasks (the policy's capture sweep) run. */
function flushMicrotasks(): Promise<void> {
  return Promise.resolve();
}

describe('AnchoringPolicy', () => {
  it('sort/filter: restores the middle visible row at its captured offset', () => {
    // Pre-sort: row offsetTop=240, holder scrollTop=200 → captured offset 40.
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

  it('tree toggle: pins the CLICKED row at its captured offset (overrides generic restore)', () => {
    // Three visible rows; r2 is the middle (generic anchor). The user toggles
    // r3 — the dataTree event fires after renderComplete, same task, and must
    // re-anchor to r3 at ITS captured offset.
    const r1 = makeRow({ top: 0, height: 30, offsetTop: 200 });
    const r2 = makeRow({ top: 30, height: 30, offsetTop: 230 });
    const r3 = makeRow({ top: 60, height: 30, offsetTop: 260 });
    const { table, setAnchor } = setup({
      visibleRows: [r1, r2, r3],
      displayRows: [r1, r2, r3],
      holderScrollTop: 200,
      holderScrollHeight: 5000,
    });

    table.handlers.renderStarted?.[0]?.();
    table.handlers.renderComplete?.[0]?.();
    table.handlers.dataTreeRowExpanded?.[0]?.(r3);

    // Generic restore (middle row r2 at offset 30) then precise restore
    // (clicked r3 at offset 60). The precise call wins by running last.
    expect(setAnchor).toHaveBeenCalledTimes(2);
    expect(setAnchor).toHaveBeenNthCalledWith(1, r2.__internal, 30);
    expect(setAnchor).toHaveBeenNthCalledWith(2, r3.__internal, 60);
  });

  it('was-at-top: snaps scrollTop to 0; a following toggle event does not re-anchor', () => {
    const anchor = makeRow({ top: 10, height: 20 });
    const { table, holder, setAnchor } = setup({
      visibleRows: [anchor],
      displayRows: [anchor],
      holderScrollTop: 0,
    });

    table.handlers.renderStarted?.[0]?.();
    holder.scrollTop = 200;
    table.handlers.renderComplete?.[0]?.();
    table.handlers.dataTreeRowCollapsed?.[0]?.(anchor);

    expect(holder.scrollTop).toBe(0);
    expect(setAnchor).not.toHaveBeenCalled();
  });

  it('was-at-bottom: snaps to maxScroll; a following toggle event does not re-anchor', () => {
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
    table.handlers.dataTreeRowExpanded?.[0]?.(anchor);

    expect(holder.scrollTop).toBe(900);
    expect(setAnchor).not.toHaveBeenCalled();
  });

  it('tiny overflow: user at the bottom is snapped to the bottom, not the top', () => {
    // Content exceeds the viewport by only 8px, so BOTH edges are within the
    // boundary threshold. Proximity must break the tie — a user sitting at
    // the bottom (scrollTop = max = 8) stays at the bottom.
    const anchor = makeRow({ top: 0, height: 20 });
    const { table, holder } = setup({
      visibleRows: [anchor],
      displayRows: [anchor],
      holderScrollTop: 8,
      holderScrollHeight: 108,
      holderClientHeight: 100,
    });

    table.handlers.renderStarted?.[0]?.();
    holder.scrollTop = 0; // browser/pipeline moved it during the re-render
    table.handlers.renderComplete?.[0]?.();

    expect(holder.scrollTop).toBe(8); // restored to maxScroll, not 0
  });

  it('edge snaps use the renderer setScrollTop seam when available (echo suppression)', () => {
    const anchor = makeRow({ top: 10, height: 20 });
    const { table, holder } = setup({
      visibleRows: [anchor],
      displayRows: [anchor],
      holderScrollTop: 0,
    });
    const setScrollTop = jest.fn();
    (table.rowManager.renderer as Record<string, unknown>)['setScrollTop'] = setScrollTop;

    table.handlers.renderStarted?.[0]?.();
    holder.scrollTop = 200;
    table.handlers.renderComplete?.[0]?.();

    expect(setScrollTop).toHaveBeenCalledWith(0);
    expect(holder.scrollTop).toBe(200); // raw write NOT used when the seam exists
  });

  it('bulk toggles under blockRedraw: dataTree events with no capture are ignored', () => {
    const anchor = makeRow({ top: 40, height: 20 });
    const { table, holder, setAnchor } = setup({
      visibleRows: [anchor],
      displayRows: [anchor],
      holderScrollTop: 250,
    });

    // No renderStarted fired (renders deferred by blockRedraw) → no capture.
    table.handlers.dataTreeRowExpanded?.[0]?.(anchor);
    table.handlers.dataTreeRowExpanded?.[0]?.(anchor);

    expect(holder.scrollTop).toBe(250);
    expect(setAnchor).not.toHaveBeenCalled();
  });

  it('clears an unconsumed capture after the task (no leak into later toggles)', async () => {
    const anchor = makeRow({ top: 40, height: 20, offsetTop: 240 });
    const { table, setAnchor } = setup({
      visibleRows: [anchor],
      displayRows: [anchor],
      holderScrollTop: 200,
      holderScrollHeight: 5000,
    });

    // A sort cycle completes without any toggle...
    table.handlers.renderStarted?.[0]?.();
    table.handlers.renderComplete?.[0]?.();
    expect(setAnchor).toHaveBeenCalledTimes(1);
    await flushMicrotasks();

    // ...a toggle event arriving in a LATER task must not reuse the capture.
    table.handlers.dataTreeRowExpanded?.[0]?.(anchor);
    expect(setAnchor).toHaveBeenCalledTimes(1);
  });

  it('anchor filtered out, tree parent survives: restores via the parent', () => {
    const parent = makeRow({ top: 0, height: 20, offsetTop: 0 });
    const child = makeRow({ top: 20, height: 20, offsetTop: 220, parent });

    // Only the child is visible (parent scrolled off above). After the
    // operation the child is collapsed away; the policy must anchor the
    // surviving parent at the CHILD's captured offset.
    const { table, setAnchor } = setup({
      visibleRows: [child],
      displayRows: [parent, child],
      holderScrollTop: 200,
      holderScrollHeight: 5000,
    });

    table.handlers.renderStarted?.[0]?.();
    // Child collapsed/filtered away post-render.
    table.rowManager.getDisplayRows = () => [parent.__internal];
    table.handlers.renderComplete?.[0]?.();

    expect(setAnchor).toHaveBeenCalledTimes(1);
    // Child's captured offset: offsetTop(220) − scrollTop(200) = 20.
    expect(setAnchor).toHaveBeenCalledWith(parent.__internal, 20);
  });

  it('anchor removed with no surviving ancestor: cedes to the renderer default', () => {
    const anchor = makeRow({ top: 40, height: 20, offsetTop: 40 });
    const survivor = makeRow({ top: 80, height: 20, offsetTop: 80 });

    const { table, holder, setAnchor } = setup({
      visibleRows: [anchor],
      displayRows: [anchor, survivor],
      holderScrollTop: 400,
    });

    table.handlers.renderStarted?.[0]?.();
    table.rowManager.getDisplayRows = () => [survivor.__internal];

    const scrollBefore = holder.scrollTop;
    table.handlers.renderComplete?.[0]?.();

    expect(setAnchor).not.toHaveBeenCalled();
    expect(holder.scrollTop).toBe(scrollBefore);
  });

  it('toggled row not visible at capture (programmatic): keeps the generic restore', () => {
    const visible = makeRow({ top: 40, height: 20, offsetTop: 240 });
    const offscreen = makeRow({ top: 900, height: 20, offsetTop: 900 });
    const { table, setAnchor } = setup({
      visibleRows: [visible],
      displayRows: [visible, offscreen],
      holderScrollTop: 200,
      holderScrollHeight: 5000,
    });

    table.handlers.renderStarted?.[0]?.();
    table.handlers.renderComplete?.[0]?.();
    table.handlers.dataTreeRowExpanded?.[0]?.(offscreen);

    // Only the generic (middle visible row) restore — no precise call for a
    // row whose pre-toggle offset was never captured.
    expect(setAnchor).toHaveBeenCalledTimes(1);
    expect(setAnchor).toHaveBeenCalledWith(visible.__internal, 40);
  });
});
