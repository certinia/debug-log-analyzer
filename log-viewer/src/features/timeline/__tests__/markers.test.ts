/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

/**
 * Unit tests for TimelineMarkerRenderer
 *
 * Tests truncation indicator rendering including:
 * - Color accuracy verification (T013)
 * - End time resolution algorithm (T008)
 * - Viewport culling behavior (T009)
 * - Hit testing logic (T014)
 */

import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import type * as PIXI from 'pixi.js';

// Mock PIXI.Sprite with test helpers
class MockSprite {
  public x = 0;
  public y = 0;
  public width = 0;
  public height = 0;
  public tint = 0xffffff;
  public alpha = 1;
  public visible = true;
  public parent: unknown = null;
  public _zIndex = 0;
  public didChange = false;

  position = {
    set: (x: number, y: number) => {
      this.x = x;
      this.y = y;
    },
  };

  // Required for PIXI.Container.addChild
  emit(): void {
    // No-op for testing
  }

  depthOfChildModified(): void {
    // No-op for testing
  }

  destroy(): void {
    // No-op for testing
  }
}

// Track created mock sprite instances globally
const createdMockSpritesGlobal: MockSprite[] = [];

// Mock PIXI module before imports
jest.mock('pixi.js', () => {
  const actual = jest.requireActual('pixi.js');
  return {
    ...(actual as Record<string, unknown>),

    Sprite: jest.fn().mockImplementation(() => {
      const mock = new MockSprite();
      createdMockSpritesGlobal.push(mock);
      return mock;
    }),

    Texture: {
      WHITE: {},
    },
  };
});

import { TimelineMarkerRenderer } from '../optimised/markers/TimelineMarkerRenderer.js';
import { TimelineViewport } from '../optimised/TimelineViewport.js';
import type { TimelineMarker } from '../types/flamechart.types.js';
import { MARKER_ALPHA, MARKER_COLORS } from '../types/flamechart.types.js';

// Mock PIXI.Container
class MockContainer {
  private children: unknown[] = [];

  addChild(child: unknown): void {
    this.children.push(child);
  }

  destroy(): void {
    this.children = [];
  }

  getChildren(): unknown[] {
    return this.children;
  }
}

describe('TimelineMarkerRenderer', () => {
  let mockContainer: MockContainer;
  let viewport: TimelineViewport;
  let renderer: TimelineMarkerRenderer;
  let createdMockSprites: MockSprite[];

  const DISPLAY_WIDTH = 1000;
  const DISPLAY_HEIGHT = 600;
  const TOTAL_DURATION = 1_000_000; // 1ms in nanoseconds
  const MAX_DEPTH = 10;

  beforeEach(() => {
    // Clear the global array and reference it
    createdMockSpritesGlobal.length = 0;
    createdMockSprites = createdMockSpritesGlobal;

    mockContainer = new MockContainer();
    viewport = new TimelineViewport(DISPLAY_WIDTH, DISPLAY_HEIGHT, TOTAL_DURATION, MAX_DEPTH);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('T013: Color Accuracy Verification', () => {
    it('should render error markers with raw color and alpha via sprite tint', () => {
      const markers: TimelineMarker[] = [
        { id: 'marker-error', type: 'error', startTime: 100_000, summary: 'Test error' },
      ];

      renderer = new TimelineMarkerRenderer(
        mockContainer as unknown as PIXI.Container,
        viewport,
        markers,
      );
      renderer.render();

      // Find the sprite with error color and alpha
      const errorSprites = createdMockSprites.filter(
        (s) => s.visible && s.tint === MARKER_COLORS.error,
      );
      expect(errorSprites.length).toBeGreaterThanOrEqual(1);
      expect(errorSprites[0]!.alpha).toBe(MARKER_ALPHA);
    });

    it('should render skip markers with raw color and alpha via sprite tint', () => {
      const markers: TimelineMarker[] = [
        { id: 'marker-skip', type: 'skip', startTime: 100_000, summary: 'Test skip' },
      ];

      renderer = new TimelineMarkerRenderer(
        mockContainer as unknown as PIXI.Container,
        viewport,
        markers,
      );
      renderer.render();

      // Find the sprite with skip color and alpha
      const skipSprites = createdMockSprites.filter(
        (s) => s.visible && s.tint === MARKER_COLORS.skip,
      );
      expect(skipSprites.length).toBeGreaterThanOrEqual(1);
      expect(skipSprites[0]!.alpha).toBe(MARKER_ALPHA);
    });

    it('should render unexpected markers with raw color and alpha via sprite tint', () => {
      const markers: TimelineMarker[] = [
        {
          id: 'marker-unexpected',
          type: 'unexpected',
          startTime: 100_000,
          summary: 'Test unexpected',
        },
      ];

      renderer = new TimelineMarkerRenderer(
        mockContainer as unknown as PIXI.Container,
        viewport,
        markers,
      );
      renderer.render();

      // Find the sprite with unexpected color and alpha
      const unexpectedSprites = createdMockSprites.filter(
        (s) => s.visible && s.tint === MARKER_COLORS.unexpected,
      );
      expect(unexpectedSprites.length).toBeGreaterThanOrEqual(1);
      expect(unexpectedSprites[0]!.alpha).toBe(MARKER_ALPHA);
    });
  });

  describe('End Time Resolution', () => {
    it('should render a bounded marker across its exact range', () => {
      // zoom = DISPLAY_WIDTH / TOTAL_DURATION = 0.001px per ns
      const markers: TimelineMarker[] = [
        {
          id: 'marker-skip',
          type: 'skip',
          startTime: 100_000,
          endTime: 300_000,
          summary: 'Bounded',
        },
      ];

      renderer = new TimelineMarkerRenderer(
        mockContainer as unknown as PIXI.Container,
        viewport,
        markers,
      );
      renderer.render();

      const visibleSprites = createdMockSprites.filter((s) => s.visible && s.width > 0);
      expect(visibleSprites.length).toBe(1);
      // (300_000 - 100_000) * 0.001 = 200px, drawn at its exact width (gap is owned by the
      // following marker, so a lone band is not inset).
      expect(visibleSprites[0]!.width).toBeCloseTo(200, 0);
    });

    it('should render a marker with no endTime as a min-width point (not extended to next marker)', () => {
      const markers: TimelineMarker[] = [
        { id: 'marker-skip', type: 'skip', startTime: 100_000, summary: 'Point' },
        { id: 'marker-error', type: 'error', startTime: 500_000, summary: 'Second' },
      ];

      renderer = new TimelineMarkerRenderer(
        mockContainer as unknown as PIXI.Container,
        viewport,
        markers,
      );
      renderer.render();

      const visibleSprites = createdMockSprites
        .filter((s) => s.visible && s.width > 0)
        .sort((a, b) => a.x - b.x);

      expect(visibleSprites.length).toBe(2);
      // A point clamps to MARKER_MIN_WIDTH_PX (2) minus the 1px gap = 1px,
      // NOT the 400px distance to the next marker.
      expect(visibleSprites[0]!.width).toBeLessThan(5);
    });

    it('should handle multiple markers in sequence', () => {
      const markers: TimelineMarker[] = [
        { id: 'marker-skip', type: 'skip', startTime: 100_000, summary: 'First' },
        { id: 'marker-unexpected', type: 'unexpected', startTime: 300_000, summary: 'Second' },
        { id: 'marker-error', type: 'error', startTime: 600_000, summary: 'Third' },
      ];

      renderer = new TimelineMarkerRenderer(
        mockContainer as unknown as PIXI.Container,
        viewport,
        markers,
      );
      renderer.render();

      const visibleSprites = createdMockSprites.filter((s) => s.visible && s.width > 0);

      // All three markers should render (within viewport)
      expect(visibleSprites.length).toBe(3);
    });
  });

  describe('T009: Viewport Culling Behavior', () => {
    it('should render only markers within viewport time range', () => {
      const markers: TimelineMarker[] = [
        { id: 'marker-error', type: 'error', startTime: 100_000, summary: 'In viewport' },
      ];

      renderer = new TimelineMarkerRenderer(
        mockContainer as unknown as PIXI.Container,
        viewport,
        markers,
      );
      renderer.render();

      const visibleSprites = createdMockSprites.filter((s) => s.visible && s.width > 0);

      // Marker should be rendered
      expect(visibleSprites.length).toBe(1);
    });

    it('should cull markers entirely before viewport', () => {
      // Markers that end before the viewport starts should be culled
      const markers: TimelineMarker[] = [
        { id: 'marker-error', type: 'error', startTime: 100_000, summary: 'First marker' },
        {
          id: 'marker-skip',
          type: 'skip',
          startTime: 200_000,
          endTime: 1_000_000,
          summary: 'Second marker',
        },
      ];

      // Zoom in 10x first (so we can actually pan)
      // At 10x zoom: 1000px shows 100_000ns
      viewport.setZoom(0.01, 0);

      // Now pan to the right so first marker is outside view
      // At 0.01 zoom: visible time = 1000/0.01 = 100_000ns
      // Pan to 250_000: viewport shows 250_000 to 350_000
      // First marker: point at 100_000 - before 250_000, should be culled
      // Second marker: bounded 200_000 to 1_000_000 - overlaps 250_000, should be visible
      viewport.setPan(250_000 * viewport.getState().zoom, 0);

      renderer = new TimelineMarkerRenderer(
        mockContainer as unknown as PIXI.Container,
        viewport,
        markers,
      );
      renderer.render();

      const visibleSprites = createdMockSprites.filter((s) => s.visible && s.width > 0);

      // First marker should be culled (point at 100_000 < viewport start 250_000)
      // Second marker should be visible (200_000 to 1_000_000 overlaps 250_000)
      expect(visibleSprites.length).toBe(1);
      expect(visibleSprites[0]!.tint).toBe(MARKER_COLORS.skip);
    });

    it('should cull markers entirely after viewport', () => {
      // Create a zoomed-in viewport showing only the start of the timeline
      const zoomedViewport = new TimelineViewport(
        DISPLAY_WIDTH,
        DISPLAY_HEIGHT,
        TOTAL_DURATION,
        MAX_DEPTH,
      );
      // Zoom in 100x so 1000px shows only 10_000ns (10μs) of timeline
      zoomedViewport.setZoom(0.1, 0);

      const markers: TimelineMarker[] = [
        { id: 'marker-error', type: 'error', startTime: 900_000, summary: 'After viewport' },
      ];

      renderer = new TimelineMarkerRenderer(
        mockContainer as unknown as PIXI.Container,
        zoomedViewport,
        markers,
      );
      renderer.render();

      const visibleSprites = createdMockSprites.filter((s) => s.visible && s.width > 0);

      // Marker at 900_000 starts after the visible range (0 to ~10_000) at 0.1 zoom
      // Actually at zoom 0.1, visible time = 1000/0.1 = 10_000ns
      // So marker at 900_000 starts after viewport ends
      expect(visibleSprites.length).toBe(0);
    });

    it('should render partially visible markers', () => {
      const markers: TimelineMarker[] = [
        { id: 'marker-skip', type: 'skip', startTime: 100_000, summary: 'Extends into viewport' },
        { id: 'marker-error', type: 'error', startTime: 900_000, summary: 'Starts before end' },
      ];

      renderer = new TimelineMarkerRenderer(
        mockContainer as unknown as PIXI.Container,
        viewport,
        markers,
      );
      renderer.render();

      const visibleSprites = createdMockSprites.filter((s) => s.visible && s.width > 0);

      // Both should be visible (first continues to second, second to end)
      expect(visibleSprites.length).toBe(2);
    });

    it('should keep sub-pixel bounded markers visible via the min-width clamp', () => {
      // A tiny bounded marker (1ns wide) would be sub-pixel at default zoom.
      // Instead of being culled, it clamps to MARKER_MIN_WIDTH_PX so it stays visible.
      const markers: TimelineMarker[] = [
        {
          id: 'marker-skip',
          type: 'skip',
          startTime: 100_000,
          endTime: 100_001,
          summary: 'Tiny bounded marker',
        },
      ];

      renderer = new TimelineMarkerRenderer(
        mockContainer as unknown as PIXI.Container,
        viewport,
        markers,
      );
      renderer.render();

      const visibleSprites = createdMockSprites.filter((s) => s.visible && s.width > 0);

      // Clamped to min width rather than culled.
      expect(visibleSprites.length).toBe(1);
      expect(visibleSprites[0]!.width).toBeGreaterThan(0);
    });
  });

  describe('Initialization', () => {
    it('should create a SpritePool container', () => {
      const markers: TimelineMarker[] = [];

      renderer = new TimelineMarkerRenderer(
        mockContainer as unknown as PIXI.Container,
        viewport,
        markers,
      );

      // SpritePool creates one container
      expect(mockContainer.getChildren().length).toBe(1);
    });

    it('should sort markers by startTime on construction', () => {
      const markers: TimelineMarker[] = [
        { id: 'marker-error', type: 'error', startTime: 300_000, summary: 'Third' },
        { id: 'marker-skip', type: 'skip', startTime: 100_000, summary: 'First' },
        { id: 'marker-unexpected', type: 'unexpected', startTime: 200_000, summary: 'Second' },
      ];

      renderer = new TimelineMarkerRenderer(
        mockContainer as unknown as PIXI.Container,
        viewport,
        markers,
      );

      renderer.render();

      // Get visible sprites sorted by x position
      const visibleSprites = createdMockSprites
        .filter((s) => s.visible && s.width > 0)
        .sort((a, b) => a.x - b.x);

      // All three should be rendered in chronological order (by x position)
      expect(visibleSprites.length).toBe(3);

      // First sprite (skip at 100_000) should be leftmost
      expect(visibleSprites[0]!.tint).toBe(MARKER_COLORS.skip);
      // Second sprite (unexpected at 200_000)
      expect(visibleSprites[1]!.tint).toBe(MARKER_COLORS.unexpected);
      // Third sprite (error at 300_000)
      expect(visibleSprites[2]!.tint).toBe(MARKER_COLORS.error);
    });
  });

  describe('T014: Hit Testing', () => {
    it('should return null when no indicators are hit', () => {
      const markers: TimelineMarker[] = [
        { id: 'marker-error', type: 'error', startTime: 100_000, summary: 'Test' },
      ];

      renderer = new TimelineMarkerRenderer(
        mockContainer as unknown as PIXI.Container,
        viewport,
        markers,
      );
      renderer.render();

      // Hit test at position far before the marker
      const result = renderer.hitTest(0, 300);
      expect(result).toBeNull();
    });

    it('should return marker when hit', () => {
      const markers: TimelineMarker[] = [
        {
          id: 'marker-error',
          type: 'error',
          startTime: 100_000,
          endTime: 300_000,
          summary: 'Test error',
        },
      ];

      renderer = new TimelineMarkerRenderer(
        mockContainer as unknown as PIXI.Container,
        viewport,
        markers,
      );
      renderer.render();

      // Hit test at a position that should be within the marker
      const viewportState = viewport.getState();
      const markerScreenX = 100_000 * viewportState.zoom - viewportState.offsetX;

      if (markerScreenX >= 0 && markerScreenX < viewportState.displayWidth) {
        const result = renderer.hitTest(markerScreenX + 5, 300);
        expect(result).toBe(markers[0]);
      }
    });

    it('should return highest severity marker when multiple overlap', () => {
      // Two markers with overlapping time ranges
      // Skip: 100_000 to 300_000
      // Error: 200_000 to timeline end
      // At time 250_000, both markers overlap
      const markers: TimelineMarker[] = [
        {
          id: 'marker-skip',
          type: 'skip',
          startTime: 100_000,
          endTime: 300_000,
          summary: 'Skip marker',
        },
        {
          id: 'marker-error',
          type: 'error',
          startTime: 200_000,
          endTime: 1_000_000,
          summary: 'Error marker',
        },
      ];

      renderer = new TimelineMarkerRenderer(
        mockContainer as unknown as PIXI.Container,
        viewport,
        markers,
      );
      renderer.render();

      // Hit test at position where both markers should overlap
      // Skip ends at 200_000 (error's start), error continues to end
      // Actually, skip doesn't overlap with error - they meet at 200_000
      // Let's hit test at 150_000 (in skip region) and 250_000 (in error region)
      const viewportState = viewport.getState();

      // Test in skip-only region
      const skipX = 150_000 * viewportState.zoom - viewportState.offsetX;
      if (skipX >= 0 && skipX < viewportState.displayWidth) {
        const result = renderer.hitTest(skipX, 300);
        expect(result?.type).toBe('skip');
      }

      // Test in error-only region
      const errorX = 250_000 * viewportState.zoom - viewportState.offsetX;
      if (errorX >= 0 && errorX < viewportState.displayWidth) {
        const result = renderer.hitTest(errorX, 300);
        expect(result?.type).toBe('error');
      }
    });

    it('should work correctly with panned viewport', () => {
      const markers: TimelineMarker[] = [
        {
          id: 'marker-error',
          type: 'error',
          startTime: 500_000,
          endTime: 700_000,
          summary: 'Test error',
        },
      ];

      // Pan viewport to show the marker area
      viewport.setPan(400_000 * viewport.getState().zoom, 0);

      renderer = new TimelineMarkerRenderer(
        mockContainer as unknown as PIXI.Container,
        viewport,
        markers,
      );
      renderer.render();

      const viewportState = viewport.getState();
      const markerScreenX = 500_000 * viewportState.zoom - viewportState.offsetX;

      if (markerScreenX >= 0 && markerScreenX < viewportState.displayWidth) {
        const result = renderer.hitTest(markerScreenX + 5, 300);
        expect(result).toBe(markers[0]);
      }
    });

    it('should ignore Y coordinate for full-height indicators', () => {
      const markers: TimelineMarker[] = [
        {
          id: 'marker-error',
          type: 'error',
          startTime: 100_000,
          endTime: 300_000,
          summary: 'Test error',
        },
      ];

      renderer = new TimelineMarkerRenderer(
        mockContainer as unknown as PIXI.Container,
        viewport,
        markers,
      );
      renderer.render();

      const viewportState = viewport.getState();
      const markerScreenX = 100_000 * viewportState.zoom - viewportState.offsetX;

      if (markerScreenX >= 0 && markerScreenX < viewportState.displayWidth) {
        // Hit test at various Y positions - should all hit the same marker
        const result1 = renderer.hitTest(markerScreenX + 5, 0);
        const result2 = renderer.hitTest(markerScreenX + 5, 300);
        const result3 = renderer.hitTest(markerScreenX + 5, 599);

        expect(result1).toBe(markers[0]);
        expect(result2).toBe(markers[0]);
        expect(result3).toBe(markers[0]);
      }
    });
  });

  describe('updateMarkers', () => {
    it('should update markers array', () => {
      const initialMarkers: TimelineMarker[] = [
        { id: 'marker-error', type: 'error', startTime: 100_000, summary: 'Initial' },
      ];

      renderer = new TimelineMarkerRenderer(
        mockContainer as unknown as PIXI.Container,
        viewport,
        initialMarkers,
      );
      renderer.render();

      // Should have 1 visible sprite initially
      let visibleSprites = createdMockSprites.filter((s) => s.visible && s.width > 0);
      expect(visibleSprites.length).toBe(1);

      const newMarkers: TimelineMarker[] = [
        { id: 'marker-skip', type: 'skip', startTime: 50_000, summary: 'New first' },
        { id: 'marker-error', type: 'error', startTime: 200_000, summary: 'New second' },
      ];

      renderer.updateMarkers(newMarkers);
      renderer.render();

      // After update, should have 2 visible sprites (reused from pool)
      visibleSprites = createdMockSprites.filter((s) => s.visible && s.width > 0);
      expect(visibleSprites.length).toBe(2);

      // Verify the new markers are rendered with correct tints
      const skipSprites = visibleSprites.filter((s) => s.tint === MARKER_COLORS.skip);
      const errorSprites = visibleSprites.filter((s) => s.tint === MARKER_COLORS.error);
      expect(skipSprites.length).toBe(1);
      expect(errorSprites.length).toBe(1);
    });
  });

  describe('exception spacing and bucketing', () => {
    it('collapses a dense exception cluster to fewer sprites but keeps them hit-testable', () => {
      // At default zoom (0.001px/ns) these three exceptions are within ~0.2px of each other.
      const markers: TimelineMarker[] = [
        { id: 'e1', type: 'exception', startTime: 100_000, summary: 'NullPointer' },
        { id: 'e2', type: 'exception', startTime: 100_100, summary: 'LimitException' },
        { id: 'e3', type: 'exception', startTime: 100_200, summary: 'DmlException' },
      ];

      renderer = new TimelineMarkerRenderer(
        mockContainer as unknown as PIXI.Container,
        viewport,
        markers,
      );
      renderer.render();

      // The cluster collapses to a single drawn hairline...
      const visibleSprites = createdMockSprites.filter((s) => s.visible && s.width > 0);
      expect(visibleSprites.length).toBe(1);

      // ...but all three still hit-test, so the tooltip reports the aggregated count.
      // Hover at ~101px: within the min-width hit region of all three (starts 100/100.1/100.2).
      const result = renderer.hitTest(101, 300);
      expect(result?.summary).toBe('3 exceptions');
    });

    it('keeps a visible gap between two well-separated exceptions', () => {
      const markers: TimelineMarker[] = [
        { id: 'e1', type: 'exception', startTime: 100_000, summary: 'First' },
        { id: 'e2', type: 'exception', startTime: 500_000, summary: 'Second' },
      ];

      renderer = new TimelineMarkerRenderer(
        mockContainer as unknown as PIXI.Container,
        viewport,
        markers,
      );
      renderer.render();

      const sprites = createdMockSprites
        .filter((s) => s.visible && s.width > 0)
        .sort((a, b) => a.x - b.x);
      expect(sprites.length).toBe(2);
      // Gap between the first sprite's end and the second's start is >= 1px.
      expect(sprites[1]!.x - (sprites[0]!.x + sprites[0]!.width)).toBeGreaterThanOrEqual(1);
    });
  });

  describe('destroy', () => {
    it('should clean up sprite pool', () => {
      const markers: TimelineMarker[] = [
        { id: 'marker-error', type: 'error', startTime: 100_000, summary: 'Test' },
      ];

      renderer = new TimelineMarkerRenderer(
        mockContainer as unknown as PIXI.Container,
        viewport,
        markers,
      );

      // Should not throw
      expect(() => renderer.destroy()).not.toThrow();
    });
  });
});
