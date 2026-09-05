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

  /** The panel element. */
  function panel(): HTMLElement {
    return container.querySelector('.metric-strip-tooltip') as HTMLElement;
  }

  /** jsdom lays nothing out, so the widths the placement maths reads have to be declared. */
  function declareWidths(panelWidth: number, containerWidth: number): void {
    Object.defineProperty(panel(), 'offsetWidth', { value: panelWidth, configurable: true });
    Object.defineProperty(container, 'offsetWidth', { value: containerWidth, configurable: true });
  }

  /** Placement is batched into a frame, so it has to be let through. */
  function flushFrame(): Promise<void> {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }

  /** One always-show metric, enough to get a row on the panel. */
  const oneMetric = [metric('cpuTime', 'CPU Time', 0.9)];
  const onePoint: MetricStripDataPoint = {
    timestamp: 0,
    values: new Map([['cpuTime', 0.5]]),
    rawValues: new Map(),
    tier3Max: 0,
  };

  describe('placement', () => {
    it('sits a fixed offset below the strip, clear of what is being read', async () => {
      renderer.show(100, 0, onePoint, oneMetric, 60);
      declareWidths(200, 1000);
      await flushFrame();

      // stripHeight 60 + offset 8; never above, so the panel cannot cover the strip.
      expect(panel().style.top).toBe('68px');
      expect(panel().style.left).toBe('108px');
    });

    it('flips to the left of the cursor rather than overflow the container', async () => {
      renderer.show(950, 0, onePoint, oneMetric, 60);
      declareWidths(200, 1000);
      await flushFrame();

      // 950 + 8 + 200 overflows 1000, so the panel goes to the cursor's left.
      expect(panel().style.left).toBe('742px');
    });
  });

  // The classifier hands back the same point object across one time segment, so sweeping a
  // segment must not rebuild: a mutation of the panel survives the second show.
  it('re-positions without rebuilding when the reading has not changed', async () => {
    renderer.show(100, 0, onePoint, oneMetric, 60);
    panel().dataset['marked'] = 'yes';

    renderer.show(140, 0, onePoint, oneMetric, 60);
    declareWidths(200, 1000);
    await flushFrame();

    expect(panel().dataset['marked']).toBe('yes');
    expect(panel().style.left).toBe('148px');
  });

  /** The row elements, title aside. */
  function rows(): HTMLElement[] {
    return [...panel().children].slice(1) as HTMLElement[];
  }

  describe('row elements', () => {
    it('writes a new reading into the rows it already has', () => {
      renderer.show(100, 0, onePoint, oneMetric, 60);
      const [first] = rows();

      const later: MetricStripDataPoint = { ...onePoint, values: new Map([['cpuTime', 0.9]]) };
      renderer.show(100, 0, later, oneMetric, 60);

      expect(rows()[0]).toBe(first);
      expect(first?.textContent).toContain('90.0%');
    });

    it('hides the spares for a shorter reading rather than discarding them', () => {
      const two = [metric('cpuTime', 'CPU Time', 0.9), metric('heapSize', 'Heap Size', 0.5)];
      const twoPoint: MetricStripDataPoint = {
        ...onePoint,
        values: new Map([
          ['cpuTime', 0.5],
          ['heapSize', 0.5],
        ]),
      };

      renderer.show(100, 0, twoPoint, two, 60);
      expect(rows()).toHaveLength(2);

      renderer.show(100, 0, onePoint, oneMetric, 60);

      // Still two elements, one of them held back for the next longer reading.
      expect(rows()).toHaveLength(2);
      expect(rows().map((row) => row.style.display)).toEqual(['grid', 'none']);
    });
  });

  it('rebuilds when the reading changes', () => {
    renderer.show(100, 0, onePoint, oneMetric, 60);
    const first = panel().innerHTML;

    const later: MetricStripDataPoint = { ...onePoint, values: new Map([['cpuTime', 0.9]]) };
    renderer.show(100, 0, later, oneMetric, 60);

    expect(panel().innerHTML).not.toBe(first);
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

  describe('no data note', () => {
    it('says nothing while the reading is the one at the cursor', () => {
      renderer.setNoDataLabel(null);
      renderer.show(100, 0, onePoint, oneMetric, 60);

      expect(panel().textContent).not.toContain('Max-Size-reached');
    });

    it('sits under the rows', () => {
      renderer.setNoDataLabel('Max-Size-reached · 10.8s → 27.1s');
      renderer.show(100, 0, onePoint, oneMetric, 60);

      const children = [...panel().children] as HTMLElement[];
      expect(children[children.length - 1]!.textContent).toBe('Max-Size-reached · 10.8s → 27.1s');
    });

    // One reading covers the whole unrecorded region, so the note has to appear and clear
    // without the data point changing, which is what skips the panel rebuild.
    it('appears and clears on the same reading', () => {
      renderer.show(100, 0, onePoint, oneMetric, 60);
      expect(panel().textContent).not.toContain('Max-Size-reached');

      renderer.setNoDataLabel('Max-Size-reached · 10.8s → 27.1s');
      renderer.show(140, 0, onePoint, oneMetric, 60);
      expect(panel().textContent).toContain('Max-Size-reached · 10.8s → 27.1s');

      renderer.setNoDataLabel(null);
      renderer.show(180, 0, onePoint, oneMetric, 60);
      expect(panel().textContent).not.toContain('Max-Size-reached');
    });

    // The note is written once and never re-appended, so a later reading that grows the
    // row pool has to insert its rows above it rather than under it.
    it('stays last when a later reading adds a row', () => {
      renderer.setNoDataLabel('Max-Size-reached · 10.8s → 27.1s');
      renderer.show(100, 0, onePoint, oneMetric, 60);

      const two = [metric('cpuTime', 'CPU Time', 0.9), metric('heapSize', 'Heap Size', 0.5)];
      const twoPoint: MetricStripDataPoint = {
        ...onePoint,
        values: new Map([
          ['cpuTime', 0.5],
          ['heapSize', 0.5],
        ]),
      };
      renderer.show(100, 0, twoPoint, two, 60);

      expect(panel().lastElementChild?.textContent).toBe('Max-Size-reached · 10.8s → 27.1s');
    });
  });
});
