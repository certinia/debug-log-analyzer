/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */

/**
 * Unit tests for TimelineEventIndex
 *
 * Tests event indexing and binary search functionality including:
 * - Event lookup at specific screen positions
 * - Binary search on sorted event arrays
 * - Hierarchical depth-first traversal
 * - Region-based event culling
 */

import type { LogEvent } from '../../../core/log-parser/LogEvents.js';
import { TimelineEventIndex } from '../optimised/TimelineEventIndex.js';
import type { ViewportState } from '../types/flamechart.types.js';

describe('TimelineEventIndex', () => {
  /**
   * Helper to create a mock LogEvent with duration
   */
  function createEvent(timestamp: number, duration: number, children: LogEvent[] = []): LogEvent {
    return {
      timestamp,
      exitStamp: timestamp + duration,
      duration: {
        total: duration,
        exclusive: duration,
      },
      children,
      text: `Event at ${timestamp}`,
      lineNumber: 0,
      category: 'Method',
      subcategory: 'Method',
    } as unknown as LogEvent;
  }

  /**
   * Helper to create a simple viewport state
   */
  function createViewport(
    zoom: number = 1,
    offsetX: number = 0,
    offsetY: number = 0,
  ): ViewportState {
    return {
      zoom,
      offsetX,
      offsetY,
      displayWidth: 1000,
      displayHeight: 600,
    };
  }

  describe('initialization and metadata', () => {
    it('should calculate max depth correctly for flat events', () => {
      const events = [createEvent(0, 100), createEvent(200, 100), createEvent(400, 100)];

      const index = new TimelineEventIndex(events);

      expect(index.maxDepth).toBe(0);
    });

    it('should calculate max depth correctly for nested events', () => {
      const child = createEvent(50, 20);
      const parent = createEvent(0, 100, [child]);
      const events = [parent];

      const index = new TimelineEventIndex(events);

      expect(index.maxDepth).toBe(1);
    });

    it('should calculate max depth correctly for deeply nested events', () => {
      const level3 = createEvent(30, 10);
      const level2 = createEvent(20, 40, [level3]);
      const level1 = createEvent(10, 60, [level2]);
      const level0 = createEvent(0, 100, [level1]);
      const events = [level0];

      const index = new TimelineEventIndex(events);

      expect(index.maxDepth).toBe(3);
    });

    it('should calculate total duration correctly', () => {
      const events = [createEvent(0, 100), createEvent(200, 150), createEvent(500, 200)];

      const index = new TimelineEventIndex(events);

      // Total duration should be max exitStamp
      expect(index.totalDuration).toBe(700); // 500 + 200
    });
  });

  describe('findEventAtPosition - binary search', () => {
    it('should find event at correct position with zoom=1', () => {
      // Events: [0-100], [200-300], [400-500]
      const events = [createEvent(0, 100), createEvent(200, 100), createEvent(400, 100)];

      const index = new TimelineEventIndex(events);
      const viewport = createViewport(1, 0, 0);

      // Click at screenX=50 (middle of first event)
      const event = index.findEventAtPosition(50, 300, viewport, 0, false);

      expect(event).not.toBeNull();
      expect(event?.timestamp).toBe(0);
    });

    it('should find event at correct position with zoom > 1', () => {
      // Events: [0-100], [200-300], [400-500]
      const events = [createEvent(0, 100), createEvent(200, 100), createEvent(400, 100)];

      const index = new TimelineEventIndex(events);
      const viewport = createViewport(2, 0, 0); // 2x zoom

      // With 2x zoom, event [0-100] is rendered at [0-200] screen pixels
      const event = index.findEventAtPosition(100, 300, viewport, 0, false);

      expect(event).not.toBeNull();
      expect(event?.timestamp).toBe(0);
    });

    it('should find event at correct position with pan offset', () => {
      // Events: [0-100], [200-300], [400-500]
      const events = [createEvent(0, 100), createEvent(200, 100), createEvent(400, 100)];

      const index = new TimelineEventIndex(events);
      const viewport = createViewport(1, 100, 0); // Pan 100px right

      // With offsetX=100, event [0-100] is rendered at [-100 to 0]
      // Event [200-300] is rendered at [100-200]
      const event = index.findEventAtPosition(150, 300, viewport, 0, false);

      expect(event).not.toBeNull();
      expect(event?.timestamp).toBe(200);
    });

    it('should return null when clicking between events', () => {
      // Events: [0-100], [200-300]
      const events = [createEvent(0, 100), createEvent(200, 100)];

      const index = new TimelineEventIndex(events);
      const viewport = createViewport(1, 0, 0);

      // Click at screenX=150 (gap between events)
      const event = index.findEventAtPosition(150, 300, viewport, 0, false);

      expect(event).toBeNull();
    });

    it('should return null when clicking before all events', () => {
      const events = [createEvent(100, 100), createEvent(300, 100)];

      const index = new TimelineEventIndex(events);
      const viewport = createViewport(1, 0, 0);

      // Click at screenX=50 (before first event)
      const event = index.findEventAtPosition(50, 300, viewport, 0, false);

      expect(event).toBeNull();
    });

    it('should return null when clicking after all events', () => {
      const events = [createEvent(0, 100), createEvent(200, 100)];

      const index = new TimelineEventIndex(events);
      const viewport = createViewport(1, 0, 0);

      // Click at screenX=500 (after last event)
      const event = index.findEventAtPosition(500, 300, viewport, 0, false);

      expect(event).toBeNull();
    });

    it('should respect minimum width threshold', () => {
      // Create very small event (width < 0.05 pixels)
      const events = [createEvent(0, 0.01)]; // 0.01ns duration

      const index = new TimelineEventIndex(events);
      const viewport = createViewport(1, 0, 0); // 1px per ns

      // Event width = 0.01px (below 0.05 threshold)
      const event = index.findEventAtPosition(0, 300, viewport, 0, false);

      expect(event).toBeNull();
    });

    it('should find small events when ignoring width threshold', () => {
      // Create very small event
      const events = [createEvent(0, 0.01)]; // 0.01ns duration

      const index = new TimelineEventIndex(events);
      const viewport = createViewport(1, 0, 0);

      // With shouldIgnoreWidth=true
      const event = index.findEventAtPosition(0, 300, viewport, 0, true);

      expect(event).not.toBeNull();
      expect(event?.timestamp).toBe(0);
    });
  });

  describe('findEventAtPosition - hierarchical depth search', () => {
    it('should find parent event at depth 0', () => {
      const child = createEvent(50, 20);
      const parent = createEvent(0, 100, [child]);
      const events = [parent];

      const index = new TimelineEventIndex(events);
      const viewport = createViewport(1, 0, 0);

      // Click on parent at depth 0
      const event = index.findEventAtPosition(10, 300, viewport, 0, false);

      expect(event).not.toBeNull();
      expect(event?.timestamp).toBe(0);
    });

    it('should find child event at depth 1', () => {
      const child = createEvent(50, 20);
      const parent = createEvent(0, 100, [child]);
      const events = [parent];

      const index = new TimelineEventIndex(events);
      const viewport = createViewport(1, 0, 0);

      // Click on child at depth 1
      const event = index.findEventAtPosition(60, 300, viewport, 1, false);

      expect(event).not.toBeNull();
      expect(event?.timestamp).toBe(50);
    });

    it('should not find child when searching at parent depth', () => {
      const child = createEvent(50, 20);
      const parent = createEvent(0, 100, [child]);
      const events = [parent];

      const index = new TimelineEventIndex(events);
      const viewport = createViewport(1, 0, 0);

      // Click on child position but search at depth 0 (parent level)
      const event = index.findEventAtPosition(60, 300, viewport, 0, false);

      // Should find parent, not child
      expect(event?.timestamp).toBe(0);
    });

    it('should handle deeply nested events', () => {
      const level2 = createEvent(60, 10);
      const level1 = createEvent(50, 30, [level2]);
      const level0 = createEvent(0, 100, [level1]);
      const events = [level0];

      const index = new TimelineEventIndex(events);
      const viewport = createViewport(1, 0, 0);

      // Find event at depth 2
      const event = index.findEventAtPosition(65, 300, viewport, 2, false);

      expect(event).not.toBeNull();
      expect(event?.timestamp).toBe(60);
    });

    it('should return null when target depth exceeds hierarchy', () => {
      const child = createEvent(50, 20);
      const parent = createEvent(0, 100, [child]);
      const events = [parent];

      const index = new TimelineEventIndex(events);
      const viewport = createViewport(1, 0, 0);

      // Search at depth 5 (doesn't exist)
      const event = index.findEventAtPosition(60, 300, viewport, 5, false);

      expect(event).toBeNull();
    });
  });

  describe('findEventsInRegion - culling', () => {
    it('should find all events in visible region', () => {
      const events = [createEvent(0, 100), createEvent(200, 100), createEvent(400, 100)];

      const index = new TimelineEventIndex(events);

      // Region covering all events
      const bounds = {
        timeStart: 0,
        timeEnd: 500,
        depthStart: 0,
        depthEnd: 1,
      };

      const results = index.findEventsInRegion(bounds);

      expect(results).toHaveLength(3);
    });

    it('should filter out events outside time range', () => {
      const events = [createEvent(0, 100), createEvent(200, 100), createEvent(400, 100)];

      const index = new TimelineEventIndex(events);

      // Region covering only middle event
      const bounds = {
        timeStart: 150,
        timeEnd: 350,
        depthStart: 0,
        depthEnd: 1,
      };

      const results = index.findEventsInRegion(bounds);

      expect(results).toHaveLength(1);
      expect(results[0]?.timestamp).toBe(200);
    });

    it('should filter out events outside depth range', () => {
      const child = createEvent(50, 20);
      const parent = createEvent(0, 100, [child]);
      const events = [parent];

      const index = new TimelineEventIndex(events);

      // Region at depth 0 only
      const bounds = {
        timeStart: 0,
        timeEnd: 200,
        depthStart: 0,
        depthEnd: 0,
      };

      const results = index.findEventsInRegion(bounds);

      // Should only include parent
      expect(results).toHaveLength(1);
      expect(results[0]?.timestamp).toBe(0);
    });

    it('should include nested events in region', () => {
      const child = createEvent(50, 20);
      const parent = createEvent(0, 100, [child]);
      const events = [parent];

      const index = new TimelineEventIndex(events);

      // Region covering both depths
      const bounds = {
        timeStart: 0,
        timeEnd: 200,
        depthStart: 0,
        depthEnd: 1,
      };

      const results = index.findEventsInRegion(bounds);

      expect(results).toHaveLength(2);
    });

    it('should return empty array when no events in region', () => {
      const events = [createEvent(0, 100), createEvent(200, 100)];

      const index = new TimelineEventIndex(events);

      // Region after all events
      const bounds = {
        timeStart: 500,
        timeEnd: 1000,
        depthStart: 0,
        depthEnd: 1,
      };

      const results = index.findEventsInRegion(bounds);

      expect(results).toHaveLength(0);
    });

    it('should handle partial overlap correctly', () => {
      // Event [100-200]
      const events = [createEvent(100, 100)];

      const index = new TimelineEventIndex(events);

      // Region [150-300] overlaps with event
      const bounds = {
        timeStart: 150,
        timeEnd: 300,
        depthStart: 0,
        depthEnd: 1,
      };

      const results = index.findEventsInRegion(bounds);

      expect(results).toHaveLength(1);
    });
  });

  describe('edge cases', () => {
    it('should handle empty event array', () => {
      const events: LogEvent[] = [];
      const index = new TimelineEventIndex(events);

      expect(index.maxDepth).toBe(0);
      expect(index.totalDuration).toBe(0);
    });

    it('should handle multiple events at same timestamp', () => {
      const events = [createEvent(100, 50), createEvent(100, 50), createEvent(100, 50)];

      const index = new TimelineEventIndex(events);
      const viewport = createViewport(1, 0, 0);

      // Should find one of them
      const event = index.findEventAtPosition(120, 300, viewport, 0, false);

      expect(event).not.toBeNull();
      expect(event?.timestamp).toBe(100);
    });

    it('should handle zero-duration events', () => {
      const events = [createEvent(100, 0)];

      const index = new TimelineEventIndex(events);
      const viewport = createViewport(1, 0, 0);

      // Zero-duration event has no width, can't be found normally
      const event = index.findEventAtPosition(100, 300, viewport, 0, false);

      expect(event).toBeNull();
    });

    it('should handle extremely large timestamps', () => {
      const largeTimestamp = 1_000_000_000_000; // 1 trillion ns
      const events = [createEvent(largeTimestamp, 1000)];

      const index = new TimelineEventIndex(events);

      expect(index.totalDuration).toBeGreaterThan(largeTimestamp);
    });
  });
});
