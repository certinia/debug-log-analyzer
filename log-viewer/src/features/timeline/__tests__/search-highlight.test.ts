/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

/**
 * Unit tests for SearchHighlightRenderer
 *
 * Tests rendering behavior including:
 * - Current match overlay and border rendering
 * - Viewport culling
 * - Edge cases (empty search, invalid cursor, off-screen events)
 */

import * as PIXI from 'pixi.js';
import type { LogEvent } from '../../../core/log-parser/LogEvents.js';
import type { PrecomputedRect } from '../optimised/RectangleManager.js';
import { SearchHighlightRenderer } from '../optimised/search/SearchHighlightRenderer.js';
import type { EventNode, ViewportState } from '../types/flamechart.types.js';
import type { SearchCursor, SearchMatch } from '../types/search.types.js';

describe('SearchHighlightRenderer', () => {
  let container: PIXI.Container;
  let renderer: SearchHighlightRenderer;
  let mockGraphics: { rect: jest.Mock; fill: jest.Mock };

  // Create a mock LogEvent for testing (following batching.test.ts pattern)
  const createMockEvent = (timestamp: number, duration: number): LogEvent => {
    const event = {
      timestamp,
      exitStamp: timestamp + duration,
      duration: {
        total: duration,
        exclusive: duration,
      },
      subCategory: 'Method',
      children: [],
      text: 'Test Event',
      lineNumber: 0,
      category: 'Method',
    } as unknown as LogEvent;
    return event;
  };

  // Create a mock SearchMatch with EventNode
  const createMockMatch = (
    timestamp: number,
    duration: number,
    depth: number,
  ): SearchMatch<EventNode> => {
    const event = createMockEvent(timestamp, duration);
    const eventNode: EventNode = {
      id: `${timestamp}-${depth}-0`,
      timestamp,
      duration,
      type: 'Method',
      text: 'Test Event',
    };
    const rect: PrecomputedRect = {
      id: `${timestamp}-${depth}-0`,
      x: timestamp,
      y: depth * 15,
      width: duration,
      height: 15,
      eventRef: event,
      timeStart: timestamp,
      timeEnd: timestamp + duration,
      depth,
      duration,
      category: 'Method',
    };
    return {
      event: eventNode,
      rect,
      depth,
      matchType: 'text',
    };
  };

  // Create a mock SearchCursor
  const createMockCursor = (
    matches: SearchMatch<EventNode>[],
    currentIndex: number,
  ): SearchCursor<EventNode> => {
    return {
      matches,
      currentIndex,
      total: matches.length,
      next: jest.fn(),
      prev: jest.fn(),
      first: jest.fn(),
      last: jest.fn(),
      seek: jest.fn(),
      getCurrent: jest.fn(() => matches[currentIndex] ?? null),
      hasNext: jest.fn(() => currentIndex < matches.length - 1),
      hasPrev: jest.fn(() => currentIndex > 0),
      getMatchedEventIds: jest.fn(() => new Set(matches.map((m) => m.event.id))),
    };
  };

  beforeEach(() => {
    // Mock getComputedStyle for SearchHighlightRenderer
    global.getComputedStyle = jest.fn().mockReturnValue({
      getPropertyValue: jest.fn().mockReturnValue('#ff9632'),
    });

    // Mock document.documentElement
    Object.defineProperty(global, 'document', {
      value: {
        documentElement: {},
      },
      writable: true,
    });

    container = new PIXI.Container();
    renderer = new SearchHighlightRenderer(container);

    // Mock Graphics.rect() to track calls
    mockGraphics = {
      rect: jest.fn(),
      fill: jest.fn(),
    };

    // Replace the currentMatchGraphics with our mock
    const currentGraphics = (renderer as unknown as { currentMatchGraphics: PIXI.Graphics })
      .currentMatchGraphics;
    currentGraphics.rect = mockGraphics.rect;
    currentGraphics.fill = mockGraphics.fill;
  });

  describe('rendering current match', () => {
    it('should render overlay and border for current match', () => {
      // Given: event with normal screen width
      const match = createMockMatch(0, 10000, 0);
      const viewport: ViewportState = {
        zoom: 0.005, // screenWidth = 10000 * 0.005 = 50px
        offsetX: 0,
        offsetY: 0,
        displayWidth: 1000,
        displayHeight: 600,
      };

      // When: rendering highlight
      const cursor = createMockCursor([match], 0);
      renderer.render(cursor, viewport);

      // Then: should render both overlay and border
      expect(mockGraphics.rect).toHaveBeenCalled();
      expect(mockGraphics.fill).toHaveBeenCalled();

      // Should have called rect twice (once for fill, once for stroke)
      expect(mockGraphics.rect).toHaveBeenCalledTimes(2);
    });

    it('should render for small rectangles', () => {
      // Given: event with small screen width
      const match = createMockMatch(0, 100, 0);
      const viewport: ViewportState = {
        zoom: 0.002, // screenWidth = 100 * 0.002 = 0.2px
        offsetX: 0,
        offsetY: 0,
        displayWidth: 1000,
        displayHeight: 600,
      };

      // When: rendering
      const cursor = createMockCursor([match], 0);
      renderer.render(cursor, viewport);

      // Then: should still render (minimum width enforced)
      expect(mockGraphics.rect).toHaveBeenCalled();
    });

    it('should render for large rectangles', () => {
      // Given: event with large screen width
      const match = createMockMatch(0, 40000, 0);
      const viewport: ViewportState = {
        zoom: 0.005, // screenWidth = 40000 * 0.005 = 200px
        offsetX: 0,
        offsetY: 0,
        displayWidth: 1000,
        displayHeight: 600,
      };

      // When: rendering
      const cursor = createMockCursor([match], 0);
      renderer.render(cursor, viewport);

      // Then: should render normally
      expect(mockGraphics.rect).toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('should handle event at timestamp zero', () => {
      const match = createMockMatch(0, 100, 0);
      const viewport: ViewportState = {
        zoom: 0.001, // screenWidth = 0.1px
        offsetX: 0,
        offsetY: 0,
        displayWidth: 1000,
        displayHeight: 600,
      };

      // Should not throw and should render
      const cursor = createMockCursor([match], 0);
      expect(() => renderer.render(cursor, viewport)).not.toThrow();
      expect(mockGraphics.rect).toHaveBeenCalled();
    });

    it('should handle very large duration events', () => {
      const match = createMockMatch(0, 1_000_000, 0); // 1ms
      const viewport: ViewportState = {
        zoom: 0.005, // screenWidth = 5000px
        offsetX: 0,
        offsetY: 0,
        displayWidth: 1000,
        displayHeight: 600,
      };

      const cursor = createMockCursor([match], 0);
      expect(() => renderer.render(cursor, viewport)).not.toThrow();
      expect(mockGraphics.rect).toHaveBeenCalled();
    });

    it('should handle negative offset (panned left)', () => {
      const match = createMockMatch(500, 100, 0);
      const viewport: ViewportState = {
        zoom: 0.001,
        offsetX: -100, // Panned left
        offsetY: 0,
        displayWidth: 1000,
        displayHeight: 600,
      };

      const cursor = createMockCursor([match], 0);
      expect(() => renderer.render(cursor, viewport)).not.toThrow();
    });

    it('should not render when match is outside viewport', () => {
      // Event far off-screen to the right
      const match = createMockMatch(1_000_000, 100, 0);
      const viewport: ViewportState = {
        zoom: 0.001,
        offsetX: 0,
        offsetY: 0,
        displayWidth: 1000,
        displayHeight: 600,
      };

      const cursor = createMockCursor([match], 0);
      renderer.render(cursor, viewport);

      // Should not call rect() because event is not visible
      expect(mockGraphics.rect).not.toHaveBeenCalled();
    });

    it('should not render when currentIndex is invalid', () => {
      const match = createMockMatch(0, 100, 0);
      const viewport: ViewportState = {
        zoom: 0.005,
        offsetX: 0,
        offsetY: 0,
        displayWidth: 1000,
        displayHeight: 600,
      };

      // Invalid index (-1)
      const invalidCursor1 = createMockCursor([match], -1);
      renderer.render(invalidCursor1, viewport);
      expect(mockGraphics.rect).not.toHaveBeenCalled();

      mockGraphics.rect.mockClear();

      // Invalid index (out of bounds)
      const invalidCursor2 = createMockCursor([match], 999);
      renderer.render(invalidCursor2, viewport);
      expect(mockGraphics.rect).not.toHaveBeenCalled();
    });

    it('should handle empty matches array', () => {
      const viewport: ViewportState = {
        zoom: 0.005,
        offsetX: 0,
        offsetY: 0,
        displayWidth: 1000,
        displayHeight: 600,
      };

      const emptyCursor = createMockCursor([], 0);
      expect(() => renderer.render(emptyCursor, viewport)).not.toThrow();
      expect(mockGraphics.rect).not.toHaveBeenCalled();
    });
  });

  describe('multiple render calls', () => {
    it('should clear graphics before each render', () => {
      const match = createMockMatch(0, 100, 0);
      const viewport: ViewportState = {
        zoom: 0.005,
        offsetX: 0,
        offsetY: 0,
        displayWidth: 1000,
        displayHeight: 600,
      };

      // First render
      const cursor = createMockCursor([match], 0);
      renderer.render(cursor, viewport);
      const firstCallCount = mockGraphics.rect.mock.calls.length;

      mockGraphics.rect.mockClear();

      // Second render with same cursor
      renderer.render(cursor, viewport);
      const secondCallCount = mockGraphics.rect.mock.calls.length;

      // Should have same number of calls after clear
      expect(secondCallCount).toBe(firstCallCount);
    });

    it('should handle undefined cursor', () => {
      const viewport: ViewportState = {
        zoom: 0.005,
        offsetX: 0,
        offsetY: 0,
        displayWidth: 1000,
        displayHeight: 600,
      };

      expect(() => renderer.render(undefined, viewport)).not.toThrow();
      expect(mockGraphics.rect).not.toHaveBeenCalled();
    });
  });
});
