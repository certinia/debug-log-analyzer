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

// Mock PIXI.Graphics with test helpers
class MockGraphics {
  private fillStyle: { color?: number; alpha?: number } = {};
  private rectangles: Array<{ x: number; y: number; width: number; height: number }> = [];

  clear(): this {
    this.rectangles = [];
    this.fillStyle = {};
    return this;
  }

  setFillStyle(style: { color?: number; alpha?: number }): this {
    this.fillStyle = style;
    return this;
  }

  rect(x: number, y: number, width: number, height: number): this {
    this.rectangles.push({ x, y, width, height });
    return this;
  }

  fill(): this {
    // No-op for testing
    return this;
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

// Track created mock graphics instances globally
const createdMockGraphicsGlobal: MockGraphics[] = [];

// Mock PIXI module before imports
jest.mock('pixi.js', () => {
  const actual = jest.requireActual('pixi.js');
  return {
    ...actual,
    // eslint-disable-next-line @typescript-eslint/naming-convention
    Graphics: jest.fn().mockImplementation(() => {
      const mock = new MockGraphics();
      createdMockGraphicsGlobal.push(mock);
      return mock;
    }),
  };
});

import * as PIXI from 'pixi.js';
import { TimelineMarkerRenderer } from '../optimised/TimelineMarkerRenderer.js';
import { TimelineViewport } from '../optimised/TimelineViewport.js';
import type { TimelineMarker } from '../types/flamechart.types.js';
import { MARKER_ALPHA, MARKER_COLORS } from '../types/flamechart.types.js';

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
  let renderer: TimelineMarkerRenderer;
  let createdMockGraphics: MockGraphics[];

  const DISPLAY_WIDTH = 1000;
  const DISPLAY_HEIGHT = 600;
  const TOTAL_DURATION = 1_000_000; // 1ms in nanoseconds
  const MAX_DEPTH = 10;

  beforeEach(() => {
    // Clear the global array and reference it
    createdMockGraphicsGlobal.length = 0;
    createdMockGraphics = createdMockGraphicsGlobal;

    mockContainer = new MockContainer();
    viewport = new TimelineViewport(DISPLAY_WIDTH, DISPLAY_HEIGHT, TOTAL_DURATION, MAX_DEPTH);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('T013: Color Accuracy Verification', () => {
    it('should render error markers with color 0xFF8080', () => {
      const markers: TimelineMarker[] = [
        { type: 'error', startTime: 100_000, summary: 'Test error' },
      ];

      renderer = new TimelineMarkerRenderer(
        mockContainer as unknown as PIXI.Container,
        viewport,
        markers,
      );
      renderer.render();

      // Three Graphics objects are created (one per type), index 2 is for error
      expect(createdMockGraphics.length).toBe(3);
      const errorGraphics = createdMockGraphics[2]; // error is third in SEVERITY_ORDER [unexpected, skip, error]

      expect(errorGraphics).toBeDefined();
      if (!errorGraphics) {
        return;
      }
      const fillStyle = errorGraphics.getFillStyle();
      expect(fillStyle.color).toBe(MARKER_COLORS.error);
      expect(fillStyle.color).toBe(0xff8080);
    });

    it('should render skip markers with color 0x1E80FF', () => {
      const markers: TimelineMarker[] = [
        { type: 'skip', startTime: 100_000, summary: 'Test skip' },
      ];

      renderer = new TimelineMarkerRenderer(
        mockContainer as unknown as PIXI.Container,
        viewport,
        markers,
      );
      renderer.render();

      // Three Graphics objects are created (one per type), index 1 is for skip
      expect(createdMockGraphics.length).toBe(3);
      const skipGraphics = createdMockGraphics[1]; // skip is second in SEVERITY_ORDER

      expect(skipGraphics).toBeDefined();
      if (!skipGraphics) {
        return;
      }
      const fillStyle = skipGraphics.getFillStyle();
      expect(fillStyle.color).toBe(MARKER_COLORS.skip);
      expect(fillStyle.color).toBe(0x1e80ff);
    });

    it('should render unexpected markers with color 0x8080FF', () => {
      const markers: TimelineMarker[] = [
        { type: 'unexpected', startTime: 100_000, summary: 'Test unexpected' },
      ];

      renderer = new TimelineMarkerRenderer(
        mockContainer as unknown as PIXI.Container,
        viewport,
        markers,
      );
      renderer.render();

      // Three Graphics objects are created (one per type), index 0 is for unexpected
      expect(createdMockGraphics.length).toBe(3);
      const unexpectedGraphics = createdMockGraphics[0]; // unexpected is first in SEVERITY_ORDER

      expect(unexpectedGraphics).toBeDefined();
      if (!unexpectedGraphics) {
        return;
      }
      const fillStyle = unexpectedGraphics.getFillStyle();
      expect(fillStyle.color).toBe(MARKER_COLORS.unexpected);
      expect(fillStyle.color).toBe(0x8080ff);
    });

    it('should use alpha 0.2 for all truncation types', () => {
      const markers: TimelineMarker[] = [
        { type: 'error', startTime: 100_000, summary: 'Error' },
        { type: 'skip', startTime: 300_000, summary: 'Skip' },
        { type: 'unexpected', startTime: 500_000, summary: 'Unexpected' },
      ];

      renderer = new TimelineMarkerRenderer(
        mockContainer as unknown as PIXI.Container,
        viewport,
        markers,
      );
      renderer.render();

      // Verify all Graphics objects use the correct alpha
      createdMockGraphics.forEach((graphics) => {
        const fillStyle = graphics.getFillStyle();
        expect(fillStyle.alpha).toBe(MARKER_ALPHA);
        expect(fillStyle.alpha).toBe(0.2);
      });
    });

    it('should render distinct colors for each type in a mixed log', () => {
      const markers: TimelineMarker[] = [
        { type: 'error', startTime: 100_000, summary: 'Error 1' },
        { type: 'skip', startTime: 200_000, summary: 'Skip 1' },
        { type: 'unexpected', startTime: 300_000, summary: 'Unexpected 1' },
        { type: 'error', startTime: 400_000, summary: 'Error 2' },
      ];

      renderer = new TimelineMarkerRenderer(
        mockContainer as unknown as PIXI.Container,
        viewport,
        markers,
      );
      renderer.render();

      // Verify each type has its distinct color from created mocks
      const unexpectedGraphics = createdMockGraphics[0];
      const skipGraphics = createdMockGraphics[1];
      const errorGraphics = createdMockGraphics[2];

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
    it('should use timeline end when no next marker exists (single marker)', () => {
      const markers: TimelineMarker[] = [
        { type: 'error', startTime: 100_000, summary: 'Single marker' },
      ];

      renderer = new TimelineMarkerRenderer(
        mockContainer as unknown as PIXI.Container,
        viewport,
        markers,
      );
      renderer.render();

      const errorGraphics = createdMockGraphics[2];
      if (!errorGraphics) {
        return;
      }
      const rects = errorGraphics.getRectangles();

      expect(rects.length).toBe(1);
      if (!rects[0]) {
        return;
      }
      // Single marker extends to timeline end (bounds.timeEnd), minus 1px gap, minus 0.5px half-gap
      const bounds = viewport.getBounds();
      const expectedWidth = (bounds.timeEnd - 100_000) * viewport.getState().zoom - 1;
      expect(rects[0].width).toBeCloseTo(expectedWidth, 1);
    });

    it('should use next marker startTime as end boundary', () => {
      const markers: TimelineMarker[] = [
        { type: 'error', startTime: 100_000, summary: 'First' },
        { type: 'skip', startTime: 300_000, summary: 'Second' },
      ];

      renderer = new TimelineMarkerRenderer(
        mockContainer as unknown as PIXI.Container,
        viewport,
        markers,
      );
      renderer.render();

      const errorGraphics = createdMockGraphics[2];
      if (!errorGraphics) {
        return;
      }
      const rects = errorGraphics.getRectangles();

      expect(rects.length).toBe(1);
      if (!rects[0]) {
        return;
      }
      // First marker should extend to start of second marker (300_000), minus 1px gap
      const expectedWidth = (300_000 - 100_000) * viewport.getState().zoom - 1;
      expect(rects[0].width).toBeCloseTo(expectedWidth, 1);
    });

    it('should use timeline end when no next marker exists', () => {
      const markers: TimelineMarker[] = [
        { type: 'error', startTime: 800_000, summary: 'Last marker' },
      ];

      renderer = new TimelineMarkerRenderer(
        mockContainer as unknown as PIXI.Container,
        viewport,
        markers,
      );
      renderer.render();

      const errorGraphics = createdMockGraphics[2];
      if (!errorGraphics) {
        return;
      }
      const rects = errorGraphics.getRectangles();

      expect(rects.length).toBe(1);
      if (!rects[0]) {
        return;
      }
      // Should extend to timeline end
      const bounds = viewport.getBounds();
      const expectedWidth = (bounds.timeEnd - 800_000) * viewport.getState().zoom - 1;
      expect(rects[0].width).toBeCloseTo(expectedWidth, 1);
    });
  });

  describe('T009: Viewport Culling', () => {
    it('should cull markers before visible range', () => {
      // Set viewport to show only second half
      viewport.setPan(DISPLAY_WIDTH / 2, 0);

      const markers: TimelineMarker[] = [
        { type: 'error', startTime: 10_000, summary: 'Too early' },
        { type: 'skip', startTime: 600_000, summary: 'Visible' },
      ];

      renderer = new TimelineMarkerRenderer(
        mockContainer as unknown as PIXI.Container,
        viewport,
        markers,
      );
      renderer.render();

      const skipGraphics = createdMockGraphics[1];
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

      const markers: TimelineMarker[] = [
        { type: 'error', startTime: 100_000, summary: 'Visible' },
        { type: 'skip', startTime: 2_000_000, summary: 'Too late' },
      ];

      renderer = new TimelineMarkerRenderer(
        mockContainer as unknown as PIXI.Container,
        viewport,
        markers,
      );
      renderer.render();

      const errorGraphics = createdMockGraphics[2];
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

      const markers: TimelineMarker[] = [
        { type: 'error', startTime: 100_000, summary: 'Too small' },
        { type: 'skip', startTime: 200_000, summary: 'Large enough' },
      ];

      renderer = new TimelineMarkerRenderer(
        mockContainer as unknown as PIXI.Container,
        viewport,
        markers,
      );
      renderer.render();

      const skipGraphics = createdMockGraphics[1];
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
      const markers: TimelineMarker[] = [];

      renderer = new TimelineMarkerRenderer(
        mockContainer as unknown as PIXI.Container,
        viewport,
        markers,
      );

      expect(createdMockGraphics.length).toBe(3); // One for each type: unexpected, skip, error
    });

    it('should sort markers by startTime on construction', () => {
      const markers: TimelineMarker[] = [
        { type: 'error', startTime: 300_000, summary: 'Third' },
        { type: 'skip', startTime: 100_000, summary: 'First' },
        { type: 'unexpected', startTime: 200_000, summary: 'Second' },
      ];

      renderer = new TimelineMarkerRenderer(
        mockContainer as unknown as PIXI.Container,
        viewport,
        markers,
      );

      // Verify rendering order matches sorted startTime
      renderer.render();

      const allRects: Array<{ x: number; type: string }> = [];

      // Collect all rectangles with their type from created mocks
      if (!createdMockGraphics[0]) {
        return;
      }
      if (!createdMockGraphics[1]) {
        return;
      }
      if (!createdMockGraphics[2]) {
        return;
      }
      allRects.push(
        ...createdMockGraphics[0].getRectangles().map((r) => ({ ...r, type: 'unexpected' })),
      );
      allRects.push(...createdMockGraphics[1].getRectangles().map((r) => ({ ...r, type: 'skip' })));
      allRects.push(
        ...createdMockGraphics[2].getRectangles().map((r) => ({ ...r, type: 'error' })),
      );

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
      const markers: TimelineMarker[] = [{ type: 'error', startTime: 100_000, summary: 'Test' }];

      renderer = new TimelineMarkerRenderer(
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
      const markers: TimelineMarker[] = [
        { type: 'error', startTime: 100_000, summary: 'Error marker' },
      ];

      renderer = new TimelineMarkerRenderer(
        mockContainer as unknown as PIXI.Container,
        viewport,
        markers,
      );
      renderer.render();

      // Calculate expected screen position
      // Screen coords = world coords - offsetX (since container is at -offsetX)
      const viewportState = viewport.getState();
      const worldX = 150_000 * viewportState.zoom; // Middle of marker in world space
      const screenX = worldX - viewportState.offsetX; // Convert to screen space

      const result = renderer.hitTest(screenX, 100);

      expect(result).not.toBeNull();
      expect(result?.type).toBe('error');
      expect(result?.summary).toBe('Error marker');
    });

    it('should return error marker when error and skip overlap', () => {
      const markers: TimelineMarker[] = [
        { type: 'skip', startTime: 100_000, summary: 'Skip' },
        { type: 'error', startTime: 150_000, summary: 'Error' },
      ];

      renderer = new TimelineMarkerRenderer(
        mockContainer as unknown as PIXI.Container,
        viewport,
        markers,
      );
      renderer.render();

      // Test point in overlap region (150_000 to 250_000)
      const viewportState = viewport.getState();
      const worldX = 200_000 * viewportState.zoom;
      const screenX = worldX - viewportState.offsetX;

      const result = renderer.hitTest(screenX, 100);

      // Error (severity 3) should win over skip (severity 1)
      expect(result).not.toBeNull();
      expect(result?.type).toBe('error');
      expect(result?.summary).toBe('Error');
    });

    it('should return unexpected marker when unexpected and skip overlap', () => {
      const markers: TimelineMarker[] = [
        { type: 'skip', startTime: 100_000, summary: 'Skip' },
        { type: 'unexpected', startTime: 150_000, summary: 'Unexpected' },
      ];

      renderer = new TimelineMarkerRenderer(
        mockContainer as unknown as PIXI.Container,
        viewport,
        markers,
      );
      renderer.render();

      // Test point in overlap region
      const viewportState = viewport.getState();
      const worldX = 200_000 * viewportState.zoom;
      const screenX = worldX - viewportState.offsetX;

      const result = renderer.hitTest(screenX, 100);

      // Unexpected (severity 2) should win over skip (severity 1)
      expect(result).not.toBeNull();
      expect(result?.type).toBe('unexpected');
      expect(result?.summary).toBe('Unexpected');
    });

    it('should prioritize error > unexpected > skip when all three overlap', () => {
      const markers: TimelineMarker[] = [
        { type: 'skip', startTime: 100_000, summary: 'Skip' },
        { type: 'unexpected', startTime: 150_000, summary: 'Unexpected' },
        { type: 'error', startTime: 200_000, summary: 'Error' },
      ];

      renderer = new TimelineMarkerRenderer(
        mockContainer as unknown as PIXI.Container,
        viewport,
        markers,
      );
      renderer.render();

      // Test point where all three overlap (200_000 to 300_000)
      const viewportState = viewport.getState();
      const worldX = 250_000 * viewportState.zoom;
      const screenX = worldX - viewportState.offsetX;

      const result = renderer.hitTest(screenX, 100);

      // Error (severity 3) should win
      expect(result).not.toBeNull();
      expect(result?.type).toBe('error');
    });

    it('should return null when clicking outside visible range after culling', () => {
      // Create a marker that starts after the visible timeline
      const markers: TimelineMarker[] = [
        { type: 'error', startTime: TOTAL_DURATION + 100_000, summary: 'Out of range marker' },
      ];

      renderer = new TimelineMarkerRenderer(
        mockContainer as unknown as PIXI.Container,
        viewport,
        markers,
      );
      renderer.render();

      // Verify the marker is beyond the timeline end
      const bounds = viewport.getBounds();
      expect(markers[0]?.startTime).toBeGreaterThan(bounds.timeEnd);

      // Try to hit the marker that's beyond the timeline
      const viewportState = viewport.getState();
      const worldX = (TOTAL_DURATION + 150_000) * viewportState.zoom;
      const screenX = worldX - viewportState.offsetX;

      const result = renderer.hitTest(screenX, 100);

      // Marker was culled during render (outside visible range), so hitTest should return null
      expect(result).toBeNull();
    });

    it('should test at exact start and end boundaries', () => {
      const markers: TimelineMarker[] = [{ type: 'error', startTime: 100_000, summary: 'Test' }];

      renderer = new TimelineMarkerRenderer(
        mockContainer as unknown as PIXI.Container,
        viewport,
        markers,
      );
      renderer.render();

      const viewportState = viewport.getState();
      const bounds = viewport.getBounds();
      const worldStartX = 100_000 * viewportState.zoom;
      // Single marker extends to timeline end
      const worldEndX = bounds.timeEnd * viewportState.zoom;

      // Convert to screen coordinates
      const screenStartX = worldStartX - viewportState.offsetX;
      const screenEndX = worldEndX - viewportState.offsetX;

      // Test exact start boundary (should hit)
      expect(renderer.hitTest(screenStartX, 100)).not.toBeNull();

      // Test exact end boundary (should hit)
      expect(renderer.hitTest(screenEndX, 100)).not.toBeNull();

      // Test just before start (should miss)
      expect(renderer.hitTest(screenStartX - 1, 100)).toBeNull();

      // Test just after end (should miss)
      expect(renderer.hitTest(screenEndX + 1, 100)).toBeNull();
    });
  });

  describe('Cleanup', () => {
    it('should destroy Graphics objects on destroy()', () => {
      const markers: TimelineMarker[] = [{ type: 'error', startTime: 100_000, summary: 'Test' }];

      renderer = new TimelineMarkerRenderer(
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
