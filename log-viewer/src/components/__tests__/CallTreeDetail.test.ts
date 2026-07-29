/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { describe, expect, it } from '@jest/globals';

// The swc transform can't parse `.scss`/`.css`; stub the stylesheet assets.
jest.mock('../../tabulator/style/DataGrid.scss', () => ({ default: '' }));
jest.mock('../../tabulator/format/Progress.css', () => ({}));
// The tabulator ESM build (+ its module registrations) doesn't load under jest;
// this suite only exercises the view-mode toggle, no table is built (eventIndex -1).
jest.mock('tabulator-tables', () => ({
  Tabulator: class {
    static registerModule() {}
  },
  Module: class {},
}));
// vscode-button needs ElementInternals.setFormValue (absent in jsdom).
jest.mock('#vscode-elements/vscode-button.js', () => ({}));
// The view mode persists through the extension host, which isn't there.
jest.mock('../../features/settings/Settings.js', () => ({
  getSettings: () => Promise.resolve({}),
  updateSetting: () => {},
}));

import type { CallTreeDetail } from '../CallTreeDetail.js';
import '../CallTreeDetail.js';

// Tabulator mounts into the inner `#${id}` grid; the `is-hidden` visibility
// toggle lives on its `.table-host` wrapper (keeps Lit off the mount's class).
function hidden(el: CallTreeDetail, id: string): boolean {
  return !!el.shadowRoot
    ?.querySelector(`#${id}`)
    ?.closest('.table-host')
    ?.classList.contains('is-hidden');
}

async function mount(): Promise<CallTreeDetail> {
  const el = document.createElement('call-tree-detail') as CallTreeDetail;
  el.eventIndex = -1; // no DatabaseAccess in the test — no table is built
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

describe('CallTreeDetail view mode', () => {
  it('defaults to Time Order and switches on view-mode-change', async () => {
    expect(customElements.get('call-tree-detail')).toBeDefined();
    const el = await mount();
    const view = el.shadowRoot?.querySelector('view-mode-switch');

    expect(view?.getAttribute('value')).toBe('time-order');
    expect(hidden(el, 'time-order-tree')).toBe(false);
    expect(hidden(el, 'aggregated-tree')).toBe(true);

    view?.dispatchEvent(
      new CustomEvent('view-mode-change', {
        detail: { value: 'aggregated' },
        bubbles: true,
        composed: true,
      }),
    );
    await el.updateComplete;

    expect(el.shadowRoot?.querySelector('view-mode-switch')?.getAttribute('value')).toBe(
      'aggregated',
    );
    expect(hidden(el, 'aggregated-tree')).toBe(false);
    expect(hidden(el, 'time-order-tree')).toBe(true);
  });
});

describe('CallTreeDetail note', () => {
  it('says the times are relative to the selection and details are omitted', async () => {
    const el = await mount();
    const note = el.shadowRoot?.querySelector('.note')?.textContent;
    expect(note).toContain('relative to the selection');
    expect(note).toContain('Zero-duration rows are omitted');
    // Nothing was truncated (no table built), so no warning.
    expect(el.shadowRoot?.querySelector('.note .warn')).toBeNull();
  });
});
