/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';

import {
  layoutMarkerRects,
  markerDuration,
  type MarkerLayoutItem,
} from '../markers/MarkerProcessor.js';

/** Point marker (exception hairline): exactWidth 0. */
function point(screenStartX: number): MarkerLayoutItem {
  return { screenStartX, exactWidth: 0, color: 0xe5484d, alpha: 0.9 };
}

/** Bounded band. */
function band(screenStartX: number, exactWidth: number): MarkerLayoutItem {
  return { screenStartX, exactWidth, color: 0x1e80ff, alpha: 0.2 };
}

const MIN = 3;
const GAP = 1;

describe('markerDuration', () => {
  it('returns end - start for a bounded marker', () => {
    expect(markerDuration({ startTime: 100, endTime: 500 })).toBe(400);
  });

  it('returns 0 for a point marker with no endTime (does not extend to a next marker)', () => {
    expect(markerDuration({ startTime: 100 })).toBe(0);
  });
});

describe('layoutMarkerRects', () => {
  it('clamps a point to the minimum width', () => {
    const rects = layoutMarkerRects([point(10)], MIN, GAP);
    expect(rects).toEqual([{ x: 10, width: MIN, color: 0xe5484d, alpha: 0.9 }]);
  });

  it('draws a band at its exact width when wider than the minimum', () => {
    const rects = layoutMarkerRects([band(10, 50)], MIN, GAP);
    expect(rects[0]!.width).toBe(50);
  });

  it('keeps a >= gap between two just-separated points', () => {
    // First point occupies [10, 13]; second at 14 clears the 1px gap.
    const rects = layoutMarkerRects([point(10), point(14)], MIN, GAP);
    expect(rects).toHaveLength(2);
    expect(rects[1]!.x - (rects[0]!.x + rects[0]!.width)).toBeGreaterThanOrEqual(GAP);
  });

  it('buckets points that fall within the gap (collapses a dense cluster)', () => {
    // First point [10,13]; the next two start within [13, 14) so they bucket away.
    const rects = layoutMarkerRects([point(10), point(11), point(13)], MIN, GAP);
    expect(rects).toHaveLength(1);
    expect(rects[0]!.x).toBe(10);
  });

  it('shifts a colliding band right to preserve the gap rather than dropping it', () => {
    // Band A [0,50]; band B starts at 50 (would touch) -> shifted to 51.
    const rects = layoutMarkerRects([band(0, 50), band(50, 20)], MIN, GAP);
    expect(rects).toHaveLength(2);
    expect(rects[1]!.x).toBe(51);
    expect(rects[1]!.x - (rects[0]!.x + rects[0]!.width)).toBeGreaterThanOrEqual(GAP);
  });

  it('draws well-separated markers unchanged', () => {
    const rects = layoutMarkerRects([point(10), point(100)], MIN, GAP);
    expect(rects.map((r) => r.x)).toEqual([10, 100]);
  });

  describe('bucketDistance (heavier bucketing when zoomed out)', () => {
    const BUCKET = 4;

    it('merges points within bucketDistance that would otherwise render separately', () => {
      // Point A [10,13]; B at 14 clears the 1px gap but is within lastEnd(13)+4 -> bucketed.
      const rects = layoutMarkerRects([point(10), point(14)], MIN, GAP, BUCKET);
      expect(rects).toHaveLength(1);
      expect(rects[0]!.x).toBe(10);
    });

    it('renders points separately once they clear the bucketDistance', () => {
      // Point A [10,13]; B at 17 is >= lastEnd(13)+4 -> drawn separately.
      const rects = layoutMarkerRects([point(10), point(17)], MIN, GAP, BUCKET);
      expect(rects.map((r) => r.x)).toEqual([10, 17]);
    });

    it('does not affect band separation (bands still use gap)', () => {
      const rects = layoutMarkerRects([band(0, 50), band(50, 20)], MIN, GAP, BUCKET);
      expect(rects).toHaveLength(2);
      expect(rects[1]!.x).toBe(51);
    });
  });
});
