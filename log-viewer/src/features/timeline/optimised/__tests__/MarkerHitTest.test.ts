/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

import type { TimelineMarker } from '../../types/flamechart.types.js';
import { hitTestMarkers, type MarkerIndicator } from '../markers/MarkerHitTest.js';

/**
 * Tests for MarkerHitTest - marker hit testing for hover detection.
 */

// Helper to create marker
function createMarker(
  id: string,
  type: 'error' | 'skip' | 'unexpected',
  startTime: number,
): TimelineMarker {
  return {
    id,
    type,
    summary: `${type} marker`,
    startTime,
  };
}

// Helper to create indicator
function createIndicator(
  marker: TimelineMarker,
  screenStartX: number,
  screenEndX: number,
): MarkerIndicator {
  return {
    marker,
    resolvedEndTime: marker.startTime + 1000,
    screenStartX,
    screenEndX,
    screenWidth: screenEndX - screenStartX,
    color: 0xff0000,
    isVisible: true,
  };
}

describe('MarkerHitTest', () => {
  describe('hitTestMarkers', () => {
    describe('single marker', () => {
      it('should return marker when click is within bounds', () => {
        const marker = createMarker('m1', 'error', 1000);
        const indicator = createIndicator(marker, 100, 200);

        const result = hitTestMarkers(50, 100, [indicator]); // worldX = 150

        expect(result).toBe(marker);
      });

      it('should return null when click is before marker', () => {
        const marker = createMarker('m1', 'error', 1000);
        const indicator = createIndicator(marker, 100, 200);

        const result = hitTestMarkers(0, 50, [indicator]); // worldX = 50

        expect(result).toBeNull();
      });

      it('should return null when click is after marker', () => {
        const marker = createMarker('m1', 'error', 1000);
        const indicator = createIndicator(marker, 100, 200);

        const result = hitTestMarkers(200, 50, [indicator]); // worldX = 250

        expect(result).toBeNull();
      });

      it('should handle click exactly on left edge', () => {
        const marker = createMarker('m1', 'error', 1000);
        const indicator = createIndicator(marker, 100, 200);

        const result = hitTestMarkers(0, 100, [indicator]); // worldX = 100

        expect(result).toBe(marker);
      });

      it('should handle click exactly on right edge', () => {
        const marker = createMarker('m1', 'error', 1000);
        const indicator = createIndicator(marker, 100, 200);

        const result = hitTestMarkers(100, 100, [indicator]); // worldX = 200

        expect(result).toBe(marker);
      });
    });

    describe('multiple markers without overlap', () => {
      it('should return correct marker for each region', () => {
        const marker1 = createMarker('m1', 'error', 1000);
        const marker2 = createMarker('m2', 'skip', 2000);
        const indicators = [createIndicator(marker1, 100, 200), createIndicator(marker2, 300, 400)];

        expect(hitTestMarkers(50, 100, indicators)).toBe(marker1); // worldX = 150
        expect(hitTestMarkers(250, 100, indicators)).toBe(marker2); // worldX = 350
      });

      it('should return null in gap between markers', () => {
        const marker1 = createMarker('m1', 'error', 1000);
        const marker2 = createMarker('m2', 'skip', 2000);
        const indicators = [createIndicator(marker1, 100, 200), createIndicator(marker2, 300, 400)];

        const result = hitTestMarkers(150, 100, indicators); // worldX = 250

        expect(result).toBeNull();
      });
    });

    describe('overlapping markers with severity', () => {
      it('should return highest severity marker (error > unexpected > skip)', () => {
        const errorMarker = createMarker('m1', 'error', 1000);
        const skipMarker = createMarker('m2', 'skip', 1000);
        const unexpectedMarker = createMarker('m3', 'unexpected', 1000);

        const indicators = [
          createIndicator(skipMarker, 100, 300),
          createIndicator(unexpectedMarker, 100, 300),
          createIndicator(errorMarker, 100, 300),
        ];

        const result = hitTestMarkers(100, 100, indicators); // worldX = 200

        expect(result).toBe(errorMarker);
      });

      it('should return unexpected over skip when no error present', () => {
        const skipMarker = createMarker('m1', 'skip', 1000);
        const unexpectedMarker = createMarker('m2', 'unexpected', 1000);

        const indicators = [
          createIndicator(skipMarker, 100, 300),
          createIndicator(unexpectedMarker, 100, 300),
        ];

        const result = hitTestMarkers(100, 100, indicators); // worldX = 200

        expect(result).toBe(unexpectedMarker);
      });

      it('should handle partial overlap correctly', () => {
        const errorMarker = createMarker('m1', 'error', 1000);
        const skipMarker = createMarker('m2', 'skip', 1500);

        const indicators = [
          createIndicator(errorMarker, 100, 200),
          createIndicator(skipMarker, 150, 300), // Overlaps 150-200
        ];

        // Click in overlap region - error wins
        expect(hitTestMarkers(75, 100, indicators)).toBe(errorMarker); // worldX = 175

        // Click in skip-only region
        expect(hitTestMarkers(150, 100, indicators)).toBe(skipMarker); // worldX = 250

        // Click in error-only region
        expect(hitTestMarkers(20, 100, indicators)).toBe(errorMarker); // worldX = 120
      });
    });

    describe('viewport offset handling', () => {
      it('should correctly apply viewport offset', () => {
        const marker = createMarker('m1', 'error', 1000);
        const indicator = createIndicator(marker, 500, 600); // World coords

        // With offset 400, screenX 150 -> worldX 550 (inside marker)
        expect(hitTestMarkers(150, 400, [indicator])).toBe(marker);

        // With offset 400, screenX 50 -> worldX 450 (before marker)
        expect(hitTestMarkers(50, 400, [indicator])).toBeNull();

        // With offset 100, screenX 350 -> worldX 450 (before marker)
        expect(hitTestMarkers(350, 100, [indicator])).toBeNull();

        // With offset 100, screenX 450 -> worldX 550 (inside marker)
        expect(hitTestMarkers(450, 100, [indicator])).toBe(marker);
      });
    });

    describe('edge cases', () => {
      it('should return null for empty indicators array', () => {
        const result = hitTestMarkers(100, 0, []);

        expect(result).toBeNull();
      });

      it('should handle zero-width marker', () => {
        const marker = createMarker('m1', 'error', 1000);
        const indicator = createIndicator(marker, 100, 100); // Zero width

        // Click exactly on the point
        const result = hitTestMarkers(0, 100, [indicator]); // worldX = 100

        expect(result).toBe(marker);
      });

      it('should handle very large offsetX values', () => {
        const marker = createMarker('m1', 'error', 1000);
        const indicator = createIndicator(marker, 1_000_000, 1_000_100); // Far into timeline

        // With large offset, screenX 50 -> worldX = 1_000_050 (inside marker)
        expect(hitTestMarkers(50, 1_000_000, [indicator])).toBe(marker);

        // With large offset, screenX 0 -> worldX = 1_000_000 (on left edge)
        expect(hitTestMarkers(0, 1_000_000, [indicator])).toBe(marker);

        // Miss: screenX 200 -> worldX = 1_000_200 (after marker)
        expect(hitTestMarkers(200, 1_000_000, [indicator])).toBeNull();
      });

      it('should handle markers at world coordinate zero', () => {
        const marker = createMarker('m1', 'error', 0);
        const indicator = createIndicator(marker, 0, 100); // Starts at world origin

        // Click at world origin with no offset
        expect(hitTestMarkers(0, 0, [indicator])).toBe(marker);

        // Click inside marker
        expect(hitTestMarkers(50, 0, [indicator])).toBe(marker);

        // Click after marker
        expect(hitTestMarkers(150, 0, [indicator])).toBeNull();
      });

      it('should handle single-pixel-wide marker', () => {
        const marker = createMarker('m1', 'error', 1000);
        const indicator = createIndicator(marker, 100, 101); // 1px wide

        // Hit the marker
        expect(hitTestMarkers(0, 100, [indicator])).toBe(marker); // worldX = 100
        expect(hitTestMarkers(1, 100, [indicator])).toBe(marker); // worldX = 101

        // Miss the marker
        expect(hitTestMarkers(2, 100, [indicator])).toBeNull(); // worldX = 102
      });
    });
  });
});
