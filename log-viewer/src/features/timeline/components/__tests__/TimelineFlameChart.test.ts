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
    findTarget = {
      queries: [] as unknown[],
      clears: 0,
      async find(query: unknown) {
        this.queries.push(query);
        return { total: 1, current: -1 };
      },
      setCurrentMatch: async () => {},
      clearFind() {
        this.clears++;
      },
    };
    constructor() {
      targets.push(this.findTarget);
    }
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
/** Each chart's find target, in the order the charts were made. */
let targets: { queries: unknown[]; clears: number }[] = [];
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

describe('timeline-flame-chart find', () => {
  let chart: HTMLElement & { apexLog: ApexLog | null; updateComplete: Promise<unknown> };
  let height: number;

  const search = (text: string): void => {
    document.dispatchEvent(
      new CustomEvent('lv-find', { detail: { text, count: 0, options: { matchCase: false } } }),
    );
  };

  beforeEach(async () => {
    targets = [];
    holdInit = false;
    height = 20;
    globalThis.IntersectionObserver = AlwaysVisible as unknown as typeof IntersectionObserver;
    chart = document.createElement('timeline-flame-chart') as typeof chart;
    Object.defineProperty(chart, 'clientHeight', { get: () => height });
    document.body.append(chart);
    await chart.updateComplete;
  });

  afterEach(() => {
    chart.remove();
  });

  it('searches the chart for a new log with the open query', async () => {
    search('foo');
    chart.apexLog = logOf();
    await chart.updateComplete;
    await settle();

    expect(targets[0]?.queries).toEqual([{ text: 'foo', matchCase: false }]);
  });

  it('answers no search while the tab is hidden', async () => {
    chart.apexLog = logOf();
    await chart.updateComplete;
    await settle();
    height = 0;
    search('foo');
    await settle();

    expect(targets[0]?.queries).toEqual([]);
  });

  it('clears the old chart before it goes', async () => {
    chart.apexLog = logOf();
    await chart.updateComplete;
    await settle();
    search('foo');
    await settle();
    chart.apexLog = logOf();
    await chart.updateComplete;
    await settle();

    expect(targets[0]?.clears).toBeGreaterThan(0);
  });
});
