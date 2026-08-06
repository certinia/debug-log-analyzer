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
  Renderer: class {},
}));
// vscode-button needs ElementInternals.setFormValue (absent in jsdom).
jest.mock('#vscode-elements/vscode-button.js', () => ({}));

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

function switchEl(el: CallTreeDetail): Element {
  const found = el.shadowRoot?.querySelector('view-mode-switch');
  if (!found) {
    throw new Error('view-mode-switch not rendered');
  }
  return found;
}

async function mount(): Promise<CallTreeDetail> {
  const el = document.createElement('call-tree-detail') as CallTreeDetail;
  el.eventIndex = -1; // no DatabaseAccess in the test — no table is built
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

// The picked mode is module state, so these run in order: default, pick, share.
describe('CallTreeDetail view mode', () => {
  it('starts on time order', async () => {
    expect(customElements.get('call-tree-detail')).toBeDefined();
    const el = await mount();

    expect(switchEl(el).getAttribute('value')).toBe('time-order');
    expect(hidden(el, 'time-order-tree')).toBe(false);
    expect(hidden(el, 'bottom-up-tree')).toBe(true);
  });

  it('switches on view-mode-change', async () => {
    const el = await mount();

    switchEl(el).dispatchEvent(
      new CustomEvent('view-mode-change', {
        detail: { value: 'aggregated' },
        bubbles: true,
        composed: true,
      }),
    );
    await el.updateComplete;

    expect(switchEl(el).getAttribute('value')).toBe('aggregated');
    expect(hidden(el, 'aggregated-tree')).toBe(false);
    expect(hidden(el, 'time-order-tree')).toBe(true);
  });

  it('shares the picked mode with a pane mounted later', async () => {
    // The pane is torn down and rebuilt on every collapse and tab hop, so a
    // pick has to outlive the element — but only for this log, not the next.
    const el = await mount();

    expect(switchEl(el).getAttribute('value')).toBe('aggregated');
    expect(hidden(el, 'aggregated-tree')).toBe(false);
  });
});
