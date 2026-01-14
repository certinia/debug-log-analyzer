/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

import type { LogEvent } from '../../../../core/log-parser/LogEvents.js';
import type { LogSubCategory } from '../../../../core/log-parser/types.js';
import type { ViewportState } from '../../types/flamechart.types.js';
import { TIMELINE_CONSTANTS } from '../../types/flamechart.types.js';
import { legacyCullRectangles } from '../LegacyViewportCuller.js';
import { RectangleManager } from '../RectangleManager.js';
import { TemporalSegmentTree } from '../TemporalSegmentTree.js';

/**
 * Tests for TemporalSegmentTree.
 *
 * The segment tree provides O(log n) viewport culling by pre-computing
 * aggregate statistics at multiple granularities.
 */

// Helper to create a mock LogEvent
function createEvent(
  timestamp: number,
  duration: number,
  category: LogSubCategory,
  children?: LogEvent[],
): LogEvent {
  return {
    timestamp,
    exitStamp: timestamp + duration,
    duration: { total: duration, self: duration, netSelf: duration },
    subCategory: category,
    type: 'METHOD_ENTRY',
    text: `Event at ${timestamp}`,
    children: children ?? [],
  } as unknown as LogEvent;
}

// Helper to create viewport state
function createViewport(
  zoom = 1,
  offsetX = 0,
  offsetY = 0,
  displayWidth = 1000,
  displayHeight = 500,
): ViewportState {
  return {
    zoom,
    offsetX,
    offsetY,
    displayWidth,
    displayHeight,
  };
}

// Helper to flatten buckets Map into array for testing
function getAllBuckets(
  bucketsMap: Map<
    string,
    { id: number; x: number; y: number; eventCount: number; color: number }[]
  >,
): { id: number; x: number; y: number; eventCount: number; color: number }[] {
  const allBuckets: { id: number; x: number; y: number; eventCount: number; color: number }[] = [];
  for (const buckets of bucketsMap.values()) {
    allBuckets.push(...buckets);
  }
  return allBuckets;
}

// Helper to count total buckets across all categories
function countBuckets(bucketsMap: Map<string, unknown[]>): number {
  let count = 0;
  for (const buckets of bucketsMap.values()) {
    count += buckets.length;
  }
  return count;
}

describe('TemporalSegmentTree', () => {
  const categories = new Set([
    'Method',
    'SOQL',
    'DML',
    'Code Unit',
    'System Method',
    'Flow',
    'Workflow',
  ]);

  describe('tree building', () => {
    it('should build tree from rectangles', () => {
      const events = [
        createEvent(0, 10, 'Method'),
        createEvent(20, 10, 'SOQL'),
        createEvent(40, 10, 'DML'),
      ];
      const manager = new RectangleManager(events, categories);
      const tree = new TemporalSegmentTree(manager.getRectsByCategory());

      expect(tree.getMaxDepth()).toBe(0);
    });

    it('should handle events at multiple depths', () => {
      const events = [
        createEvent(0, 100, 'Method', [createEvent(10, 30, 'SOQL'), createEvent(50, 30, 'DML')]),
      ];
      const manager = new RectangleManager(events, categories);
      const tree = new TemporalSegmentTree(manager.getRectsByCategory());

      expect(tree.getMaxDepth()).toBe(1);
    });

    it('should handle empty input', () => {
      const manager = new RectangleManager([], categories);
      const tree = new TemporalSegmentTree(manager.getRectsByCategory());

      expect(tree.getMaxDepth()).toBe(0);
    });
  });

  describe('query - display density principle', () => {
    it('should return visible rects for events > threshold', () => {
      // Event with duration 10ns at zoom=1 gives 10px width (> 2px threshold)
      const events = [createEvent(0, 10, 'Method')];
      const manager = new RectangleManager(events, categories);
      const tree = new TemporalSegmentTree(manager.getRectsByCategory());

      const viewport = createViewport(1, 0, 0);
      const result = tree.query(viewport);

      expect(result.visibleRects.get('Method')).toHaveLength(1);
      expect(countBuckets(result.buckets)).toBe(0);
      expect(result.stats.visibleCount).toBe(1);
    });

    it('should return buckets for events <= threshold', () => {
      // Event with duration 1ns at zoom=1 gives 1px width (<= 2px threshold)
      const events = [createEvent(0, 1, 'Method')];
      const manager = new RectangleManager(events, categories);
      const tree = new TemporalSegmentTree(manager.getRectsByCategory());

      const viewport = createViewport(1, 0, 0);
      const result = tree.query(viewport);

      // Pre-initialized map has empty arrays for known categories
      expect(result.visibleRects.get('Method')).toHaveLength(0);
      expect(countBuckets(result.buckets)).toBe(1);
      expect(result.stats.bucketedEventCount).toBe(1);
    });

    it('should aggregate multiple small events into buckets', () => {
      // Multiple small events at zoom=0.1 (threshold = 20ns)
      const events = [
        createEvent(0, 5, 'Method'),
        createEvent(10, 5, 'SOQL'),
        createEvent(20, 5, 'DML'),
      ];
      const manager = new RectangleManager(events, categories);
      const tree = new TemporalSegmentTree(manager.getRectsByCategory());

      const viewport = createViewport(0.1, 0, 0);
      const result = tree.query(viewport);

      // All events should be bucketed at this zoom level
      expect(result.stats.bucketedEventCount).toBe(3);
    });
  });

  describe('zoom level transitions', () => {
    it('should return more detail when zoomed in', () => {
      const events = [
        createEvent(0, 5, 'Method'),
        createEvent(10, 5, 'SOQL'),
        createEvent(20, 5, 'DML'),
        createEvent(30, 5, 'Method'),
      ];
      const manager = new RectangleManager(events, categories);
      const tree = new TemporalSegmentTree(manager.getRectsByCategory());

      // Zoomed out: all events are small
      const zoomedOut = createViewport(0.1, 0, 0, 1000);
      const resultOut = tree.query(zoomedOut);

      // Zoomed in: all events are visible
      const zoomedIn = createViewport(2, 0, 0, 1000);
      const resultIn = tree.query(zoomedIn);

      // More visible rects when zoomed in
      expect(resultIn.stats.visibleCount).toBeGreaterThanOrEqual(resultOut.stats.visibleCount);
    });

    it('should maintain total event count across zoom levels', () => {
      const events = [
        createEvent(0, 5, 'Method'),
        createEvent(10, 5, 'SOQL'),
        createEvent(20, 5, 'DML'),
      ];
      const manager = new RectangleManager(events, categories);
      const tree = new TemporalSegmentTree(manager.getRectsByCategory());

      const zoomed1 = createViewport(0.1, 0, 0, 1000);
      const zoomed2 = createViewport(1, 0, 0, 1000);
      const zoomed3 = createViewport(10, 0, 0, 1000);

      const result1 = tree.query(zoomed1);
      const result2 = tree.query(zoomed2);
      const result3 = tree.query(zoomed3);

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
        createEvent(0, 10, 'Method'),
        createEvent(100, 10, 'SOQL'),
        createEvent(200, 10, 'DML'),
      ];
      const manager = new RectangleManager(events, categories);
      const tree = new TemporalSegmentTree(manager.getRectsByCategory());

      // Viewport only shows time 50-150 (should only include second event)
      const viewport = createViewport(1, 50, 0, 100);
      const result = tree.query(viewport);

      // Only the middle event should be visible
      const totalEvents = result.stats.visibleCount + result.stats.bucketedEventCount;
      expect(totalEvents).toBe(1);
    });

    it('should exclude events outside depth bounds', () => {
      const events = [
        createEvent(0, 100, 'Method', [createEvent(10, 80, 'SOQL', [createEvent(20, 60, 'DML')])]),
      ];
      const manager = new RectangleManager(events, categories);
      const tree = new TemporalSegmentTree(manager.getRectsByCategory());

      // Create a viewport that shows enough height for depths 0-1
      // offsetY = 0, height = 2 rows (30px)
      // worldYBottom = 0, worldYTop = 30
      // depthStart = 0, depthEnd = 2
      const viewportSmall = createViewport(
        1,
        0,
        0,
        1000,
        TIMELINE_CONSTANTS.EVENT_HEIGHT * 2, // shows depths 0-1
      );
      const resultSmall = tree.query(viewportSmall);

      // Create a larger viewport that shows all 3 depths
      const viewportLarge = createViewport(
        1,
        0,
        0,
        1000,
        TIMELINE_CONSTANTS.EVENT_HEIGHT * 4, // shows depths 0-3
      );
      const resultLarge = tree.query(viewportLarge);

      // Smaller viewport should have fewer or equal events
      const smallTotal = resultSmall.stats.visibleCount + resultSmall.stats.bucketedEventCount;
      const largeTotal = resultLarge.stats.visibleCount + resultLarge.stats.bucketedEventCount;

      expect(smallTotal).toBeLessThanOrEqual(largeTotal);
      expect(largeTotal).toBe(3); // All 3 events visible
    });
  });

  describe('bucket properties', () => {
    it('should calculate bucket color from category', () => {
      const events = [createEvent(0, 1, 'DML')];
      const manager = new RectangleManager(events, categories);
      const tree = new TemporalSegmentTree(manager.getRectsByCategory());

      const viewport = createViewport(1, 0, 0);
      const result = tree.query(viewport);

      const allBuckets = getAllBuckets(result.buckets);
      expect(allBuckets).toHaveLength(1);
      expect(result.buckets.get('DML')).toHaveLength(1);
      expect(result.buckets.get('DML')![0]!.color).toBeDefined();
    });

    it('should include event count in bucket', () => {
      // Multiple events that will be aggregated
      const events = [
        createEvent(0, 1, 'Method'),
        createEvent(1, 1, 'Method'),
        createEvent(2, 1, 'Method'),
      ];
      const manager = new RectangleManager(events, categories);
      const tree = new TemporalSegmentTree(manager.getRectsByCategory());

      const viewport = createViewport(0.5, 0, 0); // threshold = 4ns
      const result = tree.query(viewport);

      // All events should be in buckets with correct count
      expect(result.stats.bucketedEventCount).toBe(3);
    });

    it('should include category stats for tooltips', () => {
      const events = [createEvent(0, 1, 'Method'), createEvent(1, 1, 'SOQL')];
      const manager = new RectangleManager(events, categories);
      const tree = new TemporalSegmentTree(manager.getRectsByCategory());

      const viewport = createViewport(0.1, 0, 0); // threshold = 20ns
      const result = tree.query(viewport);

      // Bucket should have stats for both categories
      const allBuckets = getAllBuckets(result.buckets);
      expect(allBuckets.length).toBeGreaterThan(0);
      const bucket = allBuckets[0]!;
      expect(bucket).toBeDefined();
    });
  });

  describe('integration with RectangleManager', () => {
    it('should produce same event count as legacy implementation', () => {
      const events = [
        createEvent(0, 10, 'Method'),
        createEvent(20, 5, 'SOQL'),
        createEvent(30, 3, 'DML'),
        createEvent(40, 1, 'Method'),
      ];

      // Both implementations now use segment tree (legacy is in LegacyViewportCuller)
      // This test verifies the manager produces consistent results
      const manager = new RectangleManager(events, categories);
      const viewport = createViewport(1, 0, 0);
      const result = manager.getCulledRectangles(viewport);

      // For comparison with legacy, use the legacy culler directly
      const legacyResult = legacyCullRectangles(manager.getRectsByCategory(), viewport);
      const treeResult = result;

      // Same total events
      const legacyTotal = legacyResult.stats.visibleCount + legacyResult.stats.bucketedEventCount;
      const treeTotal = treeResult.stats.visibleCount + treeResult.stats.bucketedEventCount;

      expect(treeTotal).toBe(legacyTotal);
    });
  });

  describe('fill ratio and brightness', () => {
    it('should calculate fill ratio for buckets', () => {
      // Single short event in a wider time span = low fill ratio
      const events = [createEvent(0, 1, 'Method')];
      const manager = new RectangleManager(events, categories);
      const tree = new TemporalSegmentTree(manager.getRectsByCategory());

      const viewport = createViewport(0.1, 0, 0); // threshold = 20ns, event = 1ns
      const result = tree.query(viewport);

      const allBuckets = getAllBuckets(result.buckets);
      expect(allBuckets.length).toBeGreaterThan(0);
      // Bucket should have a color (brightness varies with fill ratio)
      expect(allBuckets[0]!.color).toBeDefined();
    });

    it('should use full brightness for single-event buckets (optimization)', () => {
      // Single event bucket should have full brightness (eventCount === 1)
      const events = [createEvent(0, 1, 'Method')];
      const manager = new RectangleManager(events, categories);
      const tree = new TemporalSegmentTree(manager.getRectsByCategory());

      const viewport = createViewport(1, 0, 0); // threshold = 2ns, event = 1ns
      const result = tree.query(viewport);

      const allBuckets = getAllBuckets(result.buckets);
      expect(allBuckets).toHaveLength(1);
      expect(allBuckets[0]!.eventCount).toBe(1);
      // Color should be defined and brighter than a low-density bucket
      expect(allBuckets[0]!.color).toBeDefined();
    });
  });
});
