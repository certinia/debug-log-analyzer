/**
 * @jest-environment jsdom
 */
/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it, jest } from '@jest/globals';

import { VirtualVerticalRenderer } from '../VirtualVerticalRenderer';
import { seedHeightIndex } from './rendererTestUtils';

/**
 * _attachRanges phase behavior — needs jsdom (real DocumentFragment / div
 * elements), unlike the math-focused suite in VirtualVerticalRenderer.test.ts
 * which runs in the node environment with plain-object mocks.
 */

interface AttachRowStub {
  initialized: boolean;
  heightInitialized: boolean;
  initialize: jest.Mock;
  normalizeHeight: () => void;
  calcHeight: () => void;
  setCellHeight: () => void;
  clearCellHeight: () => void;
  rendered: jest.Mock;
  getElement: () => HTMLElement;
  getHeight: () => number;
  data: object;
}

interface AttachRendererInternals {
  inScrollDrivenRender: boolean;
  renderedRange: { top: number; bottom: number };
  measuredHeight: Float64Array;
  isMeasured: Uint8Array;
  fenwickMeasured: { resize: (n: number) => void; bulkInitConstant?: (v: number) => void };
  fenwickUnmeasuredCount: { resize: (n: number) => void; bulkInitConstant: (v: number) => void };
  measuredSum: number;
  measuredCount: number;
  rowsCountCached: number;
  _attachRanges: (rows: AttachRowStub[], ranges: Array<[number, number]>, newTop: number) => void;
  _scheduleIdlePrewarm: () => void;
}

function makeAttachSetup(rowCount: number): {
  r: AttachRendererInternals;
  rows: AttachRowStub[];
  tableElement: HTMLElement;
} {
  const tableElement = document.createElement('div');
  const rows: AttachRowStub[] = Array.from({ length: rowCount }, () => {
    const el = document.createElement('div');
    const row: AttachRowStub = {
      initialized: true,
      heightInitialized: true,
      // Mirrors real Tabulator Row.initialize, which flips `initialized` —
      // the idle pre-warm walker relies on it to make progress.
      initialize: jest.fn(() => {
        row.initialized = true;
      }),
      normalizeHeight: () => {},
      calcHeight: () => {},
      setCellHeight: () => {},
      clearCellHeight: () => {},
      rendered: jest.fn(),
      getElement: () => el,
      getHeight: () => 30,
      data: {},
    };
    return row;
  });
  const table = {
    rowManager: {
      element: { scrollTop: 0, clientHeight: 100, clientWidth: 200, scrollHeight: 10000 },
      tableElement,
      getDisplayRows: () => rows,
      scrollHorizontal: () => {},
    },
    columnManager: { element: {} },
    options: {},
    eventBus: { _events: {}, dispatch: () => {} },
  };
  const ctor = VirtualVerticalRenderer as unknown as new (t: unknown) => AttachRendererInternals;
  const r = new ctor(table);
  seedHeightIndex(r, rowCount);
  return { r, rows, tableElement };
}

describe('VirtualVerticalRenderer._attachRanges rendered() once per row lifetime', () => {
  it('fires rendered() for every attached row on structural renders', () => {
    const { r, rows } = makeAttachSetup(5);
    r.inScrollDrivenRender = false;
    r._attachRanges(rows, [[0, 4]], 0);
    for (const row of rows) {
      expect(row.rendered).toHaveBeenCalledTimes(1);
    }
  });

  it('does NOT re-fire rendered() for initialized rows on scroll-driven renders', () => {
    const { r, rows } = makeAttachSetup(5);
    // First structural attach builds + renders everything.
    r._attachRanges(rows, [[0, 4]], 0);
    for (const row of rows) {
      row.rendered.mockClear();
    }
    // Scroll-driven re-attach of already-initialized rows: cell DOM persists
    // across detach/attach, so cellRendered must not be re-dispatched.
    r.inScrollDrivenRender = true;
    r._attachRanges(rows, [[0, 4]], 0);
    for (const row of rows) {
      expect(row.rendered).not.toHaveBeenCalled();
    }
  });

  it('fires rendered() during scroll-driven renders for rows initialized this attach', () => {
    const { r, rows } = makeAttachSetup(5);
    rows.forEach((row, i) => {
      // Rows 0-1 never built before; 2-4 already initialized.
      row.initialized = i >= 2;
    });
    r.inScrollDrivenRender = true;
    r._attachRanges(rows, [[0, 4]], 0);
    expect(rows[0]?.rendered).toHaveBeenCalledTimes(1);
    expect(rows[1]?.rendered).toHaveBeenCalledTimes(1);
    expect(rows[2]?.rendered).not.toHaveBeenCalled();
    expect(rows[3]?.rendered).not.toHaveBeenCalled();
    expect(rows[4]?.rendered).not.toHaveBeenCalled();
    // The just-built rows also went through initialize(false, true).
    expect(rows[0]?.initialize).toHaveBeenCalledWith(false, true);
  });
});

describe('VirtualVerticalRenderer idle pre-warm', () => {
  type IdleCb = (deadline: { timeRemaining: () => number; didTimeout: boolean }) => void;
  let idleQueue: IdleCb[];
  const realRic = globalThis.requestIdleCallback;
  const realCancel = globalThis.cancelIdleCallback;

  beforeEach(() => {
    idleQueue = [];
    (globalThis as { requestIdleCallback: unknown }).requestIdleCallback = (cb: IdleCb) => {
      idleQueue.push(cb);
      return idleQueue.length;
    };
    (globalThis as { cancelIdleCallback: unknown }).cancelIdleCallback = () => {};
  });

  afterEach(() => {
    (globalThis as { requestIdleCallback: unknown }).requestIdleCallback = realRic;
    (globalThis as { cancelIdleCallback: unknown }).cancelIdleCallback = realCancel;
  });

  it('initializes rows beyond both window edges, skipping the window itself', () => {
    const { r, rows } = makeAttachSetup(50);
    rows.forEach((row) => {
      row.initialized = false;
    });
    r.renderedRange = { top: 20, bottom: 24 };

    r._scheduleIdlePrewarm();
    expect(idleQueue.length).toBe(1);
    // Drain the idle chain — the walker self-caps per slot and reschedules.
    for (let slot = 0; slot < idleQueue.length && slot < 20; slot++) {
      idleQueue[slot]?.({ timeRemaining: () => 50, didTimeout: false });
    }

    // Window rows untouched; rows beyond both edges built off-DOM.
    for (let i = 20; i <= 24; i++) {
      expect(rows[i]?.initialize).not.toHaveBeenCalled();
    }
    expect(rows[25]?.initialize).toHaveBeenCalledWith(false, true);
    expect(rows[49]?.initialize).toHaveBeenCalledWith(false, true);
    expect(rows[19]?.initialize).toHaveBeenCalledWith(false, true);
    expect(rows[0]?.initialize).toHaveBeenCalledWith(false, true);
  });

  it('stops at the idle deadline and reschedules the remainder', () => {
    const { r, rows } = makeAttachSetup(50);
    rows.forEach((row) => {
      row.initialized = false;
    });
    r.renderedRange = { top: 0, bottom: 4 };

    r._scheduleIdlePrewarm();
    // Budget for only 10 walker iterations, then exhausted.
    let budget = 10;
    idleQueue[0]?.({ timeRemaining: () => (budget-- > 0 ? 50 : 0), didTimeout: false });

    const builtAfterFirstSlot = rows.filter((row) => row.initialize.mock.calls.length > 0).length;
    expect(builtAfterFirstSlot).toBeGreaterThan(0);
    expect(builtAfterFirstSlot).toBeLessThan(45);
    // Remainder rescheduled into further idle slots; drain the chain.
    expect(idleQueue.length).toBe(2);
    for (let slot = 1; slot < idleQueue.length && slot < 20; slot++) {
      idleQueue[slot]?.({ timeRemaining: () => 50, didTimeout: false });
    }
    expect(rows[49]?.initialize).toHaveBeenCalledWith(false, true);
  });

  it('does not throw when requestIdleCallback is unavailable', () => {
    const { r } = makeAttachSetup(5);
    (globalThis as { requestIdleCallback: unknown }).requestIdleCallback = undefined;
    expect(() => r._scheduleIdlePrewarm()).not.toThrow();
  });
});

describe('VirtualVerticalRenderer._attachRanges styleRow once per row lifetime', () => {
  const hasParityClass = (el: HTMLElement) =>
    el.classList.contains('tabulator-row-even') || el.classList.contains('tabulator-row-odd');

  it('applies parity classes on structural attach, skips re-application on scroll re-attach', () => {
    const { r, rows } = makeAttachSetup(4);
    r._attachRanges(rows, [[0, 3]], 0); // structural: stripes everything
    for (const row of rows) {
      expect(hasParityClass(row.getElement())).toBe(true);
      row.getElement().classList.remove('tabulator-row-even', 'tabulator-row-odd');
    }
    // Scroll re-attach of initialized rows: index parity is scroll-invariant,
    // so styleRow must NOT run again (classes stay absent after manual strip).
    r.inScrollDrivenRender = true;
    r._attachRanges(rows, [[0, 3]], 0);
    for (const row of rows) {
      expect(hasParityClass(row.getElement())).toBe(false);
    }
  });

  it('styles rows first built during a scroll-driven attach', () => {
    const { r, rows } = makeAttachSetup(2);
    rows.forEach((row) => {
      row.initialized = false;
    });
    r.inScrollDrivenRender = true;
    r._attachRanges(rows, [[0, 1]], 0);
    for (const row of rows) {
      expect(hasParityClass(row.getElement())).toBe(true);
    }
  });
});
