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

const trend = (label = 'SOQL queries'): TrendSeries => ({
  label,
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

const aLog = () => ({ log: { duration: { total: LOG_NS } } }) as unknown as LogStore;

async function mount(): Promise<LitElement> {
  const element = document.createElement('governor-trends');
  // No provider in the test, so the consumed store is assigned straight on.
  (element as unknown as { logStore: LogStore }).logStore = aLog();
  document.body.append(element);
  await element.updateComplete;
  return element;
}

/** The chart, given a width so a pointer x maps to a time. */
function chartOf(element: LitElement, at = 0): HTMLButtonElement {
  const chart = element.shadowRoot!.querySelectorAll('.trend__chart')[at] as HTMLButtonElement;
  chart.getBoundingClientRect = () => ({ left: 0, width: 100, top: 0, height: 44 }) as DOMRect;
  return chart;
}

/** A key press on a chart. */
const press = (chart: HTMLButtonElement, key: string, init: KeyboardEventInit = {}) =>
  chart.dispatchEvent(new KeyboardEvent('keydown', { key, ...init }));

/** A pointer over a chart, at an x the chart's width maps to a time. */
const hover = (chart: HTMLButtonElement, clientX: number) =>
  chart.dispatchEvent(new MouseEvent('pointermove', { clientX }));

/** A click. `detail` is 1 for a real pointer and 0 where there are no
 *  coordinates: assistive tech, or `click()`. */
const click = (chart: HTMLButtonElement, clientX: number, detail = 1) =>
  chart.dispatchEvent(new MouseEvent('click', { clientX, detail }));

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

    click(chartOf(element), 60);

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

  it('reads the cursor when a click carries no coordinates', async () => {
    const element = await mount();
    const chart = chartOf(element);

    press(chart, 'ArrowRight');
    click(chart, 0, 0);

    expect(seeks).toEqual([{ timestamp: 20, mode: 'seek' }]);
  });

  it('answers the last sample when a click carries neither coordinates nor a cursor', async () => {
    const element = await mount();

    click(chartOf(element), 0, 0);

    // x 0 is the log's start, which is never where a limit stands highest.
    expect(seeks).toEqual([{ timestamp: 800, mode: 'seek' }]);
  });

  it('holds a stepped cursor against a pointer on another chart', async () => {
    series = [trend(), trend('DML statements')];
    const element = await mount();
    const [first, second] = [chartOf(element), chartOf(element, 1)];

    press(first, 'ArrowRight');
    // The pointer rests on the second chart: its hover is not this chart's cursor.
    hover(second, 40);
    press(first, 'Enter');

    expect(seeks).toEqual([{ timestamp: 20, mode: 'seek' }]);

    // And losing that hover leaves the stepped cursor where it was.
    second.dispatchEvent(new MouseEvent('pointerleave'));
    press(first, 'Enter');

    expect(seeks).toEqual([
      { timestamp: 20, mode: 'seek' },
      { timestamp: 20, mode: 'seek' },
    ]);
  });

  it('keeps stepping while the pointer rests on the chart', async () => {
    const element = await mount();
    const chart = chartOf(element);

    hover(chart, 40);
    press(chart, 'ArrowRight');
    press(chart, 'ArrowRight');
    press(chart, 'Enter');

    // Two steps on from the hover, not the hover answered twice.
    expect(seeks).toEqual([{ timestamp: 440, mode: 'seek' }]);
  });

  it('leaves one chart reading at a time after a click', async () => {
    series = [trend(), trend('DML statements')];
    const element = await mount();
    const [first, second] = [chartOf(element), chartOf(element, 1)];

    hover(first, 30);
    click(first, 30);
    first.dispatchEvent(new MouseEvent('pointerleave'));
    hover(second, 40);
    await element.updateComplete;

    expect(element.shadowRoot?.querySelectorAll('.trend__cursor')).toHaveLength(1);
  });

  it('steps on from the sample Enter answered', async () => {
    const element = await mount();
    const chart = chartOf(element);

    press(chart, 'Enter');
    press(chart, 'ArrowLeft');
    press(chart, 'Enter');

    // One step back from the last sample, not from the log's start.
    expect(seeks).toEqual([
      { timestamp: 800, mode: 'seek' },
      { timestamp: 780, mode: 'seek' },
    ]);
  });

  it('drops the cursor when another log arrives', async () => {
    const element = await mount();

    press(chartOf(element), 'ArrowRight');
    (element as unknown as { logStore: LogStore }).logStore = aLog();
    await element.updateComplete;
    press(chartOf(element), 'Enter');

    // The label repeats across logs, so a kept cursor would seek the old point.
    expect(seeks).toEqual([{ timestamp: 800, mode: 'seek' }]);
  });

  it('ignores a held Enter, so the flame chart is not re-zoomed', async () => {
    const element = await mount();

    press(chartOf(element), 'Enter', { repeat: true });

    expect(seeks).toEqual([]);
  });

  // A button, so the focus ring only shows for keyboard focus, never a click.
  it('gives every chart keyboard reach', async () => {
    const element = await mount();

    expect(chartOf(element).tagName).toBe('BUTTON');
  });
});
