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
// Avoid the heavy Call Tree tab import (only goToRow is used here).
jest.mock('../../features/call-tree/components/CalltreeView.js', () => ({ goToRow: () => {} }));

import type { CallTreeDetail } from '../CallTreeDetail.js';
import '../CallTreeDetail.js';

function hidden(el: CallTreeDetail, id: string): boolean {
  return !!el.shadowRoot?.querySelector(`#${id}`)?.classList.contains('is-hidden');
}

async function mount(): Promise<CallTreeDetail> {
  const el = document.createElement('call-tree-detail') as CallTreeDetail;
  el.eventIndex = -1; // no DatabaseAccess in the test — no table is built
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

describe('CallTreeDetail view mode', () => {
  it('shows the active mode host and switches on view-mode-change', async () => {
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
