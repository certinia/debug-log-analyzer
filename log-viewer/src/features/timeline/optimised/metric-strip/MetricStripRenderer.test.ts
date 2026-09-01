/**
 * @jest-environment jsdom
 */

/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

import { describe, expect, it } from '@jest/globals';
import type {
  MetricStripClassifiedMetric,
  MetricStripDataPoint,
  MetricStripProcessedData,
  NoDataSpan,
  ViewportState,
} from '../../types/flamechart.types.js';
import { MetricStripRenderer } from './MetricStripRenderer.js';

const TOTAL_DURATION = 4000;

const cpuTime: MetricStripClassifiedMetric = {
  metricId: 'cpuTime',
  displayName: 'CPU Time',
  tier: 1,
  globalMaxPercent: 0.5,
  limit: 100,
  color: 0xff0000,
  priority: 0,
  unit: '',
};

/** A reading of `percent` at `timestamp`. */
function point(timestamp: number, percent: number): MetricStripDataPoint {
  return {
    timestamp,
    values: new Map([['cpuTime', percent]]),
    rawValues: new Map(),
    tier3Max: 0,
  };
}

function data(points: MetricStripDataPoint[], gaps: NoDataSpan[]): MetricStripProcessedData {
  return { points, classifiedMetrics: [cpuTime], globalMaxPercent: 0.5, hasData: true, gaps };
}

const viewportState: ViewportState = {
  zoom: 0.1,
  offsetX: 0,
  offsetY: 0,
  displayWidth: 400,
  displayHeight: 60,
} as ViewportState;

/** How many separate shapes the area fill painted. */
function areaFillCount(renderer: MetricStripRenderer): number {
  // Index 2 of the render-order list is the area fill layer.
  const graphics = renderer.getGraphics()[2]!;
  return graphics.context.instructions.filter((i) => i.action === 'fill').length;
}

describe('MetricStripRenderer area fills', () => {
  const readings = [point(0, 0.5), point(1000, 0.5), point(3000, 0.5)];

  it('paints one shape when the log recorded throughout', () => {
    const renderer = new MetricStripRenderer();
    renderer.setHeight(60);

    renderer.render(data(readings, []), viewportState, TOTAL_DURATION);

    expect(areaFillCount(renderer)).toBe(1);
  });

  // One shape spanning the gap ramps straight across it, which reads as measured volume.
  it('breaks the shape at a span the log recorded nothing in', () => {
    const renderer = new MetricStripRenderer();
    renderer.setHeight(60);

    renderer.render(
      data(readings, [{ startTime: 1500, endTime: 2500, summary: 'Skipped-Lines' }]),
      viewportState,
      TOTAL_DURATION,
    );

    // One shape up to the gap, one after it.
    expect(areaFillCount(renderer)).toBe(2);
  });
});
