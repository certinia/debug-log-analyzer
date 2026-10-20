/**
 * @jest-environment jsdom
 */

/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

import { describe, expect, it, jest } from '@jest/globals';
import { ApexLogTimeline } from '../optimised/ApexLogTimeline.js';

function timeline(total: number) {
  const chart = new ApexLogTimeline();
  const internals = chart as unknown as Record<string, unknown>;
  const cursor = { total, first: jest.fn() };
  const flamechart = { search: jest.fn(() => cursor), clearSelection: jest.fn() };
  internals['flamechart'] = flamechart;
  const container = document.createElement('div');
  Object.defineProperty(container, 'clientHeight', { value: 100 });
  document.body.appendChild(container);
  internals['container'] = container;
  const find = internals['handleFind'] as (event: Event) => void;
  const positions: number[] = [];
  document.addEventListener('lv-find-results', (e) =>
    positions.push((e as CustomEvent<{ currentMatch: number }>).detail.currentMatch),
  );
  return {
    find: (count: number) =>
      find.call(
        chart,
        new CustomEvent('lv-find', { detail: { text: 'x', count, options: { matchCase: false } } }),
      ),
    cursor,
    flamechart,
    positions,
  };
}

describe('a timeline find', () => {
  it('moves to the first match when asked to start there', () => {
    const chart = timeline(2);
    chart.find(1);

    expect(chart.cursor.first).toHaveBeenCalled();
    expect(chart.positions).toEqual([1]);
  });

  it('searches without moving, and clears a selected frame so the marks show', () => {
    const chart = timeline(2);
    chart.find(0);

    expect(chart.cursor.first).not.toHaveBeenCalled();
    expect(chart.flamechart.clearSelection).toHaveBeenCalled();
    expect(chart.positions).toEqual([1]);
  });
});
