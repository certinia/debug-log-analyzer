/**
 * @jest-environment jsdom
 */

/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import type {
  MetricStripClassifiedMetric,
  MetricStripDataPoint,
} from '../../types/flamechart.types.js';
import { MetricStripTooltipRenderer } from './MetricStripTooltipRenderer.js';

/**
 * Build a classified metric. Only metricId/displayName/globalMaxPercent/limit matter here.
 */
function metric(
  metricId: string,
  displayName: string,
  globalMaxPercent: number,
  limit = 100,
): MetricStripClassifiedMetric {
  return {
    metricId,
    displayName,
    tier: 1,
    globalMaxPercent,
    limit,
    color: 0xffffff,
    priority: 0,
    unit: '',
  };
}

describe('MetricStripTooltipRenderer', () => {
  let container: HTMLElement;
  let renderer: MetricStripTooltipRenderer;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    renderer = new MetricStripTooltipRenderer(container);
  });

  afterEach(() => {
    renderer.destroy();
    document.body.removeChild(container);
  });

  it('orders rows by global peak, independent of the value at the cursor', () => {
    // All three are always-show metrics, so membership is fixed and we isolate ordering.
    const metrics = [
      metric('cpuTime', 'CPU Time', 0.9),
      metric('heapSize', 'Heap Size', 0.5),
      metric('soqlQueries', 'SOQL Queries', 0.2),
    ];

    // Current-point percentages are the REVERSE of the peak ranking. If the tooltip sorted by
    // the cursor value (the old behaviour) SOQL would be first; sorting by peak keeps CPU first.
    const dataPoint: MetricStripDataPoint = {
      timestamp: 0,
      values: new Map([
        ['cpuTime', 0.1],
        ['heapSize', 0.5],
        ['soqlQueries', 0.8],
      ]),
      rawValues: new Map(),
      tier3Max: 0,
    };

    renderer.show(0, 0, dataPoint, metrics, 60);

    const text = (container.querySelector('.metric-strip-tooltip') as HTMLElement).textContent!;
    expect(text.indexOf('CPU Time')).toBeLessThan(text.indexOf('Heap Size'));
    expect(text.indexOf('Heap Size')).toBeLessThan(text.indexOf('SOQL Queries'));
  });

  it('always shows the (used / limit) value, even at 0% with no data point for the metric', () => {
    // cpuTime has a limit but no entry in rawValues (not observed yet at this timestamp).
    const metrics = [metric('cpuTime', 'CPU Time', 0, 10000)];
    const dataPoint: MetricStripDataPoint = {
      timestamp: 0,
      values: new Map([['cpuTime', 0]]),
      rawValues: new Map(),
      tier3Max: 0,
    };

    renderer.show(0, 0, dataPoint, metrics, 60);

    const text = (container.querySelector('.metric-strip-tooltip') as HTMLElement).textContent!;
    expect(text).toContain('(0 / 10,000)');
  });

  it('keeps the same row order at different timestamps', () => {
    const metrics = [
      metric('cpuTime', 'CPU Time', 0.9),
      metric('soqlQueries', 'SOQL Queries', 0.2),
    ];

    const order = (soqlNow: number): [number, number] => {
      const dataPoint: MetricStripDataPoint = {
        timestamp: 0,
        values: new Map([
          ['cpuTime', 0.1],
          ['soqlQueries', soqlNow],
        ]),
        rawValues: new Map(),
        tier3Max: 0,
      };
      renderer.show(0, 0, dataPoint, metrics, 60);
      const text = (container.querySelector('.metric-strip-tooltip') as HTMLElement).textContent!;
      return [text.indexOf('CPU Time'), text.indexOf('SOQL Queries')];
    };

    // Early (SOQL low) and late (SOQL momentarily high) must produce the same order: CPU first.
    const [cpuEarly, soqlEarly] = order(0.05);
    const [cpuLate, soqlLate] = order(0.85);
    expect(cpuEarly).toBeLessThan(soqlEarly);
    expect(cpuLate).toBeLessThan(soqlLate);
  });
});
