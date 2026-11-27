/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { afterEach, describe, expect, it } from '@jest/globals';

import type { DatagridFacetFilter } from '../datagrid-facet-filter.js';
import '../datagrid-facet-filter.js';

async function mount(slot?: string): Promise<DatagridFacetFilter> {
  const el = document.createElement('datagrid-facet-filter') as DatagridFacetFilter;
  el.label = 'Namespace';
  el.values = ['ns1', 'ns2', 'ns3'];
  if (slot) {
    el.setAttribute('slot', slot);
  }
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

function boxes(el: DatagridFacetFilter): HTMLInputElement[] {
  return [...(el.shadowRoot?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]') ?? [])];
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('datagrid-facet-filter', () => {
  it('ticks the values its host sets, clears when set to none, and reports no change for either', async () => {
    const el = await mount();
    const changes: unknown[] = [];
    el.addEventListener('datagrid-facet-change', (e) => changes.push(e));

    el.selected = ['ns2'];
    await el.updateComplete;
    expect(boxes(el).map((box) => box.checked)).toEqual([false, true, false]);

    el.selected = [];
    await el.updateComplete;
    expect(boxes(el).map((box) => box.checked)).toEqual([false, false, false]);
    expect(changes).toEqual([]);
  });

  it('keeps its value checklist inside a popover when moved into the overflow panel', async () => {
    const el = await mount('overflow');

    expect(boxes(el)).toHaveLength(3);
    // Inline in the panel, a long namespace list would push every other filter off screen.
    expect(boxes(el).every((box) => box.closest('[popover]'))).toBe(true);
  });

  it('keeps the chosen values when it moves into the overflow panel and back', async () => {
    const el = await mount();
    const first = boxes(el)[0];
    first?.click();
    await el.updateComplete;

    el.setAttribute('slot', 'overflow');
    await el.updateComplete;
    expect(boxes(el)[0]?.checked).toBe(true);

    el.removeAttribute('slot');
    await el.updateComplete;
    expect(boxes(el)[0]?.checked).toBe(true);
  });
});
