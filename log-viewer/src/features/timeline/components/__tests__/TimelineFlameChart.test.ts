/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import type { ApexLog } from '@apexdevtools/apex-log-parser';

// The chart needs WebGL, which jsdom lacks; this suite drives only when it is built.
jest.mock('../../optimised/ApexLogTimeline.js', () => ({
  ApexLogTimeline: class {
    private log: ApexLog | null = null;
    findTarget = { find: async () => null, setCurrentMatch: async () => {}, clearFind: () => {} };
    init(_container: HTMLElement, log: ApexLog): Promise<void> {
      this.log = log;
      built.push(log);
      return holdInit ? new Promise((resolve) => (finishInit = resolve)) : Promise.resolve();
    }
    destroy(): void {
      if (this.log) {
        destroyed.push(this.log);
      }
    }
    getViewport(): null {
      return null;
    }
    setViewport(): void {}
    setTooltipEnabled(): void {}
    setCategoryDim(): void {}
    setTheme(): void {}
    setEditorColors(): void {}
  },
}));

import { AlwaysVisible, settle } from '#test-helpers/visibility.js';
import '../TimelineFlameChart.js';

/** The logs the chart was built for, in order. */
let built: ApexLog[] = [];
/** The logs whose chart was destroyed, in order. */
let destroyed: ApexLog[] = [];
/** Whether a build waits to be finished by hand. */
let holdInit = false;
let finishInit: () => void = () => {};
/** Reports every observed element in view, as a tab coming back on screen does. */
let show: () => void = () => {};

class ShownLater {
  private readonly callback: IntersectionObserverCallback;
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
  }
  observe(target: Element): void {
    show = () =>
      this.callback(
        [{ isIntersecting: true, target } as IntersectionObserverEntry],
        this as unknown as IntersectionObserver,
      );
  }
  disconnect(): void {}
}

const logOf = (): ApexLog => ({ duration: { total: 10 } }) as ApexLog;

describe('timeline-flame-chart in a hidden tab', () => {
  let chart: HTMLElement & { apexLog: ApexLog | null; updateComplete: Promise<unknown> };

  beforeEach(async () => {
    built = [];
    globalThis.IntersectionObserver = ShownLater as unknown as typeof IntersectionObserver;
    chart = document.createElement('timeline-flame-chart') as typeof chart;
    document.body.append(chart);
    await chart.updateComplete;
  });

  afterEach(() => {
    chart.remove();
  });

  it('waits until the tab shows before it builds the chart for a new log', async () => {
    const log = logOf();

    // jsdom lays nothing out, so the container has no size, as in a hidden tab.
    chart.apexLog = log;
    await chart.updateComplete;
    await settle();
    expect(built).toEqual([]);

    show();
    await settle();
    expect(built).toEqual([log]);
  });

  it('builds only the newest of the logs that arrived while hidden', async () => {
    const newest = logOf();

    chart.apexLog = logOf();
    await chart.updateComplete;
    chart.apexLog = newest;
    await chart.updateComplete;
    show();
    await settle();

    expect(built).toEqual([newest]);
  });
});

describe('timeline-flame-chart on a new log', () => {
  let chart: HTMLElement & { apexLog: ApexLog | null; updateComplete: Promise<unknown> };

  beforeEach(async () => {
    built = [];
    destroyed = [];
    holdInit = false;
    globalThis.IntersectionObserver = AlwaysVisible as unknown as typeof IntersectionObserver;
    chart = document.createElement('timeline-flame-chart') as typeof chart;
    document.body.append(chart);
    chart.apexLog = logOf();
    await chart.updateComplete;
    await settle();
  });

  afterEach(() => {
    chart.remove();
  });

  it('keeps the chart on screen until the chart for the new log is built', async () => {
    const [first] = built;
    holdInit = true;

    chart.apexLog = logOf();
    await chart.updateComplete;
    await settle();
    expect(destroyed).toEqual([]);

    finishInit();
    await settle();
    expect(destroyed).toEqual([first]);
  });
});
