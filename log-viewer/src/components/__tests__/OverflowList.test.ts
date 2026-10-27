/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { afterEach, describe, expect, it } from '@jest/globals';
import type { LitElement } from 'lit';

import '../OverflowList.js';

/** jsdom lays nothing out, so the list's width is stubbed and the end child states its own. */
async function mount(width: number): Promise<LitElement> {
  const list = document.createElement('overflow-list') as LitElement;
  Object.defineProperty(list, 'clientWidth', { value: width });
  list.innerHTML =
    '<button>Details</button><button>Debug Only</button>' +
    '<span slot="end" collapse-last style="min-width: 80px">Hidden by filters · Clear</span>';
  document.body.append(list);
  await list.updateComplete;
  await list.updateComplete;
  return list;
}

const slots = (list: LitElement) => [...list.children].map((el) => el.getAttribute('slot'));

describe('overflow-list collapse-last child', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  // The note sat on top of the toolbar's buttons once the toggle and it no longer fit.
  it('moves into the menu, with every item, once the toggle and its min-width do not fit', async () => {
    const list = await mount(100);

    expect(slots(list)).toEqual(['overflow', 'overflow', 'overflow']);
    expect(list.shadowRoot?.querySelector('.overflow__count')?.textContent).toBe('+3');
  });

  it('stays after the toggle while it fits', async () => {
    const list = await mount(400);

    expect(slots(list).at(-1)).toBe('end');
  });
});
