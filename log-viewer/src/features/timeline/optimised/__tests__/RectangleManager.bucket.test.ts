/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

import type { LogEvent } from '../../../../core/log-parser/LogEvents.js';
import type { LogSubCategory } from '../../../../core/log-parser/types.js';
import type { ViewportState } from '../../types/flamechart.types.js';
import { BUCKET_CONSTANTS, TIMELINE_CONSTANTS } from '../../types/flamechart.types.js';
import { RectangleManager } from '../RectangleManager.js';

/**
 * Tests for RectangleManager bucket aggregation.
 *
 * When events are smaller than MIN_RECT_SIZE (2px) at the current zoom level,
 * they are aggregated into time-aligned buckets for "barcode" rendering.
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

describe('RectangleManager bucket aggregation', () => {
  const categories = new Set([
    'Method',
    'SOQL',
    'DML',
    'Code Unit',
    'System Method',
    'Flow',
    'Workflow',
  ]);

  describe('event size classification', () => {
    it('should return events > 2px in visibleRects', () => {
      // Event with duration 3ns at zoom=1 gives 3px width (> MIN_RECT_SIZE)
      const events = [createEvent(0, 3, 'Method')];
      const manager = new RectangleManager(events, categories);

      const viewport = createViewport(1, 0, 0);
      const result = manager.getCulledRectangles(viewport);

      expect(result.visibleRects.get('Method')).toHaveLength(1);
      expect(result.buckets).toHaveLength(0);
      expect(result.stats.visibleCount).toBe(1);
      expect(result.stats.bucketedEventCount).toBe(0);
    });

    it('should aggregate events <= 2px into buckets', () => {
      // Event with duration 1ns at zoom=1 gives 1px width (<= MIN_RECT_SIZE)
      const events = [createEvent(0, 1, 'Method')];
      const manager = new RectangleManager(events, categories);

      const viewport = createViewport(1, 0, 0);
      const result = manager.getCulledRectangles(viewport);

      expect(result.visibleRects.get('Method')).toBeUndefined();
      expect(result.buckets).toHaveLength(1);
      expect(result.stats.visibleCount).toBe(0);
      expect(result.stats.bucketedEventCount).toBe(1);
    });

    it('should correctly separate visible and bucketed events', () => {
      const events = [
        createEvent(0, 5, 'Method'), // 5px at zoom=1 - visible
        createEvent(10, 1, 'Method'), // 1px at zoom=1 - bucketed
        createEvent(20, 3, 'SOQL'), // 3px at zoom=1 - visible
        createEvent(30, 0.5, 'SOQL'), // 0.5px at zoom=1 - bucketed
      ];
      const manager = new RectangleManager(events, categories);

      const viewport = createViewport(1, 0, 0);
      const result = manager.getCulledRectangles(viewport);

      expect(result.visibleRects.get('Method')).toHaveLength(1);
      expect(result.visibleRects.get('SOQL')).toHaveLength(1);
      expect(result.stats.visibleCount).toBe(2);
      expect(result.stats.bucketedEventCount).toBe(2);
    });
  });

  describe('bucket time alignment', () => {
    it('should create time-aligned bucket boundaries', () => {
      // At zoom=1, bucket width is 2ns (2px / 1)
      const events = [createEvent(5, 1, 'Method')]; // Event at timestamp 5
      const manager = new RectangleManager(events, categories);

      const viewport = createViewport(1, 0, 0);
      const result = manager.getCulledRectangles(viewport);

      expect(result.buckets).toHaveLength(1);
      const bucket = result.buckets[0]!;
      // bucketIndex = floor(5 / 2) = 2
      // timeStart = 2 * 2 = 4
      // timeEnd = 3 * 2 = 6
      expect(bucket.timeStart).toBe(4);
      expect(bucket.timeEnd).toBe(6);
    });

    it('should group events in same time bucket together', () => {
      // Two events at timestamps 4 and 5 should be in same bucket (index 2, range [4,6))
      const events = [createEvent(4, 1, 'Method'), createEvent(5, 1, 'Method')];
      const manager = new RectangleManager(events, categories);

      const viewport = createViewport(1, 0, 0);
      const result = manager.getCulledRectangles(viewport);

      expect(result.buckets).toHaveLength(1);
      expect(result.buckets[0]!.eventCount).toBe(2);
      expect(result.buckets[0]!.eventRefs).toHaveLength(2);
    });

    it('should create separate buckets for different time ranges', () => {
      // Events at timestamps 0 and 10 should be in different buckets
      const events = [
        createEvent(0, 1, 'Method'), // bucket index 0
        createEvent(10, 1, 'Method'), // bucket index 5
      ];
      const manager = new RectangleManager(events, categories);

      const viewport = createViewport(1, 0, 0);
      const result = manager.getCulledRectangles(viewport);

      expect(result.buckets).toHaveLength(2);
    });
  });

  describe('bucket depth handling', () => {
    it('should create separate buckets per depth level', () => {
      // Parent and child at same time but different depths
      const child = createEvent(0, 1, 'SOQL');
      const parent = createEvent(0, 1, 'Method', [child]);
      const events = [parent];
      const manager = new RectangleManager(events, categories);

      const viewport = createViewport(1, 0, 0);
      const result = manager.getCulledRectangles(viewport);

      // Should have 2 buckets (one per depth)
      expect(result.buckets).toHaveLength(2);

      const depths = result.buckets.map((b) => b.depth).sort();
      expect(depths).toEqual([0, 1]);
    });

    it('should set correct Y position based on depth', () => {
      const events = [createEvent(0, 1, 'Method')];
      const manager = new RectangleManager(events, categories);

      const viewport = createViewport(1, 0, 0);
      const result = manager.getCulledRectangles(viewport);

      expect(result.buckets[0]!.y).toBe(0); // depth 0 * EVENT_HEIGHT

      // Test depth 1
      const child = createEvent(0, 1, 'SOQL');
      const parent = createEvent(0, 2, 'Method', [child]); // parent is visible
      const events2 = [parent];
      const manager2 = new RectangleManager(events2, categories);

      // At zoom=0.5, parent (2ns) becomes 1px (bucketed), child (1ns) becomes 0.5px (bucketed)
      const viewport2 = createViewport(0.5, 0, 0);
      const result2 = manager2.getCulledRectangles(viewport2);

      const childBucket = result2.buckets.find((b) => b.depth === 1);
      expect(childBucket?.y).toBe(TIMELINE_CONSTANTS.EVENT_HEIGHT);
    });
  });

  describe('bucket category statistics', () => {
    it('should track event counts per category', () => {
      const events = [
        createEvent(0, 1, 'Method'),
        createEvent(1, 1, 'SOQL'),
        createEvent(0.5, 1, 'Method'),
      ];
      const manager = new RectangleManager(events, categories);

      const viewport = createViewport(1, 0, 0);
      const result = manager.getCulledRectangles(viewport);

      // All 3 events at zoom=1 with duration 1ns are < 2px, so all bucketed
      // At bucket width 2ns, events at 0, 0.5, 1 are all in bucket index 0
      expect(result.buckets.length).toBeGreaterThanOrEqual(1);
      const bucket = result.buckets[0]!;

      expect(bucket.categoryStats.byCategory.get('Method')?.count).toBe(2);
      expect(bucket.categoryStats.byCategory.get('SOQL')?.count).toBe(1);
    });

    it('should track total duration per category', () => {
      const events = [createEvent(0, 1, 'Method'), createEvent(0.5, 0.5, 'Method')];
      const manager = new RectangleManager(events, categories);

      const viewport = createViewport(1, 0, 0);
      const result = manager.getCulledRectangles(viewport);

      const bucket = result.buckets[0]!;
      expect(bucket.categoryStats.byCategory.get('Method')?.totalDuration).toBe(1.5);
    });
  });

  describe('bucket color resolution', () => {
    it('should prioritize DML over Method in mixed bucket', () => {
      const events = [createEvent(0, 1, 'Method'), createEvent(0.5, 1, 'DML')];
      const manager = new RectangleManager(events, categories);

      const viewport = createViewport(1, 0, 0);
      const result = manager.getCulledRectangles(viewport);

      const bucket = result.buckets[0]!;
      expect(bucket.categoryStats.dominantCategory).toBe('DML');
      // DML color is 0xB06868
      expect(bucket.color).toBe(0xb06868);
    });

    it('should prioritize SOQL over Method in mixed bucket', () => {
      const events = [createEvent(0, 1, 'Method'), createEvent(0.5, 1, 'SOQL')];
      const manager = new RectangleManager(events, categories);

      const viewport = createViewport(1, 0, 0);
      const result = manager.getCulledRectangles(viewport);

      const bucket = result.buckets[0]!;
      expect(bucket.categoryStats.dominantCategory).toBe('SOQL');
    });
  });

  describe('bucket opacity calculation', () => {
    it('should have minimum opacity for single event', () => {
      const events = [createEvent(0, 1, 'Method')];
      const manager = new RectangleManager(events, categories);

      const viewport = createViewport(1, 0, 0);
      const result = manager.getCulledRectangles(viewport);

      expect(result.buckets[0]!.opacity).toBe(BUCKET_CONSTANTS.OPACITY.MIN);
    });

    it('should have higher opacity for more events', () => {
      // Create many events in same bucket
      const events: LogEvent[] = [];
      for (let i = 0; i < 50; i++) {
        events.push(createEvent(i * 0.03, 0.01, 'Method')); // All in bucket index 0
      }
      const manager = new RectangleManager(events, categories);

      const viewport = createViewport(1, 0, 0);
      const result = manager.getCulledRectangles(viewport);

      const bucket = result.buckets[0]!;
      expect(bucket.opacity).toBeGreaterThan(BUCKET_CONSTANTS.OPACITY.MIN);
      expect(bucket.opacity).toBeLessThanOrEqual(BUCKET_CONSTANTS.OPACITY.MAX);
    });
  });

  describe('bucket event references', () => {
    it('should store references to all aggregated events', () => {
      const event1 = createEvent(0, 1, 'Method');
      const event2 = createEvent(0.5, 1, 'Method');
      const events = [event1, event2];
      const manager = new RectangleManager(events, categories);

      const viewport = createViewport(1, 0, 0);
      const result = manager.getCulledRectangles(viewport);

      const bucket = result.buckets[0]!;
      expect(bucket.eventRefs).toContain(event1);
      expect(bucket.eventRefs).toContain(event2);
    });
  });

  describe('render statistics', () => {
    it('should track correct stats', () => {
      const events = [
        createEvent(0, 5, 'Method'), // visible
        createEvent(10, 1, 'Method'), // bucketed
        createEvent(20, 1, 'SOQL'), // bucketed
      ];
      const manager = new RectangleManager(events, categories);

      const viewport = createViewport(1, 0, 0);
      const result = manager.getCulledRectangles(viewport);

      expect(result.stats.visibleCount).toBe(1);
      expect(result.stats.bucketedEventCount).toBe(2);
      expect(result.stats.bucketCount).toBe(2); // Two separate time buckets
    });

    it('should track max events per bucket', () => {
      // Create 5 events in same bucket
      const events: LogEvent[] = [];
      for (let i = 0; i < 5; i++) {
        events.push(createEvent(i * 0.3, 0.1, 'Method'));
      }
      const manager = new RectangleManager(events, categories);

      const viewport = createViewport(1, 0, 0);
      const result = manager.getCulledRectangles(viewport);

      expect(result.stats.maxEventsPerBucket).toBe(5);
    });
  });
});
