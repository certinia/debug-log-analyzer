/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { render } from 'lit';

import { bar, type BarOptions } from '../cells.js';

function draw(value: number, total: number, options?: BarOptions) {
  const host = document.createElement('div');
  render(bar(value, total, options), host);
  const cell = host.firstElementChild;
  return {
    text: cell?.textContent,
    found: cell?.querySelector('[data-grid-find-text]')?.textContent,
    bar: cell?.getAttribute('style'),
  };
}

describe('bar', () => {
  it('shows the value and its share, and find marks only the value', () => {
    expect(draw(25, 200)).toEqual({
      text: '25.00(13.00%)',
      found: '25.00',
      bar: 'background-size: 12.5% 100%',
    });
  });

  it('draws a hairline for a share that rounds to nothing', () => {
    expect(draw(1, 100_000)).toEqual({
      text: '1.00(0.00%)',
      found: '1.00',
      bar: 'background-size: 1% 100%',
    });
  });

  it('draws no bar for a zero value or a zero total', () => {
    expect([draw(0, 100).bar, draw(5, 0).bar]).toEqual([
      'background-size: 0% 100%',
      'background-size: 0% 100%',
    ]);
  });

  it('shows a whole count with no share when asked', () => {
    expect(draw(300, 1200, { precision: 0, percent: false })).toEqual({
      text: '300',
      found: '300',
      bar: 'background-size: 25% 100%',
    });
  });
});
