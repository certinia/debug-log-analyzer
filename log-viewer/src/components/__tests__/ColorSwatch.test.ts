/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { describe, expect, it } from '@jest/globals';

import type { ColorSwatch } from '../ColorSwatch.js';
import '../ColorSwatch.js';

async function mount(props: Partial<Pick<ColorSwatch, 'color' | 'label'>> = {}) {
  const element = document.createElement('color-swatch');
  Object.assign(element, props);
  document.body.appendChild(element);
  await element.updateComplete;
  return element;
}

describe('ColorSwatch', () => {
  it('paints itself in the colour it is given', async () => {
    const element = await mount({ color: '#88ae58' });

    expect(element.style.background).toBe('rgb(136, 174, 88)');
  });

  it('leaves the row hue to answer when it has no colour of its own', async () => {
    const element = await mount();

    expect(element.style.background).toBe('');
  });

  it('drops back to the row hue when the colour is taken away', async () => {
    const element = await mount({ color: '#88ae58' });

    element.color = '';
    await element.updateComplete;

    expect(element.style.background).toBe('');
  });

  it('names what the colour stands for on hover', async () => {
    const element = await mount({ color: '#88ae58', label: 'Apex' });

    expect(element.title).toBe('Apex');
  });

  // The hue repeats something the row already says in text.
  it('stays hidden from a screen reader', async () => {
    const element = await mount({ color: '#88ae58' });

    expect(element.getAttribute('aria-hidden')).toBe('true');
  });
});
