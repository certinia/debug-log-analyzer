/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';

import type { TimelineMarker } from '../../types/flamechart.types.js';
import { hitTestMarkers, type MarkerIndicator } from '../markers/MarkerHitTest.js';

function createMarker(
  id: string,
  type: TimelineMarker['type'],
  summary = `${type} marker`,
): TimelineMarker {
  return { id, type, summary, startTime: 1000 };
}

function span(
  id: string,
  type: TimelineMarker['type'],
  start: number,
  end: number,
  summary?: string,
): MarkerIndicator {
  return {
    marker: createMarker(id, type, summary),
    resolvedEndTime: 2000,
    screenStartX: start,
    screenEndX: end,
    screenWidth: end - start,
    exactWidth: end - start,
    color: 0xff0000,
    alpha: 0.2,
    isVisible: true,
  };
}

const LAYOUTS = {
  one: () => [span('m1', 'error', 100, 200)],
  two: () => [span('m1', 'error', 100, 200), span('m2', 'skip', 300, 400)],
  // Listed least severe first, so the pick is by severity, not by order.
  stacked: () => [
    span('skip', 'skip', 100, 300),
    span('unexpected', 'unexpected', 100, 300),
    span('error', 'error', 100, 300),
  ],
  noError: () => [span('skip', 'skip', 100, 300), span('unexpected', 'unexpected', 100, 300)],
  partial: () => [span('error', 'error', 100, 200), span('skip', 'skip', 150, 300)],
  far: () => [span('m1', 'error', 500, 600)],
  huge: () => [span('m1', 'error', 1_000_000, 1_000_100)],
  origin: () => [span('m1', 'error', 0, 100)],
  zeroWidth: () => [span('m1', 'error', 100, 100)],
  onePixel: () => [span('m1', 'error', 100, 101)],
  empty: () => [],
};

describe('hitTestMarkers', () => {
  // The world x is screenX + offsetX.
  it.each<[string, keyof typeof LAYOUTS, number, number, string | null]>([
    ['inside the marker', 'one', 50, 100, 'm1'],
    ['before the marker', 'one', 0, 50, null],
    ['after the marker', 'one', 200, 50, null],
    ['on the left edge', 'one', 0, 100, 'm1'],
    ['on the right edge', 'one', 100, 100, 'm1'],
    ['in the first of two', 'two', 50, 100, 'm1'],
    ['in the second of two', 'two', 250, 100, 'm2'],
    ['in the gap between two', 'two', 150, 100, null],
    ['error over unexpected over skip', 'stacked', 100, 100, 'error'],
    ['unexpected over skip', 'noError', 100, 100, 'unexpected'],
    ['the more severe in a partial overlap', 'partial', 75, 100, 'error'],
    ['the only marker past the overlap', 'partial', 150, 100, 'skip'],
    ['the only marker before the overlap', 'partial', 20, 100, 'error'],
    ['inside after a large offset', 'far', 150, 400, 'm1'],
    ['before after a large offset', 'far', 50, 400, null],
    ['before after a small offset', 'far', 350, 100, null],
    ['inside after a small offset', 'far', 450, 100, 'm1'],
    ['inside, far into the timeline', 'huge', 50, 1_000_000, 'm1'],
    ['on the left edge, far into the timeline', 'huge', 0, 1_000_000, 'm1'],
    ['after, far into the timeline', 'huge', 200, 1_000_000, null],
    ['at the world origin', 'origin', 0, 0, 'm1'],
    ['inside a marker at the origin', 'origin', 50, 0, 'm1'],
    ['after a marker at the origin', 'origin', 150, 0, null],
    ['on a zero-width marker', 'zeroWidth', 0, 100, 'm1'],
    ['on the start of a 1px marker', 'onePixel', 0, 100, 'm1'],
    ['on the end of a 1px marker', 'onePixel', 1, 100, 'm1'],
    ['past a 1px marker', 'onePixel', 2, 100, null],
    ['nothing with no markers', 'empty', 100, 0, null],
  ])('hits %s', (_name, layout, screenX, offsetX, expected) => {
    const indicators = LAYOUTS[layout]();
    const marker = indicators.find((indicator) => indicator.marker.id === expected)?.marker;

    expect(hitTestMarkers(screenX, offsetX, indicators)).toBe(marker ?? null);
  });

  describe('exception aggregation', () => {
    const exception = (id: string, summary: string, start: number, end: number) =>
      span(id, 'exception', start, end, summary);

    it('aggregates overlapping exceptions into a count with the messages', () => {
      const indicators = [
        exception('e1', 'NullPointer', 100, 102),
        exception('e2', 'LimitException', 100, 102),
        exception('e3', 'DmlException', 101, 103),
      ];

      const result = hitTestMarkers(1, 100, indicators);

      expect(result?.summary).toBe('3 exceptions');
      expect(result?.metadata).toContain('NullPointer');
      expect(result?.metadata).toContain('DmlException');
    });

    it('returns the single exception message when only one is hit', () => {
      const result = hitTestMarkers(1, 100, [exception('e1', 'NullPointer', 100, 102)]);

      expect(result?.summary).toBe('NullPointer');
    });
  });
});
