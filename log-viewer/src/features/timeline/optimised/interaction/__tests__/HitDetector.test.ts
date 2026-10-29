/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';

import { type FrameSpec, rectsOf, timelineEvent } from '#test-helpers/timeline.js';
import { makeViewport } from '#test-helpers/viewport.js';
import type { EventNode } from '../../../types/flamechart.types.js';
import { RectangleCache } from '../../RectangleCache.js';
import { HitDetector, type HitTestConfig } from '../HitDetector.js';

// [0-100], [200-300], [400-500]
const flat = () => [timelineEvent(0, 100), timelineEvent(200, 100), timelineEvent(400, 100)];
// [0-100] holding [50-70]
const nested = () => [timelineEvent(0, 100, 'Apex', [timelineEvent(50, 20)])];
// [0-100] holding [50-80] holding [60-70]
const deep = () => [
  timelineEvent(0, 100, 'Apex', [timelineEvent(50, 30, 'Apex', [timelineEvent(60, 10)])]),
];

function detectorFor(
  rects: ReturnType<typeof rectsOf>,
  cache: RectangleCache,
  buckets: HitTestConfig['buckets'],
): HitDetector {
  return new HitDetector({
    nodeOf: (row): EventNode => ({
      id: String(row),
      timestamp: rects.start[row]!,
      duration: rects.total[row]!,
      type: '',
      text: '',
    }),
    columns: rects,
    visibleRects: new Map(),
    buckets,
    rectangleManager: cache,
  });
}

/** The start of the frame under `screenX` at `depth`, with nothing drawn yet to hit first. */
function hitAt(
  frames: FrameSpec[],
  screenX: number,
  depth: number,
  viewport = makeViewport(),
): number | null {
  const rects = rectsOf(frames);
  const detector = detectorFor(rects, new RectangleCache(rects), new Map());
  const maxDepth = Math.max(0, rects.rectRowsByDepth.length - 1);
  return detector.hitTest(screenX, 300, depth, viewport, maxDepth).eventNode?.timestamp ?? null;
}

/** The start of the frame a hover picks from the buckets a real cull drew at depth 0. */
function bucketHitAt(frames: FrameSpec[], screenX: number): number | null {
  const rects = rectsOf(frames);
  const cache = new RectangleCache(rects);
  const viewport = makeViewport();
  const { buckets } = cache.getCulledRectangles(viewport, new Map());
  const detector = detectorFor(rects, cache, buckets);
  return detector.hitTest(screenX, 300, 0, viewport, 0).eventNode?.timestamp ?? null;
}

// Both frames are under a pixel wide and neither is under the pointer, so only the bucket answers.
describe('HitDetector, over a bucket', () => {
  it('picks the higher-priority category, though it is shorter', () => {
    const frames = [timelineEvent(0, 0.4, 'Apex'), timelineEvent(0.5, 0.3, 'SOQL')];

    expect(bucketHitAt(frames, 1.5)).toBe(0.5);
  });

  it('picks the longest frame of one category', () => {
    const frames = [timelineEvent(0, 0.5, 'Apex'), timelineEvent(0.6, 0.2, 'Apex')];

    expect(bucketHitAt(frames, 1.5)).toBe(0);
  });
});

describe('HitDetector, before a render has drawn anything', () => {
  it.each<
    [string, () => FrameSpec[], number, Parameters<typeof makeViewport>[0], number, number | null]
  >([
    ['an event under the pointer', flat, 50, {}, 0, 0],
    ['an event at 2x zoom', flat, 100, { zoom: 2 }, 0, 0],
    ['an event under a pan offset', flat, 150, { offsetX: 100 }, 0, 200],
    ['nothing between events', flat, 150, {}, 0, null],
    ['nothing before all events', () => [timelineEvent(100, 100)], 50, {}, 0, null],
    ['nothing after all events', flat, 600, {}, 0, null],
    [
      'nothing narrower than the minimum width',
      () => [timelineEvent(10, 0.01)],
      10.005,
      {},
      0,
      null,
    ],
    ['a frame just at the minimum width', () => [timelineEvent(10, 0.05)], 10.02, {}, 0, 10],
    ['nothing for a zero-duration event', () => [timelineEvent(100, 0)], 100, {}, 0, null],
    ['the parent at depth 0', nested, 10, {}, 0, 0],
    ['the parent, not the child under it, at depth 0', nested, 60, {}, 0, 0],
    ['the child at depth 1', nested, 60, {}, 1, 50],
    ['a grandchild at depth 2', deep, 65, {}, 2, 60],
    ['nothing past the deepest level', nested, 60, {}, 5, null],
  ])('finds %s', (_name, frames, screenX, viewport, depth, expected) => {
    expect(hitAt(frames(), screenX, depth, makeViewport(viewport))).toBe(expected);
  });
});
