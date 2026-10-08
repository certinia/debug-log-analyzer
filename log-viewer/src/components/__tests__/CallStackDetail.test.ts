/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { describe, expect, it } from '@jest/globals';

// Capture the options the component hands to Tabulator. The real ESM build (and
// its module registrations) doesn't load under jest.
const built: Record<string, unknown>[] = [];
const selected: number[][] = [];
type TableHandler = (...args: unknown[]) => void;
const handlers: Record<string, TableHandler> = {};
let destroyed = 0;
jest.mock('tabulator-tables', () => ({
  Tabulator: class {
    static registerModule() {}
    constructor(_el: HTMLElement, options: Record<string, unknown>) {
      built.push(options);
    }
    on(event: string, handler: TableHandler) {
      handlers[event] = handler;
    }
    destroy() {
      destroyed++;
    }
    getSelectedRows() {
      return [];
    }
    selectRow(indexes: number[]) {
      selected.push(indexes);
    }
  },
  Module: class {},
  Renderer: class {},
}));

// No log store in the test, so the stack is empty.
jest.mock('../callStackData.js', () => ({
  buildCallStackData: () => ({ rows: [], rootTotal: 0 }),
}));

import type { CallStackDetail } from '../CallStackDetail.js';
import '../CallStackDetail.js';
import {
  INSPECTOR_LOCATE_EVENT,
  INSPECTOR_REVEAL_EVENT,
  type InspectorLocateEvent,
  type InspectorRevealEvent,
} from '../inspectorReveal.js';

async function mount(eventIndex: number): Promise<CallStackDetail> {
  const el = document.createElement('call-stack-detail') as CallStackDetail;
  el.eventIndex = eventIndex;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

describe('CallStackDetail', () => {
  it('renders the table host and a context menu for the row actions', async () => {
    const el = await mount(1);
    expect(el.shadowRoot?.querySelector('#call-stack-table')).not.toBeNull();
    expect(el.shadowRoot?.querySelector('context-menu')).not.toBeNull();
  });

  it('copies to the clipboard and navigates by keyboard, as the main grids do', async () => {
    built.length = 0;
    await mount(2);

    const options = built.at(-1);
    expect(options?.clipboard).toBe(true);
    expect(options?.clipboardCopyRowRange).toBe('all');
    // Ctrl/Cmd+C, so the keyboard shortcut matches every other grid.
    expect(options?.keybindings).toEqual({ copyToClipboard: ['ctrl + 67', 'meta + 67'] });
    // A single row stays selected, so the inspector follows keyboard navigation.
    expect(options?.selectableRows).toBe('highlight');
    expect(options?.rowKeyboardNavigation).toBe(true);
  });

  it('asks the inspector to reveal the frame the selection landed on', async () => {
    const el = await mount(4);

    const seen: number[] = [];
    document.addEventListener(INSPECTOR_REVEAL_EVENT, (e) => {
      seen.push((e as InspectorRevealEvent).detail.eventIndex);
    });
    handlers.rowSelectionChanged?.([], [{ getData: () => ({ eventIndex: 11 }) }]);

    expect(seen).toEqual([11]);
    el.remove();
  });

  it('marks the active frame once the table is built, without calling it a pick', async () => {
    const el = await mount(4);
    el.activeEventIndex = 4;
    await el.updateComplete;
    // The rows arrive with `tableBuilt`, so the mark made before it is the one
    // under test here.
    selected.length = 0;

    const seen: number[] = [];
    const listener = (e: Event) => seen.push((e as InspectorRevealEvent).detail.eventIndex);
    document.addEventListener(INSPECTOR_REVEAL_EVENT, listener);
    handlers.tableBuilt?.();
    document.removeEventListener(INSPECTOR_REVEAL_EVENT, listener);

    expect(selected).toEqual([[4]]);
    expect(seen).toEqual([]);
    el.remove();
  });

  it('locates the hovered frame, and drops the mark when the pointer leaves', async () => {
    const el = await mount(4);
    selected.length = 0;

    const seen: Array<readonly number[]> = [];
    const located = (e: Event) => seen.push((e as InspectorLocateEvent).detail.eventIndexes);
    const picked: number[] = [];
    const revealed = (e: Event) => picked.push((e as InspectorRevealEvent).detail.eventIndex);
    document.addEventListener(INSPECTOR_LOCATE_EVENT, located);
    document.addEventListener(INSPECTOR_REVEAL_EVENT, revealed);

    handlers.rowMouseEnter?.({}, { getData: () => ({ eventIndex: 9 }) });
    handlers.rowMouseLeave?.({}, { getData: () => ({ eventIndex: 9 }) });

    document.removeEventListener(INSPECTOR_LOCATE_EVENT, located);
    document.removeEventListener(INSPECTOR_REVEAL_EVENT, revealed);

    expect(seen).toEqual([[9], []]);
    // Hovering never picks a frame.
    expect(picked).toEqual([]);
    expect(selected).toEqual([]);
    el.remove();
  });

  it('moves the mark without rebuilding, since the anchor holds the rows', async () => {
    const el = await mount(4);
    handlers.tableBuilt?.();
    built.length = 0;
    selected.length = 0;

    el.activeEventIndex = 12;
    await el.updateComplete;

    expect(selected).toEqual([[12]]);
    expect(built).toEqual([]);
    el.remove();
  });

  it('keeps the generics in a frame the hover has to show', async () => {
    built.length = 0;
    await mount(5);

    const columns = built.at(-1)?.columns as { field?: string; tooltip?: unknown }[];
    const tooltip = columns.find((column) => column.field === 'text')?.tooltip;
    if (typeof tooltip !== 'function') {
      throw new Error('Frame column has no tooltip');
    }

    const signature = 'ContactTriggerHandler.handleAfterUpdate(List<Contact>, Map<Id,Contact>)';
    const cell = { getValue: () => signature };
    // An element, not a string: Tabulator writes a string tooltip with `innerHTML`.
    const shown = tooltip({}, cell, () => {}) as HTMLElement;

    expect(shown.textContent).toBe(signature);
  });

  it('keeps the table through a move', async () => {
    const el = await mount(5);
    const tables = built.length;
    destroyed = 0;

    document.body.append(document.createElement('div'), el);
    await Promise.resolve();
    await el.updateComplete;

    expect([built.length, destroyed]).toEqual([tables, 0]);
    document.body.replaceChildren();
  });

  it('rebuilds the table after a detach and a re-attach', async () => {
    const el = await mount(5);
    const tables = built.length;
    destroyed = 0;

    el.remove();
    await Promise.resolve();
    expect(destroyed).toBe(1);

    document.body.append(el);
    await el.updateComplete;

    expect(built.length).toBe(tables + 1);
    el.remove();
  });
});
