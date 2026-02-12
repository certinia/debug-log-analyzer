/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

import type { LogCategory, LogEvent } from 'apex-log-parser';
import type { ViewportState } from '../../types/flamechart.types.js';
import { TIMELINE_CONSTANTS } from '../../types/flamechart.types.js';
import { legacyCullRectangles } from '../LegacyViewportCuller.js';
import { RectangleManager } from '../RectangleManager.js';

/**
 * Tests for legacy O(n) bucket aggregation.
 *
 * These tests use the LegacyViewportCuller to test the original bucket
 * aggregation behavior. For production, RectangleManager uses TemporalSegmentTree
 * which has O(log n) performance but doesn't store eventRefs in multi-event buckets.
 *
 * When events are smaller than MIN_RECT_SIZE (2px) at the current zoom level,
 * they are aggregated into time-aligned buckets for "barcode" rendering.
 */

// Helper to create a mock LogEvent
function createEvent(
  timestamp: number,
  duration: number,
  category: LogCategory,
  children?: LogEvent[],
): LogEvent {
  return {
    timestamp,
    exitStamp: timestamp + duration,
    duration: { total: duration, self: duration, netSelf: duration },
    category,
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

// Helper to cull rectangles using the legacy O(n) algorithm
function cullRectanglesLegacy(
  events: LogEvent[],
  categories: Set<string>,
  viewport: ViewportState,
) {
  const manager = new RectangleManager(events, categories);
  return legacyCullRectangles(manager.getRectsByCategory(), viewport);
}

// Helper to flatten buckets Map into array for testing
function getAllBuckets<T>(bucketsMap: Map<string, T[]>): T[] {
  const allBuckets: T[] = [];
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

describe('Legacy bucket aggregation', () => {
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

  describe('event size classification', () => {
    it('should return events > 2px in visibleRects', () => {
      // Event with duration 3ns at zoom=1 gives 3px width (> MIN_RECT_SIZE)
      const events = [createEvent(0, 3, 'Apex')];
      const viewport = createViewport(1, 0, 0);
      const result = cullRectanglesLegacy(events, categories, viewport);

      expect(result.visibleRects.get('Apex')).toHaveLength(1);
      expect(countBuckets(result.buckets)).toBe(0);
      expect(result.stats.visibleCount).toBe(1);
      expect(result.stats.bucketedEventCount).toBe(0);
    });

    it('should aggregate events <= 2px into buckets', () => {
      // Event with duration 1ns at zoom=1 gives 1px width (<= MIN_RECT_SIZE)
      const events = [createEvent(0, 1, 'Apex')];
      const viewport = createViewport(1, 0, 0);
      const result = cullRectanglesLegacy(events, categories, viewport);

      // No visible rects (event is too small), so category has no entry
      expect(result.visibleRects.has('Apex')).toBe(false);
      expect(countBuckets(result.buckets)).toBe(1);
      expect(result.stats.visibleCount).toBe(0);
      expect(result.stats.bucketedEventCount).toBe(1);
    });

    it('should correctly separate visible and bucketed events', () => {
      const events = [
        createEvent(0, 5, 'Apex'), // 5px at zoom=1 - visible
        createEvent(10, 1, 'Apex'), // 1px at zoom=1 - bucketed
        createEvent(20, 3, 'SOQL'), // 3px at zoom=1 - visible
        createEvent(30, 0.5, 'SOQL'), // 0.5px at zoom=1 - bucketed
      ];
      const viewport = createViewport(1, 0, 0);
      const result = cullRectanglesLegacy(events, categories, viewport);

      expect(result.visibleRects.get('Apex')).toHaveLength(1);
      expect(result.visibleRects.get('SOQL')).toHaveLength(1);
      expect(result.stats.visibleCount).toBe(2);
      expect(result.stats.bucketedEventCount).toBe(2);
    });
  });

  describe('bucket time alignment', () => {
    it('should create time-aligned bucket boundaries', () => {
      // At zoom=1, bucket width is 2ns (2px / 1)
      const events = [createEvent(5, 1, 'Apex')]; // Event at timestamp 5
      const viewport = createViewport(1, 0, 0);
      const result = cullRectanglesLegacy(events, categories, viewport);

      const allBuckets = getAllBuckets(result.buckets);
      expect(allBuckets).toHaveLength(1);
      const bucket = allBuckets[0]!;
      // bucketIndex = floor(5 / 2) = 2
      // timeStart = 2 * 2 = 4
      // timeEnd = 3 * 2 = 6
      expect(bucket.timeStart).toBe(4);
      expect(bucket.timeEnd).toBe(6);
    });

    it('should group events in same time bucket together', () => {
      // Two events at timestamps 4 and 5 should be in same bucket (index 2, range [4,6))
      const events = [createEvent(4, 1, 'Apex'), createEvent(5, 1, 'Apex')];
      const viewport = createViewport(1, 0, 0);
      const result = cullRectanglesLegacy(events, categories, viewport);

      const allBuckets = getAllBuckets(result.buckets);
      expect(allBuckets).toHaveLength(1);
      expect(allBuckets[0]!.eventCount).toBe(2);
      expect(allBuckets[0]!.eventRefs).toHaveLength(2);
    });

    it('should create separate buckets for different time ranges', () => {
      // Events at timestamps 0 and 10 should be in different buckets
      const events = [
        createEvent(0, 1, 'Apex'), // bucket index 0
        createEvent(10, 1, 'Apex'), // bucket index 5
      ];
      const viewport = createViewport(1, 0, 0);
      const result = cullRectanglesLegacy(events, categories, viewport);

      expect(countBuckets(result.buckets)).toBe(2);
    });
  });

  describe('bucket depth handling', () => {
    it('should create separate buckets per depth level', () => {
      // Parent and child at same time but different depths
      const child = createEvent(0, 1, 'SOQL');
      const parent = createEvent(0, 1, 'Apex', [child]);
      const events = [parent];
      const viewport = createViewport(1, 0, 0);
      const result = cullRectanglesLegacy(events, categories, viewport);

      // Should have 2 buckets (one per depth)
      const allBuckets = getAllBuckets(result.buckets);
      expect(allBuckets).toHaveLength(2);

      const depths = allBuckets.map((b) => b.depth).sort();
      expect(depths).toEqual([0, 1]);
    });

    it('should set correct Y position based on depth', () => {
      const events = [createEvent(0, 1, 'Apex')];
      const viewport = createViewport(1, 0, 0);
      const result = cullRectanglesLegacy(events, categories, viewport);

      const allBuckets = getAllBuckets(result.buckets);
      expect(allBuckets[0]!.y).toBe(0); // depth 0 * EVENT_HEIGHT

      // Test depth 1
      const child = createEvent(0, 1, 'SOQL');
      const parent = createEvent(0, 2, 'Apex', [child]); // parent is visible
      const events2 = [parent];

      // At zoom=0.5, parent (2ns) becomes 1px (bucketed), child (1ns) becomes 0.5px (bucketed)
      const viewport2 = createViewport(0.5, 0, 0);
      const result2 = cullRectanglesLegacy(events2, categories, viewport2);

      const allBuckets2 = getAllBuckets(result2.buckets);
      const childBucket = allBuckets2.find((b) => b.depth === 1);
      expect(childBucket?.y).toBe(TIMELINE_CONSTANTS.EVENT_HEIGHT);
    });
  });

  describe('bucket category statistics', () => {
    it('should track event counts per category', () => {
      const events = [
        createEvent(0, 1, 'Apex'),
        createEvent(1, 1, 'SOQL'),
        createEvent(0.5, 1, 'Apex'),
      ];
      const viewport = createViewport(1, 0, 0);
      const result = cullRectanglesLegacy(events, categories, viewport);

      // All 3 events at zoom=1 with duration 1ns are < 2px, so all bucketed
      // At bucket width 2ns, events at 0, 0.5, 1 are all in bucket index 0
      const allBuckets = getAllBuckets(result.buckets);
      expect(allBuckets.length).toBeGreaterThanOrEqual(1);
      const bucket = allBuckets[0]!;

      expect(bucket.categoryStats.byCategory.get('Apex')?.count).toBe(2);
      expect(bucket.categoryStats.byCategory.get('SOQL')?.count).toBe(1);
    });

    it('should track total duration per category', () => {
      const events = [createEvent(0, 1, 'Apex'), createEvent(0.5, 0.5, 'Apex')];
      const viewport = createViewport(1, 0, 0);
      const result = cullRectanglesLegacy(events, categories, viewport);

      const allBuckets = getAllBuckets(result.buckets);
      const bucket = allBuckets[0]!;
      expect(bucket.categoryStats.byCategory.get('Apex')?.totalDuration).toBe(1.5);
    });
  });

  describe('bucket color resolution', () => {
    it('should prioritize DML over Method in mixed bucket', () => {
      const events = [createEvent(0, 1, 'Apex'), createEvent(0.5, 1, 'DML')];
      const viewport = createViewport(1, 0, 0);
      const result = cullRectanglesLegacy(events, categories, viewport);

      // Get bucket from DML category (dominant)
      const bucket = result.buckets.get('DML')![0]!;
      expect(bucket.categoryStats.dominantCategory).toBe('DML');
      // Color should be a valid numeric color value (pre-blended from DML color)
      expect(bucket.color).toBeGreaterThanOrEqual(0);
      expect(bucket.color).toBeLessThanOrEqual(0xffffff);
    });

    it('should prioritize SOQL over Method in mixed bucket', () => {
      const events = [createEvent(0, 1, 'Apex'), createEvent(0.5, 1, 'SOQL')];
      const viewport = createViewport(1, 0, 0);
      const result = cullRectanglesLegacy(events, categories, viewport);

      // Get bucket from SOQL category (dominant)
      const bucket = result.buckets.get('SOQL')![0]!;
      expect(bucket.categoryStats.dominantCategory).toBe('SOQL');
    });
  });

  describe('bucket color blending', () => {
    it('should have a valid color for single event', () => {
      const events = [createEvent(0, 1, 'Apex')];
      const viewport = createViewport(1, 0, 0);
      const result = cullRectanglesLegacy(events, categories, viewport);

      // Color should be a valid numeric color value (pre-blended opaque)
      const allBuckets = getAllBuckets(result.buckets);
      expect(allBuckets[0]!.color).toBeGreaterThanOrEqual(0);
      expect(allBuckets[0]!.color).toBeLessThanOrEqual(0xffffff);
    });

    it('should have same colors regardless of event count (density visualization disabled)', () => {
      // NOTE: Density-based opacity is currently disabled because it makes parent
      // events appear dimmer than child events. All buckets now render at full color.

      // Create a bucket with a single event
      const singleEvent = [createEvent(0, 1, 'Apex')];
      const singleViewport = createViewport(1, 0, 0);
      const singleResult = cullRectanglesLegacy(singleEvent, categories, singleViewport);
      const singleBuckets = getAllBuckets(singleResult.buckets);
      const singleBucketColor = singleBuckets[0]!.color;

      // Create many events in same bucket
      const manyEvents: LogEvent[] = [];
      for (let i = 0; i < 50; i++) {
        manyEvents.push(createEvent(i * 0.03, 0.01, 'Apex')); // All in bucket index 0
      }
      const manyViewport = createViewport(1, 0, 0);
      const manyResult = cullRectanglesLegacy(manyEvents, categories, manyViewport);
      const manyBuckets = getAllBuckets(manyResult.buckets);
      const manyBucketColor = manyBuckets[0]!.color;

      // Colors should be the same (density visualization disabled)
      expect(manyBucketColor).toBe(singleBucketColor);
    });
  });

  describe('bucket event references', () => {
    it('should store references to all aggregated events', () => {
      const event1 = createEvent(0, 1, 'Apex');
      const event2 = createEvent(0.5, 1, 'Apex');
      const events = [event1, event2];
      const viewport = createViewport(1, 0, 0);
      const result = cullRectanglesLegacy(events, categories, viewport);

      const allBuckets = getAllBuckets(result.buckets);
      const bucket = allBuckets[0]!;
      expect(bucket.eventRefs).toContain(event1);
      expect(bucket.eventRefs).toContain(event2);
    });
  });

  describe('render statistics', () => {
    it('should track correct stats', () => {
      const events = [
        createEvent(0, 5, 'Apex'), // visible
        createEvent(10, 1, 'Apex'), // bucketed
        createEvent(20, 1, 'SOQL'), // bucketed
      ];
      const viewport = createViewport(1, 0, 0);
      const result = cullRectanglesLegacy(events, categories, viewport);

      expect(result.stats.visibleCount).toBe(1);
      expect(result.stats.bucketedEventCount).toBe(2);
      expect(result.stats.bucketCount).toBe(2); // Two separate time buckets
    });

    it('should track max events per bucket', () => {
      // Create 5 events in same bucket
      const events: LogEvent[] = [];
      for (let i = 0; i < 5; i++) {
        events.push(createEvent(i * 0.3, 0.1, 'Apex'));
      }
      const viewport = createViewport(1, 0, 0);
      const result = cullRectanglesLegacy(events, categories, viewport);

      expect(result.stats.maxEventsPerBucket).toBe(5);
    });
  });
});
