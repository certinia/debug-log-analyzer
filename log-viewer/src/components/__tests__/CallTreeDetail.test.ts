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
// this suite exercises the view-mode toggle and the column set; no table is
// built (eventIndex -1).
jest.mock('tabulator-tables', () => ({
  Tabulator: class {
    static registerModule() {}
  },
  Module: class {},
  Renderer: class {},
}));

import type { CellComponent } from 'tabulator-tables';

import type { LogStore } from '../../core/log/LogStore.js';
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

/** The Name column's tooltip, read off the column set the component builds. */
function nameTooltip(
  el: CallTreeDetail,
  row: { originalData?: { text: string; type: string } },
  value: string,
): string {
  const name = el['_columns']('time-order', 100).find((column) => column.field === 'text');
  const tooltip = name?.tooltip;
  if (typeof tooltip !== 'function') {
    throw new Error('Name column has no tooltip');
  }
  const cell = { getData: () => row, getValue: () => value } as unknown as CellComponent;
  // An element, not a string: Tabulator writes a string tooltip with `innerHTML`.
  return (tooltip({} as MouseEvent, cell, () => {}) as HTMLElement).textContent ?? '';
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
    expect(hidden(el, 'time-order-tree')).toBe(false);
    expect(hidden(el, 'bottom-up-tree')).toBe(true);
  });

  it('switches on view-mode-change', async () => {
    const el = await mount();

    await pick(el, 'aggregated');

    expect(switchEl(el).getAttribute('value')).toBe('aggregated');
    expect(hidden(el, 'aggregated-tree')).toBe(false);
    expect(hidden(el, 'time-order-tree')).toBe(true);
  });

  it('shares the picked mode with a pane mounted later', async () => {
    // The pane is torn down and rebuilt on every collapse and tab hop, so a
    // pick has to outlive the element.
    const el = await mount();

    expect(switchEl(el).getAttribute('value')).toBe('aggregated');
    expect(hidden(el, 'aggregated-tree')).toBe(false);
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

  it('hovers a truncated name with the label the cell shows', async () => {
    const el = await mount();

    // `eventLabel` prefixes the type where the text cannot stand alone, which is
    // what the cell renders — the raw `text` field alone would say only "true".
    expect(
      nameTooltip(el, { originalData: { text: 'true', type: 'STATEMENT_EXECUTE' } }, 'true'),
    ).toBe('STATEMENT_EXECUTE: true');
  });

  it('keeps the generics in a signature the hover has to show', async () => {
    const el = await mount();

    const signature = 'ContactTriggerHandler.handleAfterUpdate(List<Contact>, Map<Id,Contact>)';
    expect(
      nameTooltip(el, { originalData: { text: signature, type: 'METHOD_ENTRY' } }, signature),
    ).toBe(signature);
  });

  it('falls back to the cell value where a row carries no frame', async () => {
    const el = await mount();

    expect(nameTooltip(el, {}, 'Total')).toBe('Total');
  });
});
