/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { beforeEach, describe, expect, it } from '@jest/globals';
import type { LitElement } from 'lit';

import { eventBus } from '../../core/events/EventBus.js';
import type { LogStore } from '../../core/log/LogStore.js';
import type { TrendSeries } from '../governorTrendData.js';

// The charts are driven from one stub series, so the seek is the only logic
// under test. `pointAt` stays real: the click reads the series through it.
let series: TrendSeries[];
jest.mock('../governorTrendData.js', () => ({
  ...jest.requireActual('../governorTrendData.js'),
  governorTrendSeries: () => series,
}));
jest.mock('../../features/timeline/optimised/apex-limit-series.js', () => ({
  apexLimitTimeSeries: () => ({ events: [] }),
}));

import '../GovernorTrends.js';

const LOG_NS = 1_000;

const trend = (): TrendSeries => ({
  label: 'SOQL queries',
  points: [
    { t: 0, ratio: 0, used: 0 },
    { t: 400, ratio: 40, used: 40 },
    { t: 800, ratio: 90, used: 90 },
  ],
  used: 90,
  limit: 100,
  finalRatio: 90,
  format: String,
});

async function mount(): Promise<LitElement> {
  const element = document.createElement('governor-trends');
  // No provider in the test, so the consumed store is assigned straight on.
  (element as unknown as { logStore: LogStore }).logStore = {
    log: { duration: { total: LOG_NS } },
  } as unknown as LogStore;
  document.body.append(element);
  await element.updateComplete;
  return element;
}

/** The chart, given a width so a pointer x maps to a time. */
function chartOf(element: LitElement): HTMLButtonElement {
  const chart = element.shadowRoot!.querySelector('.trend__chart') as HTMLButtonElement;
  chart.getBoundingClientRect = () => ({ left: 0, width: 100, top: 0, height: 44 }) as DOMRect;
  return chart;
}

let seeks: { timestamp?: number; mode?: string }[];
let unsubscribe: () => void;

beforeEach(() => {
  document.body.replaceChildren();
  series = [trend()];
  seeks = [];
  unsubscribe?.();
  unsubscribe = eventBus.on('timeline:navigate-to', (detail) => {
    seeks.push({ timestamp: detail.timestamp, mode: detail.mode });
  });
});

describe('governor-trends', () => {
  it('moves the timeline to the instant clicked on a chart', async () => {
    const element = await mount();

    chartOf(element).dispatchEvent(new MouseEvent('click', { clientX: 60 }));

    expect(seeks).toEqual([{ timestamp: 600, mode: 'seek' }]);
  });

  it('reads the sample under the pointer without moving the timeline', async () => {
    const element = await mount();
    const chart = chartOf(element);

    chart.dispatchEvent(new MouseEvent('pointermove', { clientX: 40 }));
    await element.updateComplete;

    expect(element.shadowRoot?.querySelector('.trend__value')?.textContent).toContain('40');
    expect(element.shadowRoot?.querySelector('.trend__cursor')).not.toBeNull();
    expect(seeks).toEqual([]);
  });

  it('steps the cursor with the arrow keys and seeks it with Enter', async () => {
    const element = await mount();
    const chart = chartOf(element);

    chart.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    chart.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    chart.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

    // Two steps of a seek window (2%) across a 1,000ns log.
    expect(seeks).toEqual([{ timestamp: 40, mode: 'seek' }]);
  });

  it('keeps an arrow-key cursor when the pointer leaves the chart', async () => {
    const element = await mount();
    const chart = chartOf(element);

    chart.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    chart.dispatchEvent(new MouseEvent('pointerleave'));
    chart.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

    expect(seeks).toEqual([{ timestamp: 20, mode: 'seek' }]);
  });

  it('holds the cursor inside the log at either end', async () => {
    const element = await mount();
    const chart = chartOf(element);

    chart.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    chart.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));

    expect(seeks).toEqual([{ timestamp: 0, mode: 'seek' }]);
  });

  it('seeks the last sample when no cursor has been placed', async () => {
    const element = await mount();

    chartOf(element).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

    expect(seeks).toEqual([{ timestamp: 800, mode: 'seek' }]);
  });

  // A button, so the focus ring only shows for keyboard focus, never a click.
  it('gives every chart keyboard reach', async () => {
    const element = await mount();

    expect(chartOf(element).tagName).toBe('BUTTON');
  });
});
