/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { beforeEach, describe, expect, it } from '@jest/globals';

import '../StackedTimeBar.js';
import type { StackedSegment } from '../StackedTimeBar.js';

const SEGMENTS: StackedSegment[] = [
  { label: 'SOQL', timeNs: 200_000_000, color: 'red' },
  { label: 'DML', timeNs: 100_000_000, color: 'blue' },
];

async function mount(segments: StackedSegment[], total = 0, legend = false) {
  const element = document.createElement('stacked-time-bar');
  element.segments = segments;
  element.total = total;
  element.legend = legend;
  document.body.append(element);
  await element.updateComplete;
  return element;
}

const widths = (element: Element) =>
  [...(element.shadowRoot?.querySelectorAll('rect') ?? [])].map((rect) =>
    Number(rect.getAttribute('width')),
  );

describe('stacked-time-bar', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('renders nothing without a length to show', async () => {
    expect((await mount([])).shadowRoot?.querySelector('svg')).toBeNull();
  });

  it('splits itself when no total is set', async () => {
    expect(widths(await mount(SEGMENTS))).toEqual([66.667, 33.333]);
  });

  it('leaves the shortfall unfilled when the total is larger than the segments', async () => {
    // 300ms of a 1s log: the bar fills 30% and the rest of the log stays empty.
    expect(widths(await mount(SEGMENTS, 1_000_000_000))).toEqual([20, 10]);
  });

  it('ignores a total below the segments, since the sum is the only honest length', async () => {
    expect(widths(await mount(SEGMENTS, 1_000))).toEqual([66.667, 33.333]);
  });

  it('reads out the hovered segment against the total', async () => {
    const element = await mount(SEGMENTS, 1_000_000_000);
    element.shadowRoot?.querySelector('rect')?.dispatchEvent(new Event('pointerenter'));
    await element.updateComplete;

    const tip = element.shadowRoot?.querySelector('.tip')?.textContent?.replace(/\s+/g, ' ').trim();
    expect(tip).toContain('SOQL');
    expect(tip).toContain('20.0%');
    // The other segment recedes while one is singled out.
    expect(element.shadowRoot?.querySelectorAll('.bar__slice--dim')).toHaveLength(1);
  });

  it('follows the pointer along the bar', async () => {
    const element = await mount(SEGMENTS);
    const bar = element.shadowRoot?.querySelector('svg') as SVGElement;
    // jsdom lays nothing out, so the bar is given a width to measure against.
    bar.getBoundingClientRect = () => ({ left: 100, width: 200 }) as DOMRect;

    element.shadowRoot?.querySelector('rect')?.dispatchEvent(new Event('pointerenter'));
    // jsdom has no PointerEvent, and only clientX is read.
    bar.dispatchEvent(Object.assign(new Event('pointermove'), { clientX: 130 }));
    await element.updateComplete;

    // 30px into 200px: the tip sits at 15%, not the segment's 33% centre.
    expect(element.shadowRoot?.querySelector('.tip')?.getAttribute('style')).toContain(
      'left:15.0%',
    );
  });

  it('gives every segment its figures in the legend, and no tip', async () => {
    const element = await mount(SEGMENTS, 0, true);
    const items = [...(element.shadowRoot?.querySelectorAll('.legend__value') ?? [])].map(
      (item) => item.textContent ?? '',
    );

    expect(items).toHaveLength(2);
    expect(items[0]).toContain('66.7%');
    expect(items[1]).toContain('33.3%');

    element.shadowRoot?.querySelector('.legend__item')?.dispatchEvent(new Event('pointerenter'));
    await element.updateComplete;
    // A legend hover highlights, but the tip belongs to the bar.
    expect(element.shadowRoot?.querySelector('.legend__item--active')).not.toBeNull();
    expect(element.shadowRoot?.querySelector('.tip')).toBeNull();
  });

  it('reads out a detail from the legend, where the thinnest segments can be hit', async () => {
    const element = await mount(
      [{ ...SEGMENTS[0]!, detail: 'SOQL 200 ms' }, SEGMENTS[1]!],
      0,
      true,
    );

    element.shadowRoot?.querySelector('.legend__item')?.dispatchEvent(new Event('pointerenter'));
    await element.updateComplete;

    expect(element.shadowRoot?.querySelector('.tip')?.textContent).toContain('SOQL 200 ms');
  });
});
