/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';

import type {
  HeatStripEvent,
  HeatStripMetric,
  HeatStripMetricValue,
  HeatStripTimeSeries,
} from '../../types/flamechart.types.js';
import { MetricTierClassifier } from './MetricTierClassifier.js';

const metricDef = (id: string, priority: number): [string, HeatStripMetric] => [
  id,
  { id, displayName: id, unit: '', priority },
];

const series = (
  events: Array<[number, Record<string, HeatStripMetricValue>]>,
  ids: string[],
): HeatStripTimeSeries => ({
  metrics: new Map(ids.map((id, i) => metricDef(id, i))),
  events: events.map(([timestamp, values]): HeatStripEvent => ({
    timestamp,
    namespace: 'combined',
    values: new Map(Object.entries(values)),
  })),
});

describe('MetricTierClassifier', () => {
  describe('a log that reported limits', () => {
    it('reads every percentage against the reported limit', () => {
      const data = new MetricTierClassifier().processData(
        series(
          [
            [0, { soqlQueries: { used: 25, limit: 100 } }],
            [10, { soqlQueries: { used: 50, limit: 100 } }],
          ],
          ['soqlQueries'],
        ),
      );

      expect(data.scaledToPeak).toBe(false);
      expect(data.points.map((p) => p.values.get('soqlQueries'))).toEqual([0.25, 0.5]);
      expect(data.classifiedMetrics[0]?.limit).toBe(100);
    });

    // A metric the block never named has a different kind of denominator to its neighbours, so it
    // stays out rather than being drawn against its own peak on a shared axis.
    it('leaves out a metric the log reported no limit for', () => {
      const data = new MetricTierClassifier().processData(
        series(
          [
            [
              0,
              {
                soqlQueries: { used: 50, limit: 100 },
                callouts: { used: 3, limit: 0 },
              },
            ],
          ],
          ['soqlQueries', 'callouts'],
        ),
      );

      expect(data.scaledToPeak).toBe(false);
      expect(data.points[0]?.values.has('callouts')).toBe(false);
      expect(data.points[0]?.values.get('soqlQueries')).toBe(0.5);
    });
  });

  describe('a log that reported none', () => {
    const noLimits = series(
      [
        [0, { soqlQueries: { used: 3, limit: 0 }, queryRows: { used: 300, limit: 0 } }],
        [10, { soqlQueries: { used: 12, limit: 0 }, queryRows: { used: 1200, limit: 0 } }],
      ],
      ['soqlQueries', 'queryRows'],
    );

    it('reads each metric against its own peak so the series still has a shape', () => {
      const data = new MetricTierClassifier().processData(noLimits);

      expect(data.scaledToPeak).toBe(true);
      expect(data.points.map((p) => p.values.get('soqlQueries'))).toEqual([0.25, 1]);
      expect(data.points.map((p) => p.values.get('queryRows'))).toEqual([0.25, 1]);
    });

    it('carries the peak, and no limit, on each classified metric', () => {
      const byId = new Map(
        new MetricTierClassifier()
          .processData(noLimits)
          .classifiedMetrics.map((m) => [m.metricId, m]),
      );

      expect(byId.get('soqlQueries')).toMatchObject({ limit: 0, peak: 12 });
      expect(byId.get('queryRows')).toMatchObject({ limit: 0, peak: 1200 });
    });

    // Peak-scaling puts every metric at exactly 100% at its own peak, so the default 110% ceiling
    // still leaves the headroom the axis is drawn with.
    it('keeps the y-axis off the top of the strip', () => {
      const classifier = new MetricTierClassifier();
      classifier.processData(noLimits);

      expect(classifier.getEffectiveYMax()).toBeCloseTo(1.1);
    });
  });

  it('reports no mode for an empty series', () => {
    const data = new MetricTierClassifier().processData({ metrics: new Map(), events: [] });

    expect(data).toMatchObject({ hasData: false, scaledToPeak: false });
  });
});
