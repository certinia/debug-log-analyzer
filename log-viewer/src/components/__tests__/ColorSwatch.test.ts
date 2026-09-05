/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { describe, expect, it } from '@jest/globals';

import type { ColorSwatch } from '../ColorSwatch.js';
import '../ColorSwatch.js';

async function mount(props: Partial<Pick<ColorSwatch, 'color'>> = {}) {
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

  it('repaints when the colour changes', async () => {
    const element = await mount({ color: '#88ae58' });

    element.color = '#6d4c7d';
    await element.updateComplete;

    expect(element.style.background).toBe('rgb(109, 76, 125)');
  });

  // The hue repeats something the row already says in text.
  it('stays hidden from a screen reader', async () => {
    const element = await mount({ color: '#88ae58' });

    expect(element.getAttribute('aria-hidden')).toBe('true');
  });
});
