/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';
import type { LogCategory } from '#core/log/category.js';
import type { PixelBucket, ViewportState } from '../../types/flamechart.types.js';
import { type FrameSpec, rectsOf, timelineEvent } from '#test-helpers/timeline.js';
import { makeViewport } from '#test-helpers/viewport.js';
import { TIMELINE_CONSTANTS } from '../../types/flamechart.types.js';
import type { BatchColorInfo } from '../BucketColorResolver.js';
import { TemporalSegmentTree } from '../TemporalSegmentTree.js';

const NO_COLORS: Map<string, BatchColorInfo> = new Map();
function build(events: FrameSpec[]): TemporalSegmentTree {
  return new TemporalSegmentTree(rectsOf(events));
}

function query(events: FrameSpec[], view: ViewportState) {
  const result = build(events).query(view, NO_COLORS);
  const buckets: PixelBucket[] = [...result.buckets.values()].flat();
  return {
    ...result,
    total: result.stats.visibleCount + result.stats.bucketedEventCount,
    all: buckets,
  };
}

describe('TemporalSegmentTree', () => {
  it.each<[string, FrameSpec[], number]>([
    [
      'flat events',
      [timelineEvent(0, 10, 'Apex'), timelineEvent(20, 10, 'SOQL'), timelineEvent(40, 10, 'DML')],
      0,
    ],
    [
      'nested events',
      [
        timelineEvent(0, 100, 'Apex', [
          timelineEvent(10, 30, 'SOQL'),
          timelineEvent(50, 30, 'DML'),
        ]),
      ],
      1,
    ],
    ['no events', [], 0],
  ])('reads the max depth of %s', (_name, events, depth) => {
    expect(build(events).getMaxDepth()).toBe(depth);
  });

  describe('query', () => {
    // At zoom 1 an event wider than 2ns draws as a rect, and anything narrower is bucketed.
    it('draws an event wider than the threshold as a rect', () => {
      const result = query([timelineEvent(0, 10, 'Apex')], makeViewport());

      expect(result.visibleRects.get('Apex')).toHaveLength(1);
      expect(result.all).toHaveLength(0);
      expect(result.stats.visibleCount).toBe(1);
    });

    it('buckets an event under the threshold, under its own category', () => {
      const result = query([timelineEvent(0, 1, 'DML')], makeViewport());

      expect(result.visibleRects.get('DML')).toHaveLength(0);
      expect(result.buckets.get('DML')).toHaveLength(1);
      expect(result.all[0]?.eventCount).toBe(1);
      expect(result.stats.bucketedEventCount).toBe(1);
    });

    it('buckets small events together, with the stats of each category', () => {
      const result = query(
        [timelineEvent(0, 1, 'Apex'), timelineEvent(1, 1, 'SOQL')],
        makeViewport({ zoom: 0.1 }),
      );

      expect(result.all).toHaveLength(1);
      expect(result.all[0]?.eventCount).toBe(2);
      expect([...(result.all[0]?.categoryStats.byCategory.keys() ?? [])].sort()).toEqual([
        'Apex',
        'SOQL',
      ]);
    });

    // 17 events need 3 branch levels, so the bucket takes its stats from the root's roll-up.
    it('sums each category of a wide row into its bucket, counting a sub-1ns event as 1ns', () => {
      const events = Array.from({ length: 17 }, (_, i) =>
        i % 2 ? timelineEvent(i, 0.5, 'SOQL') : timelineEvent(i, 1, 'Apex'),
      );

      const result = query(events, makeViewport({ zoom: 0.01 }));

      expect(result.all).toHaveLength(1);
      expect(Object.fromEntries(result.all[0]!.categoryStats.byCategory)).toEqual({
        Apex: { count: 9, totalDuration: 9 },
        SOQL: { count: 8, totalDuration: 8 },
      });
    });

    // DML outranks SOQL, though SOQL has more events and more time in the bucket.
    it.each<[string, LogCategory[]]>([
      ['last', ['SOQL', 'SOQL', 'DML']],
      ['first', ['DML', 'SOQL', 'SOQL']],
    ])('files a bucket under the category of highest priority, met %s', (_name, order) => {
      const events = order.map((category, index) => timelineEvent(index, 1, category));

      const result = query(events, makeViewport({ zoom: 0.01 }));

      expect(result.buckets.get('DML')).toHaveLength(1);
      expect(result.buckets.get('SOQL') ?? []).toHaveLength(0);
    });

    // A bucket is 2px wide, so at zoom 1 it spans 2ns and at zoom 0.5 it spans 4ns.
    it.each<[number, number]>([
      [1, 4],
      [0.5, 2],
    ])('places a bucket per depth on the pixel grid at zoom %d', (zoom, x) => {
      const events = [timelineEvent(5, 1, 'Apex', [timelineEvent(5, 0.5, 'SOQL')])];

      const result = query(events, makeViewport({ zoom }));

      expect(result.all.sort((a, b) => a.depth - b.depth)).toEqual([
        expect.objectContaining({ depth: 0, x, y: 0, firstStart: 5, lastStart: 5 }),
        expect.objectContaining({
          depth: 1,
          x,
          y: TIMELINE_CONSTANTS.EVENT_HEIGHT,
          firstStart: 5,
          lastStart: 5,
        }),
      ]);
    });

    it('keeps apart buckets that fall in different cells of one row', () => {
      const events = [timelineEvent(0, 1, 'Apex'), timelineEvent(10, 1, 'Apex')];

      const result = query(events, makeViewport());

      expect(result.all.map((bucket) => bucket.firstStart).sort((a, b) => a - b)).toEqual([0, 10]);
    });

    it.each<[number, number]>([
      [0.1, 0],
      [1, 2],
      [10, 3],
    ])('accounts for every event at zoom %d, drawing %d as rects', (zoom, drawn) => {
      const events = [
        timelineEvent(0, 10, 'Apex'),
        timelineEvent(20, 5, 'SOQL'),
        timelineEvent(40, 1, 'DML'),
      ];

      const result = query(events, makeViewport({ zoom }));

      expect(result.total).toBe(3);
      expect(result.stats.visibleCount).toBe(drawn);
    });

    it('leaves out events outside the time range', () => {
      const events = [
        timelineEvent(0, 10, 'Apex'),
        timelineEvent(100, 10, 'SOQL'),
        timelineEvent(200, 10, 'DML'),
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
        timelineEvent(0, 100, 'Apex', [
          timelineEvent(10, 80, 'SOQL', [timelineEvent(20, 60, 'DML')]),
        ]),
      ];

      const result = query(
        events,
        makeViewport({ displayHeight: TIMELINE_CONSTANTS.EVENT_HEIGHT * rows }),
      );

      expect(result.total).toBe(expected);
    });
  });

  // A branch's end is the latest end among its children, not the end of the last one to start.
  describe('branch bounds', () => {
    it('finds a long event when a later, shorter event ends first', () => {
      const result = query(
        [timelineEvent(0, 100, 'Apex'), timelineEvent(50, 10, 'SOQL')],
        makeViewport({ offsetX: 70, displayWidth: 20 }),
      );

      expect(result.total).toBe(1);
      expect(result.visibleRects.get('Apex')).toHaveLength(1);
    });

    it('finds the one event that ends latest among several', () => {
      const events = [
        timelineEvent(0, 50, 'Apex'),
        timelineEvent(10, 100, 'SOQL'),
        timelineEvent(20, 30, 'DML'),
        timelineEvent(30, 20, 'Apex'),
      ];

      const result = query(events, makeViewport({ offsetX: 80, displayWidth: 40 }));

      expect(result.total).toBe(1);
      expect(result.visibleRects.get('SOQL')).toHaveLength(1);
    });

    // Over 4 events in a row needs a second branch level; 17 and 65 leave a short last group.
    it.each([5, 17, 65])('accounts for each of %d events in one row, at every zoom', (count) => {
      const events = Array.from({ length: count }, (_, i) => timelineEvent(i * 10, 4, 'Apex'));
      const tree = build(events);

      for (const zoom of [0.01, 0.3, 1]) {
        const result = tree.query(makeViewport({ zoom, displayWidth: 1000 * zoom }), NO_COLORS);
        const bucketed = [...result.buckets.values()].flat();
        const drawn = result.visibleRects.get('Apex') ?? [];
        expect(drawn.length + bucketed.reduce((sum, b) => sum + b.eventCount, 0)).toBe(count);
      }
      // Rows are numbered in pre-order, so row i is event i.
      expect(tree.queryRowsInRegion(0, 10 * count, 0, 0)).toEqual(events.map((_, i) => i));
    });

    it('finds a long first event two branch levels up, past 16 short ones', () => {
      const events = [
        timelineEvent(0, 1000, 'Apex'),
        ...Array.from({ length: 16 }, (_, i) => timelineEvent(10 + i * 10, 1, 'SOQL')),
      ];

      expect(build(events).queryRowsInRegion(900, 950, 0, 0)).toEqual([0]);
    });

    it('finds a long event by region, for hit testing', () => {
      const found = build([
        timelineEvent(0, 100, 'Apex'),
        timelineEvent(50, 10, 'SOQL'),
      ]).queryRowsInRegion(70, 90, 0, 0);

      expect(found).toEqual([0]);
    });
  });
});
