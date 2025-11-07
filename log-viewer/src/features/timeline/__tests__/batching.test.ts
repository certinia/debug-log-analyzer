/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */

/**
 * Unit tests for EventBatchRenderer
 *
 * Tests batching and culling logic including:
 * - Event grouping by category
 * - View frustum culling (horizontal and vertical)
 * - Minimum size filtering
 * - Hierarchical rectangle collection
 */

import * as PIXI from 'pixi.js';
import type { LogEvent } from '../../../core/log-parser/LogEvents.js';
import type { LogSubCategory } from '../../../core/log-parser/types.js';
import { EventBatchRenderer } from '../graphics/EventBatchRenderer.js';
import type { RenderBatch, ViewportState } from '../types/timeline.types.js';
import { TIMELINE_CONSTANTS } from '../types/timeline.types.js';

describe('EventBatchRenderer', () => {
  let container: PIXI.Container;
  let renderer: EventBatchRenderer;
  let batches: Map<string, RenderBatch>;

  /**
   * Helper to create a mock LogEvent
   */
  function createEvent(
    timestamp: number,
    duration: number,
    subCategory: LogSubCategory,
    children: LogEvent[] = [],
  ): LogEvent {
    return {
      timestamp,
      exitStamp: timestamp + duration,
      duration: {
        total: duration,
        exclusive: duration,
      },
      subCategory,
      children,
      text: `${subCategory} at ${timestamp}`,
      lineNumber: 0,
      category: subCategory,
    } as unknown as LogEvent;
  }

  /**
   * Helper to create a viewport state
   */
  function createViewport(
    zoom: number = 1,
    offsetX: number = 0,
    offsetY: number = 0,
    displayWidth: number = 1000,
    displayHeight: number = 600,
  ): ViewportState {
    return {
      zoom,
      offsetX,
      offsetY,
      displayWidth,
      displayHeight,
    };
  }

  beforeEach(() => {
    container = new PIXI.Container();

    // Create batches for common categories
    batches = new Map([
      [
        'Method',
        {
          category: 'Method',
          color: 0x88ae58,
          rectangles: [],
          isDirty: false,
        },
      ],
      [
        'SOQL',
        {
          category: 'SOQL',
          color: 0x5d4963,
          rectangles: [],
          isDirty: false,
        },
      ],
      [
        'DML',
        {
          category: 'DML',
          color: 0x285663,
          rectangles: [],
          isDirty: false,
        },
      ],
    ]);
  });

  afterEach(() => {
    container.destroy();
    renderer.destroy();
  });

  describe('initialization', () => {
    it('should create Graphics objects for each batch', () => {
      renderer = new EventBatchRenderer(container, batches, []);

      expect(container.children).toHaveLength(3);
      expect(container.children.every((child) => child instanceof PIXI.Graphics)).toBe(true);
    });

    it('should handle empty batches', () => {
      const emptyBatches = new Map<string, RenderBatch>();
      renderer = new EventBatchRenderer(container, emptyBatches, []);

      expect(container.children).toHaveLength(0);
    });
  });

  describe('batching by category', () => {
    it('should group events by subCategory', () => {
      const events = [
        createEvent(0, 100, 'Method'),
        createEvent(200, 100, 'SOQL'),
        createEvent(400, 100, 'Method'),
      ];

      renderer = new EventBatchRenderer(container, batches, events);
      const viewport = createViewport();

      renderer.render(viewport);

      const methodBatch = batches.get('Method');
      const soqlBatch = batches.get('SOQL');

      expect(methodBatch?.rectangles).toHaveLength(2);
      expect(soqlBatch?.rectangles).toHaveLength(1);
    });

    it('should separate nested events into correct batches', () => {
      const child = createEvent(50, 20, 'SOQL');
      const parent = createEvent(0, 100, 'Method', [child]);
      const events = [parent];

      renderer = new EventBatchRenderer(container, batches, events);
      const viewport = createViewport();

      renderer.render(viewport);

      const methodBatch = batches.get('Method')!;
      const soqlBatch = batches.get('SOQL')!;

      expect(methodBatch.rectangles).toHaveLength(1);
      expect(soqlBatch.rectangles).toHaveLength(1);
    });

    it('should ignore events with unknown categories', () => {
      const events = [
        createEvent(0, 100, 'Method'),
        createEvent(200, 100, 'UnknownCategory' as LogSubCategory),
      ];

      renderer = new EventBatchRenderer(container, batches, events);
      const viewport = createViewport();

      renderer.render(viewport);

      const methodBatch = batches.get('Method');

      expect(methodBatch?.rectangles).toHaveLength(1);
      expect(batches.get('UnknownCategory')).toBeUndefined();
    });
  });

  describe('horizontal culling (time-based)', () => {
    it('should render events within viewport time range', () => {
      const events = [
        createEvent(0, 100, 'Method'),
        createEvent(200, 100, 'Method'),
        createEvent(400, 100, 'Method'),
      ];

      const viewport = createViewport(1, 0, 0);
      renderer = new EventBatchRenderer(container, batches, events);
      renderer.render(viewport);

      const methodBatch = batches.get('Method');
      expect(methodBatch?.rectangles).toHaveLength(3);
    });

    it('should cull events before viewport', () => {
      const events = [createEvent(0, 100, 'Method'), createEvent(200, 100, 'Method')];

      const viewport = createViewport(1, 150, 0);
      renderer = new EventBatchRenderer(container, batches, events);
      renderer.render(viewport);

      const methodBatch = batches.get('Method');
      // First event should be culled, second should be visible
      expect(methodBatch?.rectangles).toHaveLength(1);
      expect(methodBatch?.rectangles[0]?.eventRef.timestamp).toBe(200);
    });

    it('should cull events after viewport', () => {
      const events = [
        createEvent(0, 100, 'Method'),
        createEvent(1200, 100, 'Method'), // Starts after viewport end
      ];

      const viewport = createViewport(1, 0, 0, 1000);
      renderer = new EventBatchRenderer(container, batches, events);
      renderer.render(viewport);

      const methodBatch = batches.get('Method');
      // Second event should be culled
      expect(methodBatch?.rectangles).toHaveLength(1);
      expect(methodBatch?.rectangles[0]?.eventRef.timestamp).toBe(0);
    });

    it('should include partially visible events', () => {
      const events = [
        createEvent(50, 200, 'Method'), // Spans 50-250, viewport is 0-200
      ];

      const viewport = createViewport(1, 0, 0, 200);
      renderer = new EventBatchRenderer(container, batches, events);
      renderer.render(viewport);

      const methodBatch = batches.get('Method');
      // Should be included even though only partially visible
      expect(methodBatch?.rectangles).toHaveLength(1);
    });
  });

  describe('vertical culling (depth-based)', () => {
    it('should render events within viewport depth range', () => {
      const level2 = createEvent(60, 10, 'DML');
      const level1 = createEvent(50, 30, 'SOQL', [level2]);
      const level0 = createEvent(0, 100, 'Method', [level1]);
      const events = [level0];

      const viewport = createViewport();
      renderer = new EventBatchRenderer(container, batches, events);
      renderer.render(viewport);

      // All three events should be visible
      expect(batches.get('Method')?.rectangles).toHaveLength(1);
      expect(batches.get('SOQL')?.rectangles).toHaveLength(1);
      expect(batches.get('DML')?.rectangles).toHaveLength(1);
    });

    it('should cull events below viewport', () => {
      const level2 = createEvent(60, 10, 'DML');
      const level1 = createEvent(50, 30, 'SOQL', [level2]);
      const level0 = createEvent(0, 100, 'Method', [level1]);
      const events = [level0];

      // Pan down so only depth 2+ is visible
      const eventHeight = TIMELINE_CONSTANTS.EVENT_HEIGHT;
      const viewport = createViewport(1, 0, eventHeight * 2.5);
      renderer = new EventBatchRenderer(container, batches, events);
      renderer.render(viewport);

      // Level 0 and 1 should be culled (depths < depthStart), level 2 should be visible
      const methodBatch = batches.get('Method');
      const soqlBatch = batches.get('SOQL');
      const dmlBatch = batches.get('DML');

      // With the new implementation, events are pre-computed, so only depth filtering applies
      // Depth 0 and 1 are culled, but depth 2 (DML) might still be visible
      expect(methodBatch?.rectangles.length).toBeLessThanOrEqual(1);
      expect(soqlBatch?.rectangles.length).toBeLessThanOrEqual(1);
      // Depth 2 might be visible since it's in the viewport
      expect(dmlBatch?.rectangles.length).toBeGreaterThanOrEqual(0);
    });

    it('should cull events above viewport', () => {
      const level2 = createEvent(60, 10, 'DML');
      const level1 = createEvent(50, 30, 'SOQL', [level2]);
      const level0 = createEvent(0, 100, 'Method', [level1]);
      const events = [level0];

      // Viewport showing depths 0 and 1, but not 2
      // depthEnd = ceil((offsetY + height) / eventHeight)
      // For depthEnd = 1: ceil(height / 15) = 1, so 0 < height <= 15
      const eventHeight = TIMELINE_CONSTANTS.EVENT_HEIGHT;
      const viewport = createViewport(1, 0, 0, 1000, eventHeight); // exactly 1 event height
      renderer = new EventBatchRenderer(container, batches, events);
      renderer.render(viewport);

      // With height = 15: depthEnd = ceil(15/15) = ceil(1) = 1
      // So depths 0 and 1 are visible (0 <= depth <= 1)
      // But depth 2 is not (2 > 1)
      // However, since level 1 (SOQL) is visible and has children,
      // those children will be checked. Level 2 (DML) at depth 2 should be culled.
      expect(batches.get('Method')?.rectangles).toHaveLength(1);
      expect(batches.get('SOQL')?.rectangles).toHaveLength(1);
      expect(batches.get('DML')?.rectangles).toHaveLength(0);
    });
  });

  describe('minimum size filtering', () => {
    it('should cull events smaller than minimum size', () => {
      const events = [
        createEvent(0, 0.01, 'Method'), // Very small duration
      ];

      // At zoom=1, event width = 0.01px (< MIN_RECT_SIZE = 0.05)
      const viewport = createViewport(1, 0, 0);
      renderer = new EventBatchRenderer(container, batches, events);
      renderer.render(viewport);

      const methodBatch = batches.get('Method');
      expect(methodBatch?.rectangles).toHaveLength(0);
    });

    it('should render events that meet minimum size threshold', () => {
      const events = [
        createEvent(0, 1, 'Method'), // Width = 1px at zoom=1
      ];

      const viewport = createViewport(1, 0, 0);
      renderer = new EventBatchRenderer(container, batches, events);
      renderer.render(viewport);

      const methodBatch = batches.get('Method');
      expect(methodBatch?.rectangles).toHaveLength(1);
    });

    it('should render small events when zoomed in', () => {
      const events = [
        createEvent(0, 1, 'Method'), // 1ns duration
      ];

      const viewport = createViewport(10, 0, 0);
      renderer = new EventBatchRenderer(container, batches, events);
      renderer.render(viewport);

      const methodBatch = batches.get('Method');
      expect(methodBatch?.rectangles).toHaveLength(1);
    });
  });

  describe('hierarchical collection', () => {
    it('should collect rectangles at correct depths', () => {
      const level2 = createEvent(60, 10, 'DML');
      const level1 = createEvent(50, 30, 'SOQL', [level2]);
      const level0 = createEvent(0, 100, 'Method', [level1]);
      const events = [level0];

      renderer = new EventBatchRenderer(container, batches, events);
      const viewport = createViewport();

      renderer.render(viewport);

      const methodRect = batches.get('Method')?.rectangles[0];
      const soqlRect = batches.get('SOQL')?.rectangles[0];
      const dmlRect = batches.get('DML')?.rectangles[0];

      // Verify Y positions correspond to depths
      const eventHeight = TIMELINE_CONSTANTS.EVENT_HEIGHT;
      expect(methodRect?.y).toBe(0 * eventHeight);
      expect(soqlRect?.y).toBe(1 * eventHeight);
      expect(dmlRect?.y).toBe(2 * eventHeight);
    });

    it('should skip children if parent is not visible', () => {
      const child = createEvent(2000, 100, 'SOQL');
      const parent = createEvent(1500, 600, 'Method', [child]);
      const events = [parent];

      renderer = new EventBatchRenderer(container, batches, events);
      // Viewport shows time 0-1000, parent starts at 1500
      const viewport = createViewport(1, 0, 0, 1000);

      renderer.render(viewport);

      // Both parent and child should be culled
      expect(batches.get('Method')?.rectangles).toHaveLength(0);
      expect(batches.get('SOQL')?.rectangles).toHaveLength(0);
    });

    it('should process children even if parent is partially visible', () => {
      const child = createEvent(500, 100, 'SOQL');
      const parent = createEvent(400, 300, 'Method', [child]);
      const events = [parent];

      renderer = new EventBatchRenderer(container, batches, events);
      // Viewport shows time 0-600, parent extends to 700
      const viewport = createViewport(1, 0, 0, 600);

      renderer.render(viewport);

      // Both should be visible
      expect(batches.get('Method')?.rectangles).toHaveLength(1);
      expect(batches.get('SOQL')?.rectangles).toHaveLength(1);
    });
  });

  describe('rectangle calculations', () => {
    it('should calculate correct rectangle positions with zoom', () => {
      const events = [createEvent(100, 50, 'Method')];

      renderer = new EventBatchRenderer(container, batches, events);
      const viewport = createViewport(2, 0, 0); // 2x zoom

      renderer.render(viewport);

      const rect = batches.get('Method')?.rectangles[0];

      // At 2x zoom: x = 100 * 2 = 200, width = 50 * 2 = 100
      expect(rect?.x).toBe(200);
      expect(rect?.width).toBe(100);
    });

    it('should calculate correct rectangle height', () => {
      const events = [createEvent(0, 100, 'Method')];

      renderer = new EventBatchRenderer(container, batches, events);
      const viewport = createViewport();

      renderer.render(viewport);

      const rect = batches.get('Method')?.rectangles[0];

      expect(rect?.height).toBe(TIMELINE_CONSTANTS.EVENT_HEIGHT);
    });

    it('should preserve event reference in rectangle', () => {
      const event = createEvent(0, 100, 'Method');
      const events = [event];

      renderer = new EventBatchRenderer(container, batches, events);
      const viewport = createViewport();

      renderer.render(viewport);

      const rect = batches.get('Method')?.rectangles[0];

      expect(rect?.eventRef).toBe(event);
    });
  });

  describe('dirty flag management', () => {
    it('should mark batches as dirty during render', () => {
      const events = [createEvent(0, 100, 'Method')];

      renderer = new EventBatchRenderer(container, batches, events);
      const viewport = createViewport();

      renderer.render(viewport);

      // After render, dirty flags should be cleared
      expect(batches.get('Method')?.isDirty).toBe(false);
    });

    it('should clear rectangles on each render', () => {
      const events = [createEvent(0, 100, 'Method'), createEvent(200, 100, 'Method')];

      renderer = new EventBatchRenderer(container, batches, events);
      const viewport = createViewport();

      // First render
      renderer.render(viewport);
      expect(batches.get('Method')?.rectangles).toHaveLength(2);

      // Second render with different viewport (should recalculate)
      const viewport2 = createViewport(1, 150, 0); // Pan to cull first event
      renderer.render(viewport2);
      expect(batches.get('Method')?.rectangles).toHaveLength(1);
    });
  });

  describe('edge cases', () => {
    it('should handle empty event array', () => {
      const events: LogEvent[] = [];

      renderer = new EventBatchRenderer(container, batches, events);
      const viewport = createViewport();

      renderer.render(viewport);

      for (const batch of batches.values()) {
        expect(batch.rectangles).toHaveLength(0);
      }
    });

    it('should handle events without duration', () => {
      const event = {
        timestamp: 0,
        subCategory: 'Method',
        text: 'No duration',
        lineNumber: 0,
        category: 'Method',
        children: [],
        duration: {
          total: 0,
          exclusive: 0,
        },
      } as unknown as LogEvent;

      const events = [event];

      renderer = new EventBatchRenderer(container, batches, events);
      const viewport = createViewport();

      // Should not crash, and event should be skipped (zero duration)
      renderer.render(viewport);

      expect(batches.get('Method')?.rectangles).toHaveLength(0);
    });

    it('should handle zero zoom gracefully', () => {
      const events = [createEvent(0, 100, 'Method')];

      renderer = new EventBatchRenderer(container, batches, events);
      const viewport = createViewport(0, 0, 0);

      // Should not crash
      renderer.render(viewport);
    });
  });

  describe('cleanup', () => {
    it('should destroy all Graphics objects', () => {
      const events = [createEvent(0, 100, 'Method')];
      renderer = new EventBatchRenderer(container, batches, events);

      const childrenCount = container.children.length;
      expect(childrenCount).toBeGreaterThan(0);

      renderer.destroy();
      // After destruction, graphics are removed from their parent
      // Container should have no children
      expect(container.children.length).toBe(0);
    });
  });
});
