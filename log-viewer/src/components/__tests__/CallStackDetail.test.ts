/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { afterEach, describe, expect, it } from '@jest/globals';

import type { CallStackRow } from '../callStackData.js';

const frameRow = (eventIndex: number, total: number, self: number): CallStackRow => ({
  eventIndex,
  type: 'METHOD_ENTRY',
  text: `m${eventIndex}`,
  duration: { total, self },
});

// No log store in the test, so the stack is stubbed: frame 1 called 4, which called 9.
const built: number[] = [];
jest.mock('../callStackData.js', () => ({
  buildCallStackData: (eventIndex: number) => {
    built.push(eventIndex);
    return {
      rows: [frameRow(1, 100, 20), frameRow(4, 80, 30), frameRow(9, 50, 50)],
      rootTotal: 100,
    };
  },
}));
jest.mock('../panelRowMenu.js', () => ({
  ...jest.requireActual<object>('../panelRowMenu.js'),
  runPanelRowAction: jest.fn(),
}));

import { runCalc } from '#test-helpers/calcs.js';
import { eventBus } from '../../core/events/EventBus.js';
import type { CallStackDetail } from '../CallStackDetail.js';
import '../CallStackDetail.js';
import type { ContextMenu } from '../ContextMenu.js';
import type { AppGrid } from '../grid/AppGrid.js';
import {
  INSPECTOR_LOCATE_EVENT,
  INSPECTOR_REVEAL_EVENT,
  type InspectorLocateEvent,
  type InspectorRevealEvent,
} from '../inspectorReveal.js';
import { runPanelRowAction } from '../panelRowMenu.js';

async function mount(eventIndex: number): Promise<CallStackDetail> {
  const el = document.createElement('call-stack-detail') as CallStackDetail;
  el.eventIndex = eventIndex;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

function gridOf(el: CallStackDetail): AppGrid<CallStackRow> {
  const grid = el.shadowRoot?.querySelector('lv-app-grid');
  if (!grid) {
    throw new Error('No grid');
  }
  return grid as AppGrid<CallStackRow>;
}

function fire(el: CallStackDetail, type: string, detail: object): void {
  gridOf(el).dispatchEvent(new CustomEvent(type, { detail, bubbles: true }));
}

/** Every event of `type` the component raises while `run` runs. */
function collect<T>(type: string, read: (e: Event) => T, run: () => void): T[] {
  const seen: T[] = [];
  const listener = (e: Event) => seen.push(read(e));
  document.addEventListener(type, listener);
  run();
  document.removeEventListener(type, listener);
  return seen;
}

function footer(grid: AppGrid<CallStackRow>, id: string): number | undefined {
  const calc = grid.columns.find((column) => column.id === id)?.calc;
  return runCalc(calc, grid.source?.roots ?? []);
}

const revealed = (e: Event) => (e as InspectorRevealEvent).detail.eventIndex;
const located = (e: Event) => (e as InspectorLocateEvent).detail.eventIndexes;

describe('CallStackDetail', () => {
  afterEach(() => {
    document.body.replaceChildren();
    built.length = 0;
    jest.restoreAllMocks();
  });

  it('shows the stack as Frame, Total and Self, with the root frame as the whole', async () => {
    const el = await mount(9);
    const grid = gridOf(el);

    expect(grid.source?.roots.map((row) => row.eventIndex)).toEqual([1, 4, 9]);
    expect(grid.columns.map((column) => column.title)).toEqual([
      'Frame',
      'Total (ms)',
      'Self (ms)',
    ]);
    expect(grid.placeholder).toBe('No call stack available');
    // The outermost frame's total is the stack root; a sum would count the nested chain twice.
    expect(footer(grid, 'duration.total')).toBe(100);
    expect(footer(grid, 'duration.self')).toBe(100);
  });

  it('asks the inspector to reveal the frame the selection landed on', async () => {
    const el = await mount(9);
    const row = gridOf(el).source!.roots[1];

    expect(
      collect(INSPECTOR_REVEAL_EVENT, revealed, () =>
        fire(el, 'lv-grid-select', { row, target: 4 }),
      ),
    ).toEqual([4]);
  });

  it('marks the active frame without calling it a pick, and moves the mark without a rebuild', async () => {
    const el = await mount(9);
    const grid = gridOf(el);
    const goTo = jest.spyOn(grid, 'goTo').mockImplementation(async ([key]) => {
      fire(el, 'lv-grid-select', {
        row: grid.source!.roots.find((r) => r.eventIndex === key),
        target: key,
      });
      return true;
    });
    built.length = 0;

    const reveals: number[] = [];
    const listener = (e: Event) => reveals.push(revealed(e));
    document.addEventListener(INSPECTOR_REVEAL_EVENT, listener);
    el.activeEventIndex = 4;
    await el.updateComplete;
    await grid.updateComplete;
    await Promise.resolve();
    document.removeEventListener(INSPECTOR_REVEAL_EVENT, listener);

    expect(goTo).toHaveBeenCalledWith([4], { scrollIfVisible: false });
    expect(reveals).toEqual([]);
    expect(built).toEqual([]);
  });

  it('marks the active frame again when a click clears its row', async () => {
    const el = await mount(9);
    const goTo = jest.spyOn(gridOf(el), 'goTo').mockResolvedValue(true);
    el.activeEventIndex = 4;
    await el.updateComplete;
    // The mark's select must settle, or its guard hides the click.
    await new Promise((resolve) => setTimeout(resolve));
    goTo.mockClear();

    fire(el, 'lv-grid-select', { row: null, target: null });
    await Promise.resolve();

    expect(goTo).toHaveBeenCalledWith([4], { scrollIfVisible: false });
  });

  it('locates the hovered frame, and drops the mark when the pointer leaves', async () => {
    const el = await mount(9);
    const row = gridOf(el).source!.roots[2];

    const seen = collect(INSPECTOR_LOCATE_EVENT, located, () => {
      fire(el, 'lv-grid-locate', { row });
      fire(el, 'lv-grid-locate', { row: null });
    });

    expect(seen).toEqual([[9], []]);
  });

  it('marks the frames under the pointer in the tab on screen', async () => {
    const el = await mount(9);

    eventBus.emit('detail:locate', { source: 'calltree', eventIndexes: [4] });
    await el.updateComplete;

    expect([...gridOf(el).marked]).toEqual([4]);
  });

  it('runs the row menu against the frame it was opened on', async () => {
    const el = await mount(9);
    const menu = el.shadowRoot!.querySelector<ContextMenu>('context-menu')!;
    const show = jest.spyOn(menu, 'show').mockImplementation(() => {});
    const event = new MouseEvent('contextmenu', { clientX: 3, clientY: 7, cancelable: true });

    fire(el, 'lv-grid-context', { row: gridOf(el).source!.roots[1], event });
    menu.dispatchEvent(new CustomEvent('menu-select', { detail: { itemId: 'copy-name' } }));

    expect(show).toHaveBeenCalledWith(expect.any(Array), 3, 7);
    expect(event.defaultPrevented).toBe(true);
    expect(runPanelRowAction).toHaveBeenCalledWith('copy-name', 4);
  });

  it('builds new rows for a new anchor, dropping the mark the old rows held', async () => {
    const el = await mount(9);
    const source = gridOf(el).source;
    const seen: Array<readonly number[]> = [];
    const listener = (e: Event) => seen.push(located(e));
    document.addEventListener(INSPECTOR_LOCATE_EVENT, listener);

    el.eventIndex = 4;
    await el.updateComplete;
    document.removeEventListener(INSPECTOR_LOCATE_EVENT, listener);

    expect(seen).toEqual([[]]);
    expect(gridOf(el).source).not.toBe(source);
  });
});
