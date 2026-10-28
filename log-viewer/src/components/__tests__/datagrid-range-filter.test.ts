/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { afterEach, describe, expect, it } from '@jest/globals';

import type { DatagridRangeFilter } from '../datagrid-range-filter.js';
import '../datagrid-range-filter.js';

async function mount(): Promise<{ el: DatagridRangeFilter; changes: unknown[] }> {
  const el = document.createElement('datagrid-range-filter') as DatagridRangeFilter;
  el.label = 'Total Time';
  document.body.appendChild(el);
  await el.updateComplete;
  const changes: unknown[] = [];
  el.addEventListener('datagrid-range-change', (e) => changes.push((e as CustomEvent).detail));
  return { el, changes };
}

function inputs(el: DatagridRangeFilter): HTMLInputElement[] {
  return [...(el.shadowRoot?.querySelectorAll<HTMLInputElement>('.range-popover__input') ?? [])];
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('datagrid-range-filter range', () => {
  it('shows a range its host sets, and reports no change for it', async () => {
    const { el, changes } = await mount();

    el.range = { start: 2, end: null };
    await el.updateComplete;
    expect(inputs(el).map((input) => input.value)).toEqual(['2', '']);

    el.range = { start: null, end: null };
    await el.updateComplete;
    expect(inputs(el).map((input) => input.value)).toEqual(['', '']);
    expect(changes).toEqual([]);
  });

  it('keeps half-typed input when its host echoes the range it reported', async () => {
    const { el } = await mount();
    const [start] = inputs(el);
    start!.value = '1.50';
    start!.dispatchEvent(new Event('input'));
    start!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

    el.range = { start: 1.5, end: null };
    await el.updateComplete;

    expect(inputs(el)[0]!.value).toBe('1.50');
  });

  // Clear-and-go resets an unset range to unset, which is no change, so input still pending came back after it.
  it('reports pending input when focus leaves, so a later reset by its host clears it', async () => {
    const { el, changes } = await mount();
    const [start] = inputs(el);
    start!.value = '5';
    start!.dispatchEvent(new Event('input'));

    start!.dispatchEvent(new Event('blur'));
    expect(changes).toEqual([{ range: { start: 5, end: null } }]);

    el.range = { start: 5, end: null };
    await el.updateComplete;
    el.range = { start: null, end: null };
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(inputs(el)[0]!.value).toBe('');
    expect(changes).toHaveLength(1);
  });
});
