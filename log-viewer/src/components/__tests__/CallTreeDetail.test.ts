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

const settings = { inspector: { callTreeMode: 'bottom-up' } };
const written: Array<{ section: string; value: unknown }> = [];
jest.mock('../../features/settings/Settings.js', () => ({
  getSettings: () => Promise.resolve(settings),
  updateSetting: (section: string, value: unknown) => written.push({ section, value }),
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
  // The remembered mode arrives from a promise, so settle it then re-render.
  await el.updateComplete;
  await Promise.resolve();
  await el.updateComplete;
  return el;
}

// The remembered mode is module state loaded once, so the restore test must run
// before anything picks a mode of its own.
describe('CallTreeDetail view mode', () => {
  it('restores the remembered mode', async () => {
    expect(customElements.get('call-tree-detail')).toBeDefined();
    const el = await mount();

    expect(switchEl(el).getAttribute('value')).toBe('bottom-up');
    expect(hidden(el, 'bottom-up-tree')).toBe(false);
    expect(hidden(el, 'time-order-tree')).toBe(true);
  });

  it('switches on view-mode-change and persists the pick', async () => {
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
    expect(hidden(el, 'bottom-up-tree')).toBe(true);
    expect(written).toEqual([{ section: 'inspector.callTreeMode', value: 'aggregated' }]);
  });

  it('shares the picked mode with a pane mounted later', async () => {
    // The pane is torn down and rebuilt on every collapse and tab hop, so the
    // mode has to survive without another settings round-trip.
    const el = await mount();

    expect(switchEl(el).getAttribute('value')).toBe('aggregated');
    expect(hidden(el, 'aggregated-tree')).toBe(false);
  });
});
