/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { describe, expect, it } from '@jest/globals';

// This suite exercises the view-mode toggle; no tree is built (eventIndex -1).

import type { LogStore } from '#core/log/LogStore.js';
import type { CallTreeDetail } from '../CallTreeDetail.js';
import '../CallTreeDetail.js';

const MODES = ['time-order', 'aggregated', 'bottom-up'];

// One grid per mode, in the switch's order.
function hidden(el: CallTreeDetail, mode: string): boolean {
  const grids = el.shadowRoot?.querySelectorAll('lv-app-grid');
  return !!grids?.[MODES.indexOf(mode)]?.classList.contains('is-hidden');
}

function switchEl(el: CallTreeDetail): Element {
  const found = el.shadowRoot?.querySelector('view-mode-switch');
  if (!found) {
    throw new Error('view-mode-switch not rendered');
  }
  return found;
}

/** Two logs, so a pick can be shown to belong to the one it was made in. */
const thisLog = {} as LogStore;
const nextLog = {} as LogStore;

async function mount(props: Partial<CallTreeDetail> = {}): Promise<CallTreeDetail> {
  const el = document.createElement('call-tree-detail') as CallTreeDetail;
  el.eventIndex = -1; // no selection in the test — no table is built
  el.logStore = thisLog;
  Object.assign(el, props);
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

async function pick(el: CallTreeDetail, value: string): Promise<void> {
  switchEl(el).dispatchEvent(
    new CustomEvent('view-mode-change', { detail: { value }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}

// A pick outlives the element, so these run in order: default, pick, share.
describe('CallTreeDetail view mode', () => {
  it('starts on time order', async () => {
    expect(customElements.get('call-tree-detail')).toBeDefined();
    const el = await mount();

    expect(switchEl(el).getAttribute('value')).toBe('time-order');
    expect(hidden(el, 'time-order')).toBe(false);
    expect(hidden(el, 'bottom-up')).toBe(true);
  });

  it('switches on view-mode-change', async () => {
    const el = await mount();

    await pick(el, 'aggregated');

    expect(switchEl(el).getAttribute('value')).toBe('aggregated');
    expect(hidden(el, 'aggregated')).toBe(false);
    expect(hidden(el, 'time-order')).toBe(true);
  });

  it('shares the picked mode with a pane mounted later', async () => {
    // The pane is torn down and rebuilt on every collapse and tab hop, so a
    // pick has to outlive the element.
    const el = await mount();

    expect(switchEl(el).getAttribute('value')).toBe('aggregated');
    expect(hidden(el, 'aggregated')).toBe(false);
  });

  it('leaves a pick behind with the log it was made in', async () => {
    const el = await mount({ logStore: nextLog });

    expect(switchEl(el).getAttribute('value')).toBe('time-order');
  });

  it('opens on the mode the rule gives the tab it came from', async () => {
    // The tab shows what called what, top down, so the inspector answers where
    // the time went instead. The rule itself is covered in callTreeViewModes.
    const el = await mount({ source: 'calltree', sourceView: 'callees' });

    expect(switchEl(el).getAttribute('value')).toBe('bottom-up');
  });

  it('keeps a pick in one tab out of another tab', async () => {
    await pick(await mount({ source: 'timeline', sourceView: 'callees' }), 'aggregated');

    // Rebuilt for that tab, the pick wins over the default it would open on.
    const timeline = await mount({ source: 'timeline', sourceView: 'callees' });
    expect(switchEl(timeline).getAttribute('value')).toBe('aggregated');

    // Another tab never sees it, so it opens on its own default.
    const database = await mount({ source: 'database', sourceView: 'callees' });
    expect(switchEl(database).getAttribute('value')).toBe('bottom-up');
  });
});
