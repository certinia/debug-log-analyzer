/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import type { ApexLog } from '@apexdevtools/apex-log-parser';

import type { MeasurementSnapshot } from '../optimised/measurement/MeasurementState.js';
import type { TimelineOptions, ViewportState } from '../types/flamechart.types.js';

/** The options the chart handed its renderer, so a test can report as the renderer does. */
let reported: TimelineOptions = {};

// The renderer brings pixi, which needs a WebGL context jsdom lacks; this suite
// drives only what the chart publishes from the renderer's reports.
jest.mock('../optimised/ApexLogTimeline.js', () => ({
  ApexLogTimeline: class {
    init(_container: HTMLElement, _log: ApexLog, options: TimelineOptions): Promise<void> {
      reported = options;
      return Promise.resolve();
    }
    setTooltipEnabled(): void {}
    destroy(): void {}
  },
}));

import { currentRange, setRange } from '../../../core/log/rangeScope.js';
import { makeViewport } from '#test-helpers/viewport.js';
import '../components/TimelineFlameChart.js';

const LOG = { timestamp: 0, exitStamp: 1000, duration: { total: 1000 } } as unknown as ApexLog;

const viewport = (start: number, end: number): ViewportState =>
  makeViewport({ offsetX: start, displayWidth: end - start });

const measurement = (startTime: number, endTime: number): MeasurementSnapshot => ({
  startTime,
  endTime,
  isActive: false,
});

async function mount(): Promise<void> {
  const element = document.createElement('timeline-flame-chart');
  Object.assign(element, { apexLog: LOG });
  document.body.append(element);
  await (element as unknown as { updateComplete: Promise<boolean> }).updateComplete;
  // `init` resolves a microtask after the first update.
  await Promise.resolve();
}

describe('timeline-flame-chart publishes the range the user reads', () => {
  const realRaf = window.requestAnimationFrame;

  beforeEach(() => {
    // One publish per frame; running the frame at once lets a test read the result.
    window.requestAnimationFrame = (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    };
    reported = {};
    setRange(null);
  });

  afterEach(() => {
    document.body.replaceChildren();
    window.requestAnimationFrame = realRaf;
  });

  it('reads the viewport when nothing is measured', async () => {
    await mount();
    reported.onViewportChange?.(viewport(200, 400));

    expect(currentRange()).toEqual({ start: 200, end: 400 });
  });

  it('reads a measured range over the viewport', async () => {
    await mount();
    reported.onViewportChange?.(viewport(0, 1000));
    reported.onMeasurementChange?.(measurement(300, 500));

    expect(currentRange()).toEqual({ start: 300, end: 500 });

    // Panning while a range is measured leaves the range standing.
    reported.onViewportChange?.(viewport(100, 600));
    expect(currentRange()).toEqual({ start: 300, end: 500 });
  });

  it('returns to the viewport when the measurement clears', async () => {
    await mount();
    reported.onViewportChange?.(viewport(100, 600));
    reported.onMeasurementChange?.(measurement(300, 500));
    reported.onMeasurementChange?.(null);

    expect(currentRange()).toEqual({ start: 100, end: 600 });
  });

  it('keeps the viewport for a measurement of no width', async () => {
    await mount();
    reported.onViewportChange?.(viewport(100, 600));
    reported.onMeasurementChange?.(measurement(300, 300));

    expect(currentRange()).toEqual({ start: 100, end: 600 });
  });

  it('reads the whole log for a measurement that spans it', async () => {
    await mount();
    reported.onViewportChange?.(viewport(100, 600));
    reported.onMeasurementChange?.(measurement(0, 1000));

    expect(currentRange()).toBeNull();
  });
});
