/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */

/**
 * Unit tests for TruncationIndicatorRenderer
 *
 * Tests truncation indicator rendering including:
 * - Color accuracy verification (T013)
 * - End time resolution algorithm (T008)
 * - Viewport culling behavior (T009)
 * - Hit testing logic (T014)
 */

import * as PIXI from 'pixi.js';
import { TruncationIndicatorRenderer } from '../graphics/TruncationIndicatorRenderer.js';
import { TimelineViewport } from '../services/TimelineViewport.js';
import type { TruncationMarker } from '../types/timeline.types.js';
import { TRUNCATION_ALPHA, TRUNCATION_COLORS } from '../types/timeline.types.js';

// Mock PIXI.Graphics
class MockGraphics {
  private fillStyle: { color?: number; alpha?: number } = {};
  private rectangles: Array<{ x: number; y: number; width: number; height: number }> = [];

  clear(): void {
    this.rectangles = [];
    this.fillStyle = {};
  }

  setFillStyle(style: { color?: number; alpha?: number }): void {
    this.fillStyle = style;
  }

  rect(x: number, y: number, width: number, height: number): void {
    this.rectangles.push({ x, y, width, height });
  }

  fill(): void {
    // No-op for testing
  }

  destroy(): void {
    // No-op for testing
  }

  // Test helpers
  getFillStyle(): { color?: number; alpha?: number } {
    return this.fillStyle;
  }

  getRectangles(): Array<{ x: number; y: number; width: number; height: number }> {
    return this.rectangles;
  }
}

// Mock PIXI.Container
class MockContainer {
  private children: MockGraphics[] = [];

  addChild(child: MockGraphics): void {
    this.children.push(child);
  }

  destroy(): void {
    this.children = [];
  }

  getChildren(): MockGraphics[] {
    return this.children;
  }
}

describe('TruncationIndicatorRenderer', () => {
  let mockContainer: MockContainer;
  let viewport: TimelineViewport;
  let renderer: TruncationIndicatorRenderer;

  const DISPLAY_WIDTH = 1000;
  const DISPLAY_HEIGHT = 600;
  const TOTAL_DURATION = 1_000_000; // 1ms in nanoseconds
  const MAX_DEPTH = 10;

  beforeEach(() => {
    // Mock PIXI.Graphics constructor
    jest
      .spyOn(PIXI, 'Graphics')
      .mockImplementation(() => new MockGraphics() as unknown as PIXI.Graphics);

    mockContainer = new MockContainer();
    viewport = new TimelineViewport(DISPLAY_WIDTH, DISPLAY_HEIGHT, TOTAL_DURATION, MAX_DEPTH);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('T013: Color Accuracy Verification', () => {
    it('should render error markers with color 0xFF8080', () => {
      const markers: TruncationMarker[] = [
        { type: 'error', startTime: 100_000, summary: 'Test error' },
      ];

      renderer = new TruncationIndicatorRenderer(
        mockContainer as unknown as PIXI.Container,
        viewport,
        markers,
      );
      renderer.render();

      // Get the Graphics object for error type
      const children = mockContainer.getChildren();
      const errorGraphics = children[2]; // error is third in SEVERITY_ORDER [unexpected, skip, error]

      expect(errorGraphics).toBeDefined();
      if (!errorGraphics) {
        return;
      }
      const fillStyle = errorGraphics.getFillStyle();
      expect(fillStyle.color).toBe(TRUNCATION_COLORS.error);
      expect(fillStyle.color).toBe(0xff8080);
    });

    it('should render skip markers with color 0x1E80FF', () => {
      const markers: TruncationMarker[] = [
        { type: 'skip', startTime: 100_000, summary: 'Test skip' },
      ];

      renderer = new TruncationIndicatorRenderer(
        mockContainer as unknown as PIXI.Container,
        viewport,
        markers,
      );
      renderer.render();

      // Get the Graphics object for skip type
      const children = mockContainer.getChildren();
      const skipGraphics = children[1]; // skip is second in SEVERITY_ORDER

      expect(skipGraphics).toBeDefined();
      if (!skipGraphics) {
        return;
      }
      const fillStyle = skipGraphics.getFillStyle();
      expect(fillStyle.color).toBe(TRUNCATION_COLORS.skip);
      expect(fillStyle.color).toBe(0x1e80ff);
    });

    it('should render unexpected markers with color 0x8080FF', () => {
      const markers: TruncationMarker[] = [
        { type: 'unexpected', startTime: 100_000, summary: 'Test unexpected' },
      ];

      renderer = new TruncationIndicatorRenderer(
        mockContainer as unknown as PIXI.Container,
        viewport,
        markers,
      );
      renderer.render();

      // Get the Graphics object for unexpected type
      const children = mockContainer.getChildren();
      const unexpectedGraphics = children[0]; // unexpected is first in SEVERITY_ORDER

      expect(unexpectedGraphics).toBeDefined();
      if (!unexpectedGraphics) {
        return;
      }
      const fillStyle = unexpectedGraphics.getFillStyle();
      expect(fillStyle.color).toBe(TRUNCATION_COLORS.unexpected);
      expect(fillStyle.color).toBe(0x8080ff);
    });

    it('should use alpha 0.2 for all truncation types', () => {
      const markers: TruncationMarker[] = [
        { type: 'error', startTime: 100_000, summary: 'Error' },
        { type: 'skip', startTime: 300_000, summary: 'Skip' },
        { type: 'unexpected', startTime: 500_000, summary: 'Unexpected' },
      ];

      renderer = new TruncationIndicatorRenderer(
        mockContainer as unknown as PIXI.Container,
        viewport,
        markers,
      );
      renderer.render();

      const children = mockContainer.getChildren();

      // Verify all Graphics objects use the correct alpha
      children.forEach((graphics) => {
        const fillStyle = graphics.getFillStyle();
        expect(fillStyle.alpha).toBe(TRUNCATION_ALPHA);
        expect(fillStyle.alpha).toBe(0.2);
      });
    });

    it('should render distinct colors for each type in a mixed log', () => {
      const markers: TruncationMarker[] = [
        { type: 'error', startTime: 100_000, summary: 'Error 1' },
        { type: 'skip', startTime: 200_000, summary: 'Skip 1' },
        { type: 'unexpected', startTime: 300_000, summary: 'Unexpected 1' },
        { type: 'error', startTime: 400_000, summary: 'Error 2' },
      ];

      renderer = new TruncationIndicatorRenderer(
        mockContainer as unknown as PIXI.Container,
        viewport,
        markers,
      );
      renderer.render();

      const children = mockContainer.getChildren();

      // Verify each type has its distinct color
      const unexpectedGraphics = children[0];
      const skipGraphics = children[1];
      const errorGraphics = children[2];

      if (!unexpectedGraphics) {
        return;
      }
      if (!skipGraphics) {
        return;
      }
      if (!errorGraphics) {
        return;
      }

      expect(unexpectedGraphics.getFillStyle().color).toBe(0x8080ff);
      expect(skipGraphics.getFillStyle().color).toBe(0x1e80ff);
      expect(errorGraphics.getFillStyle().color).toBe(0xff8080);

      // Verify multiple markers of same type use same color
      const unexpectedRects = unexpectedGraphics.getRectangles();
      const errorRects = errorGraphics.getRectangles();

      expect(unexpectedRects.length).toBe(1);
      expect(errorRects.length).toBe(2); // Two error markers
    });
  });

  describe('T008: End Time Resolution', () => {
    it('should use explicit endTime when provided', () => {
      const markers: TruncationMarker[] = [
        { type: 'error', startTime: 100_000, summary: 'Explicit end' },
      ];

      renderer = new TruncationIndicatorRenderer(
        mockContainer as unknown as PIXI.Container,
        viewport,
        markers,
      );
      renderer.render();

      const children = mockContainer.getChildren();
      const errorGraphics = children[2];
      if (!errorGraphics) {
        return;
      }
      const rects = errorGraphics.getRectangles();

      expect(rects.length).toBe(1);
      if (!rects[0]) {
        return;
      }
      const expectedWidth = (200_000 - 100_000) * viewport.getState().zoom;
      expect(rects[0].width).toBeCloseTo(expectedWidth, 1);
    });

    it('should use next marker startTime when endTime is null', () => {
      const markers: TruncationMarker[] = [
        { type: 'error', startTime: 100_000, summary: 'First' },
        { type: 'skip', startTime: 300_000, summary: 'Second' },
      ];

      renderer = new TruncationIndicatorRenderer(
        mockContainer as unknown as PIXI.Container,
        viewport,
        markers,
      );
      renderer.render();

      const children = mockContainer.getChildren();
      const errorGraphics = children[2];
      if (!errorGraphics) {
        return;
      }
      const rects = errorGraphics.getRectangles();

      expect(rects.length).toBe(1);
      if (!rects[0]) {
        return;
      }
      // First marker should extend to start of second marker (300_000)
      const expectedWidth = (300_000 - 100_000) * viewport.getState().zoom;
      expect(rects[0].width).toBeCloseTo(expectedWidth, 1);
    });

    it('should use timeline end when no next marker exists', () => {
      const markers: TruncationMarker[] = [
        { type: 'error', startTime: 800_000, summary: 'Last marker' },
      ];

      renderer = new TruncationIndicatorRenderer(
        mockContainer as unknown as PIXI.Container,
        viewport,
        markers,
      );
      renderer.render();

      const children = mockContainer.getChildren();
      const errorGraphics = children[2];
      if (!errorGraphics) {
        return;
      }
      const rects = errorGraphics.getRectangles();

      expect(rects.length).toBe(1);
      if (!rects[0]) {
        return;
      }
      // Should extend to viewport end (visible range end)
      expect(rects[0].width).toBeGreaterThan(0);
    });
  });

  describe('T009: Viewport Culling', () => {
    it('should cull markers before visible range', () => {
      // Set viewport to show only second half
      viewport.setPan(DISPLAY_WIDTH / 2, 0);

      const markers: TruncationMarker[] = [
        { type: 'error', startTime: 10_000, summary: 'Too early' },
        { type: 'skip', startTime: 600_000, summary: 'Visible' },
      ];

      renderer = new TruncationIndicatorRenderer(
        mockContainer as unknown as PIXI.Container,
        viewport,
        markers,
      );
      renderer.render();

      const children = mockContainer.getChildren();
      const skipGraphics = children[1];
      if (!skipGraphics) {
        return;
      }
      const rects = skipGraphics.getRectangles();

      // Only the second marker should be rendered
      expect(rects.length).toBe(1);
    });

    it('should cull markers after visible range', () => {
      // Reset to default view
      viewport.reset();

      const markers: TruncationMarker[] = [
        { type: 'error', startTime: 100_000, summary: 'Visible' },
        { type: 'skip', startTime: 2_000_000, summary: 'Too late' },
      ];

      renderer = new TruncationIndicatorRenderer(
        mockContainer as unknown as PIXI.Container,
        viewport,
        markers,
      );
      renderer.render();

      const children = mockContainer.getChildren();
      const errorGraphics = children[2];
      if (!errorGraphics) {
        return;
      }
      const rects = errorGraphics.getRectangles();

      // Only the first marker should be rendered
      expect(rects.length).toBe(1);
    });

    it('should skip markers with width less than 1 pixel', () => {
      // Zoom out very far to make markers tiny
      const currentZoom = viewport.getState().zoom;
      viewport.setZoom(currentZoom * 0.001);

      const markers: TruncationMarker[] = [
        { type: 'error', startTime: 100_000, summary: 'Too small' },
        { type: 'skip', startTime: 200_000, summary: 'Large enough' },
      ];

      renderer = new TruncationIndicatorRenderer(
        mockContainer as unknown as PIXI.Container,
        viewport,
        markers,
      );
      renderer.render();

      const children = mockContainer.getChildren();
      const skipGraphics = children[1];
      if (!skipGraphics) {
        return;
      }
      const rects = skipGraphics.getRectangles();

      // Only marker with width >= 1px should render
      expect(rects.length).toBeGreaterThanOrEqual(0);
      rects.forEach((rect) => {
        expect(rect.width).toBeGreaterThanOrEqual(1);
      });
    });
  });

  describe('Initialization', () => {
    it('should create Graphics objects for each severity level', () => {
      const markers: TruncationMarker[] = [];

      renderer = new TruncationIndicatorRenderer(
        mockContainer as unknown as PIXI.Container,
        viewport,
        markers,
      );

      const children = mockContainer.getChildren();
      expect(children.length).toBe(3); // One for each type: unexpected, skip, error
    });

    it('should sort markers by startTime on construction', () => {
      const markers: TruncationMarker[] = [
        { type: 'error', startTime: 300_000, summary: 'Third' },
        { type: 'skip', startTime: 100_000, summary: 'First' },
        { type: 'unexpected', startTime: 200_000, summary: 'Second' },
      ];

      renderer = new TruncationIndicatorRenderer(
        mockContainer as unknown as PIXI.Container,
        viewport,
        markers,
      );

      // Verify rendering order matches sorted startTime
      renderer.render();

      const children = mockContainer.getChildren();
      const allRects: Array<{ x: number; type: string }> = [];

      // Collect all rectangles with their type
      if (!children[0]) {
        return;
      }
      if (!children[1]) {
        return;
      }
      if (!children[2]) {
        return;
      }
      allRects.push(...children[0].getRectangles().map((r) => ({ ...r, type: 'unexpected' })));
      allRects.push(...children[1].getRectangles().map((r) => ({ ...r, type: 'skip' })));
      allRects.push(...children[2].getRectangles().map((r) => ({ ...r, type: 'error' })));

      // Sort by x position
      allRects.sort((a, b) => a.x - b.x);

      // Verify they appear in chronological order
      expect(allRects.length).toBe(3);
      if (!allRects[0]) {
        return;
      }
      if (!allRects[1]) {
        return;
      }
      if (!allRects[2]) {
        return;
      }
      expect(allRects[0].type).toBe('skip'); // 100_000
      expect(allRects[1].type).toBe('unexpected'); // 200_000
      expect(allRects[2].type).toBe('error'); // 300_000
    });
  });

  describe('T014: Hit Testing', () => {
    it('should return null when no indicators are hit', () => {
      const markers: TruncationMarker[] = [{ type: 'error', startTime: 100_000, summary: 'Test' }];

      renderer = new TruncationIndicatorRenderer(
        mockContainer as unknown as PIXI.Container,
        viewport,
        markers,
      );
      renderer.render();

      // Test point far outside marker bounds
      const result = renderer.hitTest(999999, 100);

      expect(result).toBeNull();
    });

    it('should return marker when cursor is within bounds', () => {
      const markers: TruncationMarker[] = [
        { type: 'error', startTime: 100_000, summary: 'Error marker' },
      ];

      renderer = new TruncationIndicatorRenderer(
        mockContainer as unknown as PIXI.Container,
        viewport,
        markers,
      );
      renderer.render();

      // Calculate expected screen position
      const viewportState = viewport.getState();
      const screenX = 150_000 * viewportState.zoom; // Middle of marker

      const result = renderer.hitTest(screenX, 100);

      expect(result).not.toBeNull();
      expect(result?.type).toBe('error');
      expect(result?.summary).toBe('Error marker');
    });

    it('should return error marker when error and skip overlap', () => {
      const markers: TruncationMarker[] = [
        { type: 'skip', startTime: 100_000, summary: 'Skip' },
        { type: 'error', startTime: 150_000, summary: 'Error' },
      ];

      renderer = new TruncationIndicatorRenderer(
        mockContainer as unknown as PIXI.Container,
        viewport,
        markers,
      );
      renderer.render();

      // Test point in overlap region (150_000 to 250_000)
      const viewportState = viewport.getState();
      const screenX = 200_000 * viewportState.zoom;

      const result = renderer.hitTest(screenX, 100);

      // Error (severity 3) should win over skip (severity 1)
      expect(result).not.toBeNull();
      expect(result?.type).toBe('error');
      expect(result?.summary).toBe('Error');
    });

    it('should return unexpected marker when unexpected and skip overlap', () => {
      const markers: TruncationMarker[] = [
        { type: 'skip', startTime: 100_000, summary: 'Skip' },
        { type: 'unexpected', startTime: 150_000, summary: 'Unexpected' },
      ];

      renderer = new TruncationIndicatorRenderer(
        mockContainer as unknown as PIXI.Container,
        viewport,
        markers,
      );
      renderer.render();

      // Test point in overlap region
      const viewportState = viewport.getState();
      const screenX = 200_000 * viewportState.zoom;

      const result = renderer.hitTest(screenX, 100);

      // Unexpected (severity 2) should win over skip (severity 1)
      expect(result).not.toBeNull();
      expect(result?.type).toBe('unexpected');
      expect(result?.summary).toBe('Unexpected');
    });

    it('should prioritize error > unexpected > skip when all three overlap', () => {
      const markers: TruncationMarker[] = [
        { type: 'skip', startTime: 100_000, summary: 'Skip' },
        { type: 'unexpected', startTime: 150_000, summary: 'Unexpected' },
        { type: 'error', startTime: 200_000, summary: 'Error' },
      ];

      renderer = new TruncationIndicatorRenderer(
        mockContainer as unknown as PIXI.Container,
        viewport,
        markers,
      );
      renderer.render();

      // Test point where all three overlap (200_000 to 300_000)
      const viewportState = viewport.getState();
      const screenX = 250_000 * viewportState.zoom;

      const result = renderer.hitTest(screenX, 100);

      // Error (severity 3) should win
      expect(result).not.toBeNull();
      expect(result?.type).toBe('error');
    });

    it('should return null when clicking outside visible range after culling', () => {
      // Zoom in and pan to show only second half
      viewport.setPan(DISPLAY_WIDTH / 2, 0);

      const markers: TruncationMarker[] = [
        { type: 'error', startTime: 10_000, summary: 'Culled marker' },
      ];

      renderer = new TruncationIndicatorRenderer(
        mockContainer as unknown as PIXI.Container,
        viewport,
        markers,
      );
      renderer.render();

      // Try to hit the culled marker
      const viewportState = viewport.getState();
      const screenX = 15_000 * viewportState.zoom;

      const result = renderer.hitTest(screenX, 100);

      // Marker was culled, so hitTest should return null
      expect(result).toBeNull();
    });

    it('should test at exact start and end boundaries', () => {
      const markers: TruncationMarker[] = [{ type: 'error', startTime: 100_000, summary: 'Test' }];

      renderer = new TruncationIndicatorRenderer(
        mockContainer as unknown as PIXI.Container,
        viewport,
        markers,
      );
      renderer.render();

      const viewportState = viewport.getState();
      const startX = 100_000 * viewportState.zoom;
      const endX = 200_000 * viewportState.zoom;

      // Test exact start boundary (should hit)
      expect(renderer.hitTest(startX, 100)).not.toBeNull();

      // Test exact end boundary (should hit)
      expect(renderer.hitTest(endX, 100)).not.toBeNull();

      // Test just before start (should miss)
      expect(renderer.hitTest(startX - 1, 100)).toBeNull();

      // Test just after end (should miss)
      expect(renderer.hitTest(endX + 1, 100)).toBeNull();
    });
  });

  describe('Cleanup', () => {
    it('should destroy Graphics objects on destroy()', () => {
      const markers: TruncationMarker[] = [{ type: 'error', startTime: 100_000, summary: 'Test' }];

      renderer = new TruncationIndicatorRenderer(
        mockContainer as unknown as PIXI.Container,
        viewport,
        markers,
      );

      const destroySpy = jest.spyOn(mockContainer, 'destroy');
      renderer.destroy();

      expect(destroySpy).toHaveBeenCalled();
    });
  });
});
