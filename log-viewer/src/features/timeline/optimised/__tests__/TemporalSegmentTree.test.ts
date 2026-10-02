/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';
import type { LogEvent } from '@apexdevtools/apex-log-parser';
import type { LogCategory } from '@apexdevtools/apex-log-parser/types';

import type { PixelBucket, ViewportState } from '../../types/flamechart.types.js';
import { makeViewport } from '#test-helpers/viewport.js';
import { TIMELINE_CONSTANTS } from '../../types/flamechart.types.js';
import type { BatchColorInfo } from '../BucketColorResolver.js';
import { legacyCullRectangles } from '../LegacyViewportCuller.js';
import { RectangleCache } from '../RectangleCache.js';
import { TemporalSegmentTree } from '../TemporalSegmentTree.js';

const NO_COLORS: Map<string, BatchColorInfo> = new Map();
const CATEGORIES = new Set([
  'Apex',
  'Code Unit',
  'System',
  'Automation',
  'DML',
  'SOQL',
  'Callout',
  'Validation',
]);

function createEvent(
  timestamp: number,
  duration: number,
  category: LogCategory,
  children: LogEvent[] = [],
): LogEvent {
  return {
    timestamp,
    exitStamp: timestamp + duration,
    duration: { total: duration, self: duration, netSelf: duration },
    category,
    type: 'METHOD_ENTRY',
    text: `Event at ${timestamp}`,
    children,
  } as unknown as LogEvent;
}

function build(events: LogEvent[]): TemporalSegmentTree {
  return new TemporalSegmentTree(new RectangleCache(events, CATEGORIES).getRectsByCategory());
}

function query(events: LogEvent[], view: ViewportState) {
  const result = build(events).query(view, NO_COLORS);
  const buckets: PixelBucket[] = [...result.buckets.values()].flat();
  return {
    ...result,
    total: result.stats.visibleCount + result.stats.bucketedEventCount,
    all: buckets,
  };
}

describe('TemporalSegmentTree', () => {
  it.each<[string, LogEvent[], number]>([
    [
      'flat events',
      [createEvent(0, 10, 'Apex'), createEvent(20, 10, 'SOQL'), createEvent(40, 10, 'DML')],
      0,
    ],
    [
      'nested events',
      [createEvent(0, 100, 'Apex', [createEvent(10, 30, 'SOQL'), createEvent(50, 30, 'DML')])],
      1,
    ],
    ['no events', [], 0],
  ])('reads the max depth of %s', (_name, events, depth) => {
    expect(build(events).getMaxDepth()).toBe(depth);
  });

  describe('query', () => {
    // At zoom 1 an event wider than 2ns draws as a rect, and anything narrower is bucketed.
    it('draws an event wider than the threshold as a rect', () => {
      const result = query([createEvent(0, 10, 'Apex')], makeViewport());

      expect(result.visibleRects.get('Apex')).toHaveLength(1);
      expect(result.all).toHaveLength(0);
      expect(result.stats.visibleCount).toBe(1);
    });

    it('buckets an event under the threshold, under its own category', () => {
      const result = query([createEvent(0, 1, 'DML')], makeViewport());

      expect(result.visibleRects.get('DML')).toHaveLength(0);
      expect(result.buckets.get('DML')).toHaveLength(1);
      expect(result.all[0]?.eventCount).toBe(1);
      expect(result.stats.bucketedEventCount).toBe(1);
    });

    it('buckets small events together, with the stats of each category', () => {
      const result = query(
        [createEvent(0, 1, 'Apex'), createEvent(1, 1, 'SOQL')],
        makeViewport({ zoom: 0.1 }),
      );

      expect(result.all).toHaveLength(1);
      expect(result.all[0]?.eventCount).toBe(2);
      expect([...(result.all[0]?.categoryStats.byCategory.keys() ?? [])].sort()).toEqual([
        'Apex',
        'SOQL',
      ]);
    });

    // DML outranks SOQL, though SOQL has more events and more time in the bucket.
    it.each<[string, LogCategory[]]>([
      ['last', ['SOQL', 'SOQL', 'DML']],
      ['first', ['DML', 'SOQL', 'SOQL']],
    ])('files a bucket under the category of highest priority, met %s', (_name, order) => {
      const events = order.map((category, index) => createEvent(index, 1, category));

      const result = query(events, makeViewport({ zoom: 0.01 }));

      expect(result.buckets.get('DML')).toHaveLength(1);
      expect(result.buckets.get('SOQL') ?? []).toHaveLength(0);
    });

    it.each<[number, number]>([
      [0.1, 0],
      [1, 3],
      [10, 3],
    ])('accounts for every event at zoom %d, drawing %d as rects', (zoom, drawn) => {
      const events = [
        createEvent(0, 5, 'Apex'),
        createEvent(10, 5, 'SOQL'),
        createEvent(20, 5, 'DML'),
      ];

      const result = query(events, makeViewport({ zoom }));

      expect(result.total).toBe(3);
      expect(result.stats.visibleCount).toBe(drawn);
    });

    it('leaves out events outside the time range', () => {
      const events = [
        createEvent(0, 10, 'Apex'),
        createEvent(100, 10, 'SOQL'),
        createEvent(200, 10, 'DML'),
      ];

      const result = query(events, makeViewport({ offsetX: 50, displayWidth: 100 }));

      expect(result.total).toBe(1);
      expect(result.visibleRects.get('SOQL')).toHaveLength(1);
    });

    it.each<[number, number]>([
      [0.5, 1],
      [1.5, 2],
      [4, 3],
    ])('shows a view %d rows tall over a 3-deep stack as %d events', (rows, expected) => {
      const events = [
        createEvent(0, 100, 'Apex', [createEvent(10, 80, 'SOQL', [createEvent(20, 60, 'DML')])]),
      ];

      const result = query(
        events,
        makeViewport({ displayHeight: TIMELINE_CONSTANTS.EVENT_HEIGHT * rows }),
      );

      expect(result.total).toBe(expected);
    });

    it('counts the same events as the legacy culler', () => {
      const events = [
        createEvent(0, 10, 'Apex'),
        createEvent(20, 5, 'SOQL'),
        createEvent(30, 3, 'DML'),
        createEvent(40, 1, 'Apex'),
      ];
      const cache = new RectangleCache(events, CATEGORIES);

      const tree = cache.getCulledRectangles(makeViewport(), NO_COLORS).stats;
      const legacy = legacyCullRectangles(
        cache.getRectsByCategory(),
        makeViewport(),
        NO_COLORS,
      ).stats;

      expect(tree.visibleCount + tree.bucketedEventCount).toBe(
        legacy.visibleCount + legacy.bucketedEventCount,
      );
    });
  });

  // A branch's end is the latest end among its children, not the end of the last one to start.
  describe('branch bounds', () => {
    it('finds a long event when a later, shorter event ends first', () => {
      const result = query(
        [createEvent(0, 100, 'Apex'), createEvent(50, 10, 'SOQL')],
        makeViewport({ offsetX: 70, displayWidth: 20 }),
      );

      expect(result.total).toBe(1);
      expect(result.visibleRects.get('Apex')).toHaveLength(1);
    });

    it('finds the one event that ends latest among several', () => {
      const events = [
        createEvent(0, 50, 'Apex'),
        createEvent(10, 100, 'SOQL'),
        createEvent(20, 30, 'DML'),
        createEvent(30, 20, 'Apex'),
      ];

      const result = query(events, makeViewport({ offsetX: 80, displayWidth: 40 }));

      expect(result.total).toBe(1);
      expect(result.visibleRects.get('SOQL')).toHaveLength(1);
    });

    it('finds a long event by region, for hit testing', () => {
      const found = build([
        createEvent(0, 100, 'Apex'),
        createEvent(50, 10, 'SOQL'),
      ]).queryEventsInRegion(70, 90, 0, 0);

      expect(found.map((event) => event.category)).toEqual(['Apex']);
    });
  });
});
