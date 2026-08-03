/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { describe, expect, it } from '@jest/globals';

// The swc transform can't parse `.scss`; stub the stylesheet assets.
jest.mock('../../tabulator/style/DataGrid.scss', () => ({ default: '' }));
jest.mock('../../tabulator/format/Progress.css', () => ({}));

// Capture the options the component hands to Tabulator. The real ESM build (and
// its module registrations) doesn't load under jest.
const built: Record<string, unknown>[] = [];
type TableHandler = (...args: unknown[]) => void;
const handlers: Record<string, TableHandler> = {};
jest.mock('tabulator-tables', () => ({
  Tabulator: class {
    static registerModule() {}
    constructor(_el: HTMLElement, options: Record<string, unknown>) {
      built.push(options);
    }
    on(event: string, handler: TableHandler) {
      handlers[event] = handler;
    }
    destroy() {}
    getSelectedRows() {
      return [];
    }
  },
  Module: class {},
  Renderer: class {},
}));

// No DatabaseAccess in the test, so the stack is empty.
jest.mock('../callStackData.js', () => ({
  buildCallStackData: () => ({ rows: [], rootTotal: 0 }),
}));

import type { CallStackDetail } from '../CallStackDetail.js';
import '../CallStackDetail.js';
import { INSPECTOR_REVEAL_EVENT, type InspectorRevealEvent } from '../inspectorReveal.js';

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

  it('enables clipboard copy on the table, as the main grids do', async () => {
    built.length = 0;
    await mount(2);

    const options = built.at(-1);
    expect(options?.clipboard).toBe(true);
    expect(options?.clipboardCopyRowRange).toBe('all');
    // Ctrl/Cmd+C, so the keyboard shortcut matches every other grid.
    expect(options?.keybindings).toEqual({ copyToClipboard: ['ctrl + 67', 'meta + 67'] });
  });

  it('keeps a single row selected so the inspector follows keyboard navigation', async () => {
    built.length = 0;
    await mount(3);

    const options = built.at(-1);
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
});
