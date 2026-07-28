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
jest.mock('tabulator-tables', () => ({
  Tabulator: class {
    static registerModule() {}
    constructor(_el: HTMLElement, options: Record<string, unknown>) {
      built.push(options);
    }
    on() {}
    destroy() {}
    getSelectedRows() {
      return [];
    }
  },
  Module: class {},
}));

// No DatabaseAccess in the test, so the stack is empty.
jest.mock('../callStackData.js', () => ({
  buildCallStackData: () => ({ rows: [], rootTotal: 0 }),
}));

import type { CallStackDetail } from '../CallStackDetail.js';
import '../CallStackDetail.js';

async function mount(eventIndex: number): Promise<CallStackDetail> {
  const el = document.createElement('call-stack-detail') as CallStackDetail;
  el.eventIndex = eventIndex;
  document.body.appendChild(el);
  await el.updateComplete;
  // Under @swc/jest the `@property` field initializer shadows Lit's reactive
  // accessor, so the assignment above never reaches `changedProperties` and the
  // table is never built. Nudge the update the way the browser would.
  el.requestUpdate('eventIndex', undefined);
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
});
