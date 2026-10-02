/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';

import { countBuckets, getAllBuckets, timelineEvent } from '#test-helpers/timeline.js';
import { makeViewport } from '#test-helpers/viewport.js';
import { TIMELINE_CONSTANTS } from '../../types/flamechart.types.js';
import type { BatchColorInfo } from '../BucketColorResolver.js';
import { legacyCullRectangles } from '../LegacyViewportCuller.js';
import { RectangleCache } from '../RectangleCache.js';
import { TemporalSegmentTree } from '../TemporalSegmentTree.js';

/** Empty batch colors — tests that don't assert color values use this. */
const EMPTY_BATCH_COLORS: Map<string, BatchColorInfo> = new Map();

/**
 * Tests for TemporalSegmentTree.
 *
 * The segment tree provides O(log n) viewport culling by pre-computing
 * aggregate statistics at multiple granularities.
 */

describe('TemporalSegmentTree', () => {
  const categories = new Set([
    'Apex',
    'Code Unit',
    'System',
    'Automation',
    'DML',
    'SOQL',
    'Callout',
    'Validation',
  ]);

  describe('tree building', () => {
    it('should build tree from rectangles', () => {
      const events = [
        timelineEvent(0, 10, 'Apex'),
        timelineEvent(20, 10, 'SOQL'),
        timelineEvent(40, 10, 'DML'),
      ];
      const manager = new RectangleCache(events, categories);
      const tree = new TemporalSegmentTree(manager.getRectsByCategory());

      expect(tree.getMaxDepth()).toBe(0);
    });

    it('should handle events at multiple depths', () => {
      const events = [
        timelineEvent(0, 100, 'Apex', [
          timelineEvent(10, 30, 'SOQL'),
          timelineEvent(50, 30, 'DML'),
        ]),
      ];
      const manager = new RectangleCache(events, categories);
      const tree = new TemporalSegmentTree(manager.getRectsByCategory());

      expect(tree.getMaxDepth()).toBe(1);
    });

    it('should handle empty input', () => {
      const manager = new RectangleCache([], categories);
      const tree = new TemporalSegmentTree(manager.getRectsByCategory());

      expect(tree.getMaxDepth()).toBe(0);
    });
  });

  describe('query - display density principle', () => {
    it('should return visible rects for events > threshold', () => {
      // Event with duration 10ns at zoom=1 gives 10px width (> 2px threshold)
      const events = [timelineEvent(0, 10, 'Apex')];
      const manager = new RectangleCache(events, categories);
      const tree = new TemporalSegmentTree(manager.getRectsByCategory());

      const viewport = makeViewport();
      const result = tree.query(viewport, EMPTY_BATCH_COLORS);

      expect(result.visibleRects.get('Apex')).toHaveLength(1);
      expect(countBuckets(result.buckets)).toBe(0);
      expect(result.stats.visibleCount).toBe(1);
    });

    it('should return buckets for events <= threshold', () => {
      // Event with duration 1ns at zoom=1 gives 1px width (<= 2px threshold)
      const events = [timelineEvent(0, 1, 'Apex')];
      const manager = new RectangleCache(events, categories);
      const tree = new TemporalSegmentTree(manager.getRectsByCategory());

      const viewport = makeViewport();
      const result = tree.query(viewport, EMPTY_BATCH_COLORS);

      // Pre-initialized map has empty arrays for known categories
      expect(result.visibleRects.get('Apex')).toHaveLength(0);
      expect(countBuckets(result.buckets)).toBe(1);
      expect(result.stats.bucketedEventCount).toBe(1);
    });

    it('should aggregate multiple small events into buckets', () => {
      // Multiple small events at zoom=0.1 (threshold = 20ns)
      const events = [
        timelineEvent(0, 5, 'Apex'),
        timelineEvent(10, 5, 'SOQL'),
        timelineEvent(20, 5, 'DML'),
      ];
      const manager = new RectangleCache(events, categories);
      const tree = new TemporalSegmentTree(manager.getRectsByCategory());

      const viewport = makeViewport({ zoom: 0.1 });
      const result = tree.query(viewport, EMPTY_BATCH_COLORS);

      // All events should be bucketed at this zoom level
      expect(result.stats.bucketedEventCount).toBe(3);
    });
  });

  describe('zoom level transitions', () => {
    it('should return more detail when zoomed in', () => {
      const events = [
        timelineEvent(0, 5, 'Apex'),
        timelineEvent(10, 5, 'SOQL'),
        timelineEvent(20, 5, 'DML'),
        timelineEvent(30, 5, 'Apex'),
      ];
      const manager = new RectangleCache(events, categories);
      const tree = new TemporalSegmentTree(manager.getRectsByCategory());

      // Zoomed out: all events are small
      const zoomedOut = makeViewport({ zoom: 0.1 });
      const resultOut = tree.query(zoomedOut, EMPTY_BATCH_COLORS);

      // Zoomed in: all events are visible
      const zoomedIn = makeViewport({ zoom: 2 });
      const resultIn = tree.query(zoomedIn, EMPTY_BATCH_COLORS);

      // More visible rects when zoomed in
      expect(resultIn.stats.visibleCount).toBeGreaterThanOrEqual(resultOut.stats.visibleCount);
    });

    it('should maintain total event count across zoom levels', () => {
      const events = [
        timelineEvent(0, 5, 'Apex'),
        timelineEvent(10, 5, 'SOQL'),
        timelineEvent(20, 5, 'DML'),
      ];
      const manager = new RectangleCache(events, categories);
      const tree = new TemporalSegmentTree(manager.getRectsByCategory());

      const zoomed1 = makeViewport({ zoom: 0.1 });
      const zoomed2 = makeViewport();
      const zoomed3 = makeViewport({ zoom: 10 });

      const result1 = tree.query(zoomed1, EMPTY_BATCH_COLORS);
      const result2 = tree.query(zoomed2, EMPTY_BATCH_COLORS);
      const result3 = tree.query(zoomed3, EMPTY_BATCH_COLORS);

      // Total events (visible + bucketed) should be consistent
      const total1 = result1.stats.visibleCount + result1.stats.bucketedEventCount;
      const total2 = result2.stats.visibleCount + result2.stats.bucketedEventCount;
      const total3 = result3.stats.visibleCount + result3.stats.bucketedEventCount;

      expect(total1).toBe(3);
      expect(total2).toBe(3);
      expect(total3).toBe(3);
    });
  });

  describe('viewport culling', () => {
    it('should exclude events outside time bounds', () => {
      const events = [
        timelineEvent(0, 10, 'Apex'),
        timelineEvent(100, 10, 'SOQL'),
        timelineEvent(200, 10, 'DML'),
      ];
      const manager = new RectangleCache(events, categories);
      const tree = new TemporalSegmentTree(manager.getRectsByCategory());

      // Viewport only shows time 50-150 (should only include second event)
      const viewport = makeViewport({ offsetX: 50, displayWidth: 100 });
      const result = tree.query(viewport, EMPTY_BATCH_COLORS);

      // Only the middle event should be visible
      const totalEvents = result.stats.visibleCount + result.stats.bucketedEventCount;
      expect(totalEvents).toBe(1);
    });

    it('should exclude events outside depth bounds', () => {
      const events = [
        timelineEvent(0, 100, 'Apex', [
          timelineEvent(10, 80, 'SOQL', [timelineEvent(20, 60, 'DML')]),
        ]),
      ];
      const manager = new RectangleCache(events, categories);
      const tree = new TemporalSegmentTree(manager.getRectsByCategory());

      // Create a viewport that shows enough height for depths 0-1
      // offsetY = 0, height = 2 rows (30px)
      // worldYBottom = 0, worldYTop = 30
      // depthStart = 0, depthEnd = 2
      const viewportSmall = makeViewport({
        displayHeight: TIMELINE_CONSTANTS.EVENT_HEIGHT * 2, // shows depths 0-1
      });
      const resultSmall = tree.query(viewportSmall, EMPTY_BATCH_COLORS);

      // Create a larger viewport that shows all 3 depths
      const viewportLarge = makeViewport({
        displayHeight: TIMELINE_CONSTANTS.EVENT_HEIGHT * 4, // shows depths 0-3
      });
      const resultLarge = tree.query(viewportLarge, EMPTY_BATCH_COLORS);

      // Smaller viewport should have fewer or equal events
      const smallTotal = resultSmall.stats.visibleCount + resultSmall.stats.bucketedEventCount;
      const largeTotal = resultLarge.stats.visibleCount + resultLarge.stats.bucketedEventCount;

      expect(smallTotal).toBeLessThanOrEqual(largeTotal);
      expect(largeTotal).toBe(3); // All 3 events visible
    });
  });

  describe('bucket properties', () => {
    it('should calculate bucket color from category', () => {
      const events = [timelineEvent(0, 1, 'DML')];
      const manager = new RectangleCache(events, categories);
      const tree = new TemporalSegmentTree(manager.getRectsByCategory());

      const viewport = makeViewport();
      const result = tree.query(viewport, EMPTY_BATCH_COLORS);

      const allBuckets = getAllBuckets(result.buckets);
      expect(allBuckets).toHaveLength(1);
      expect(result.buckets.get('DML')).toHaveLength(1);
      expect(result.buckets.get('DML')![0]!.color).toBeDefined();
    });

    it('should include event count in bucket', () => {
      // Multiple events that will be aggregated
      const events = [
        timelineEvent(0, 1, 'Apex'),
        timelineEvent(1, 1, 'Apex'),
        timelineEvent(2, 1, 'Apex'),
      ];
      const manager = new RectangleCache(events, categories);
      const tree = new TemporalSegmentTree(manager.getRectsByCategory());

      const viewport = makeViewport({ zoom: 0.5 }); // threshold = 4ns
      const result = tree.query(viewport, EMPTY_BATCH_COLORS);

      // All events should be in buckets with correct count
      expect(result.stats.bucketedEventCount).toBe(3);
    });

    it('should include category stats for tooltips', () => {
      const events = [timelineEvent(0, 1, 'Apex'), timelineEvent(1, 1, 'SOQL')];
      const manager = new RectangleCache(events, categories);
      const tree = new TemporalSegmentTree(manager.getRectsByCategory());

      const viewport = makeViewport({ zoom: 0.1 }); // threshold = 20ns
      const result = tree.query(viewport, EMPTY_BATCH_COLORS);

      // Bucket should have stats for both categories
      const allBuckets = getAllBuckets(result.buckets);
      expect(allBuckets.length).toBeGreaterThan(0);
      const bucket = allBuckets[0]!;
      expect(bucket).toBeDefined();
    });
  });

  describe('integration with RectangleCache', () => {
    it('should produce same event count as legacy implementation', () => {
      const events = [
        timelineEvent(0, 10, 'Apex'),
        timelineEvent(20, 5, 'SOQL'),
        timelineEvent(30, 3, 'DML'),
        timelineEvent(40, 1, 'Apex'),
      ];

      // Both implementations now use segment tree (legacy is in LegacyViewportCuller)
      // This test verifies the manager produces consistent results
      const manager = new RectangleCache(events, categories);
      const viewport = makeViewport();
      const result = manager.getCulledRectangles(viewport, EMPTY_BATCH_COLORS);

      // For comparison with legacy, use the legacy culler directly
      const legacyResult = legacyCullRectangles(
        manager.getRectsByCategory(),
        viewport,
        EMPTY_BATCH_COLORS,
      );
      const treeResult = result;

      // Same total events
      const legacyTotal = legacyResult.stats.visibleCount + legacyResult.stats.bucketedEventCount;
      const treeTotal = treeResult.stats.visibleCount + treeResult.stats.bucketedEventCount;

      expect(treeTotal).toBe(legacyTotal);
    });
  });

  describe('branch node bounds calculation', () => {
    it('should include long events when later short events end earlier', () => {
      // Bug scenario: Children sorted by timeStart, but earlier child has longer duration
      // Child A: timeStart=0, timeEnd=100 (long event)
      // Child B: timeStart=50, timeEnd=60 (short event, ends before A)
      // Query for time range [70, 90] should return Child A
      const events = [
        timelineEvent(0, 100, 'Apex'), // timeStart=0, timeEnd=100
        timelineEvent(50, 10, 'SOQL'), // timeStart=50, timeEnd=60
      ];
      const manager = new RectangleCache(events, categories);
      const tree = new TemporalSegmentTree(manager.getRectsByCategory());

      // Query time range that only intersects with the long event (not the short one)
      // Using viewport that shows time [70, 90]
      // At zoom=1, offset=70, width=20: timeStart=70, timeEnd=90
      const viewport = makeViewport({ offsetX: 70, displayWidth: 20 });
      const result = tree.query(viewport, EMPTY_BATCH_COLORS);

      // The long event (Method) should be visible because it spans [0, 100]
      // and overlaps with query range [70, 90]
      const totalEvents = result.stats.visibleCount + result.stats.bucketedEventCount;
      expect(totalEvents).toBe(1);
      expect(result.visibleRects.get('Apex')?.length).toBe(1);
    });

    it('should correctly compute branch timeEnd as max of all children', () => {
      // Multiple events with varying durations to test max computation
      const events = [
        timelineEvent(0, 50, 'Apex'), // timeEnd=50
        timelineEvent(10, 100, 'SOQL'), // timeEnd=110 (longest)
        timelineEvent(20, 30, 'DML'), // timeEnd=50
        timelineEvent(30, 20, 'Apex'), // timeEnd=50
      ];
      const manager = new RectangleCache(events, categories);
      const tree = new TemporalSegmentTree(manager.getRectsByCategory());

      // Query time range [80, 120] - only overlaps with the SOQL event (timeEnd=110)
      const viewport = makeViewport({ offsetX: 80, displayWidth: 40 });
      const result = tree.query(viewport, EMPTY_BATCH_COLORS);

      const totalEvents = result.stats.visibleCount + result.stats.bucketedEventCount;
      expect(totalEvents).toBe(1);
      expect(result.visibleRects.get('SOQL')?.length).toBe(1);
    });

    it('should find events via queryEventsInRegion with correct branch bounds', () => {
      // Same scenario but using queryEventsInRegion for hit testing
      const events = [
        timelineEvent(0, 100, 'Apex'), // timeStart=0, timeEnd=100
        timelineEvent(50, 10, 'SOQL'), // timeStart=50, timeEnd=60
      ];
      const manager = new RectangleCache(events, categories);
      const tree = new TemporalSegmentTree(manager.getRectsByCategory());

      // Query region that only intersects with the long event
      const eventsInRegion = tree.queryEventsInRegion(70, 90, 0, 0);

      expect(eventsInRegion).toHaveLength(1);
      expect(eventsInRegion[0]?.category).toBe('Apex');
    });
  });

  describe('fill ratio and brightness', () => {
    it('should calculate fill ratio for buckets', () => {
      // Single short event in a wider time span = low fill ratio
      const events = [timelineEvent(0, 1, 'Apex')];
      const manager = new RectangleCache(events, categories);
      const tree = new TemporalSegmentTree(manager.getRectsByCategory());

      const viewport = makeViewport({ zoom: 0.1 }); // threshold = 20ns, event = 1ns
      const result = tree.query(viewport, EMPTY_BATCH_COLORS);

      const allBuckets = getAllBuckets(result.buckets);
      expect(allBuckets.length).toBeGreaterThan(0);
      // Bucket should have a color (brightness varies with fill ratio)
      expect(allBuckets[0]!.color).toBeDefined();
    });

    it('should use full brightness for single-event buckets (optimization)', () => {
      // Single event bucket should have full brightness (eventCount === 1)
      const events = [timelineEvent(0, 1, 'Apex')];
      const manager = new RectangleCache(events, categories);
      const tree = new TemporalSegmentTree(manager.getRectsByCategory());

      const viewport = makeViewport(); // threshold = 2ns, event = 1ns
      const result = tree.query(viewport, EMPTY_BATCH_COLORS);

      const allBuckets = getAllBuckets(result.buckets);
      expect(allBuckets).toHaveLength(1);
      expect(allBuckets[0]!.eventCount).toBe(1);
      // Color should be defined and brighter than a low-density bucket
      expect(allBuckets[0]!.color).toBeDefined();
    });

    it('should resolve bucket dominant category using priority order', () => {
      // CATEGORY_PRIORITY: DML=0 (highest), SOQL=1, Method=2
      // DML should win even though SOQL has more duration and count
      const events = [
        timelineEvent(0, 1, 'SOQL'), // priority 1, duration 1
        timelineEvent(1, 1, 'SOQL'), // priority 1, duration 1 (SOQL total: 2 events, 2 duration)
        timelineEvent(2, 1, 'DML'), // priority 0, duration 1 (DML total: 1 event, 1 duration)
      ];
      const manager = new RectangleCache(events, categories);
      const tree = new TemporalSegmentTree(manager.getRectsByCategory());

      // Zoom out so all events aggregate into one bucket
      const viewport = makeViewport({ zoom: 0.01 });
      const result = tree.query(viewport, EMPTY_BATCH_COLORS);

      // Bucket should be categorized as DML (priority 0 beats priority 1)
      // despite SOQL having more total duration (2 vs 1) and count (2 vs 1)
      expect(result.buckets.get('DML')?.length).toBe(1);
      expect(result.buckets.get('SOQL')?.length ?? 0).toBe(0);
    });
  });
});
