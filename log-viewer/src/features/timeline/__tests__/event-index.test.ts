/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';
import type { LogEvent } from '@apexdevtools/apex-log-parser';

import { makeViewport } from '#test-helpers/viewport.js';
import { TimelineEventIndex } from '../optimised/TimelineEventIndex.js';

function createEvent(timestamp: number, duration: number, children: LogEvent[] = []): LogEvent {
  return {
    timestamp,
    exitStamp: timestamp + duration,
    duration: { total: duration, exclusive: duration },
    children,
    text: `Event at ${timestamp}`,
    lineNumber: 0,
    category: 'Method',
    subcategory: 'Method',
  } as unknown as LogEvent;
}

// [0-100], [200-300], [400-500]
const flat = () => [createEvent(0, 100), createEvent(200, 100), createEvent(400, 100)];
// [0-100] holding [50-70]
const nested = () => [createEvent(0, 100, [createEvent(50, 20)])];
// [0-100] holding [50-80] holding [60-70]
const deep = () => [createEvent(0, 100, [createEvent(50, 30, [createEvent(60, 10)])])];

describe('TimelineEventIndex', () => {
  it.each<[string, () => LogEvent[], number, number]>([
    ['flat events', flat, 0, 500],
    ['nested events', nested, 1, 100],
    [
      'four levels',
      () => [
        createEvent(0, 100, [createEvent(10, 60, [createEvent(20, 40, [createEvent(30, 10)])])]),
      ],
      3,
      100,
    ],
    [
      'uneven durations',
      () => [createEvent(0, 100), createEvent(200, 150), createEvent(500, 200)],
      0,
      700,
    ],
    ['no events', () => [], 0, 0],
    ['an extremely large timestamp', () => [createEvent(1e12, 1000)], 0, 1e12 + 1000],
  ])('reads the depth and duration of %s', (_name, events, maxDepth, totalDuration) => {
    const index = new TimelineEventIndex(events());

    expect(index.maxDepth).toBe(maxDepth);
    expect(index.totalDuration).toBe(totalDuration);
  });

  describe('findEventAtPosition', () => {
    it.each<
      [
        string,
        () => LogEvent[],
        number,
        Parameters<typeof makeViewport>[0],
        number,
        boolean,
        number | null,
      ]
    >([
      ['an event under the pointer', flat, 50, {}, 0, false, 0],
      ['an event at 2x zoom', flat, 100, { zoom: 2 }, 0, false, 0],
      ['an event under a pan offset', flat, 150, { offsetX: 100 }, 0, false, 200],
      ['nothing between events', flat, 150, {}, 0, false, null],
      ['nothing before all events', () => [createEvent(100, 100)], 50, {}, 0, false, null],
      ['nothing after all events', flat, 600, {}, 0, false, null],
      [
        'nothing narrower than the minimum width',
        () => [createEvent(0, 0.01)],
        0,
        {},
        0,
        false,
        null,
      ],
      ['a narrow event when width is ignored', () => [createEvent(0, 0.01)], 0, {}, 0, true, 0],
      ['nothing for a zero-duration event', () => [createEvent(100, 0)], 100, {}, 0, false, null],
      ['the parent at depth 0', nested, 10, {}, 0, false, 0],
      ['the parent, not the child under it, at depth 0', nested, 60, {}, 0, false, 0],
      ['the child at depth 1', nested, 60, {}, 1, false, 50],
      ['a grandchild at depth 2', deep, 65, {}, 2, false, 60],
      ['nothing past the deepest level', nested, 60, {}, 5, false, null],
      [
        'one of several events at the same timestamp',
        () => [createEvent(100, 50), createEvent(100, 50), createEvent(100, 50)],
        120,
        {},
        0,
        false,
        100,
      ],
    ])('finds %s', (_name, events, screenX, viewport, depth, ignoreWidth, expected) => {
      const index = new TimelineEventIndex(events());

      const found = index.findEventAtPosition(
        screenX,
        300,
        makeViewport(viewport),
        depth,
        ignoreWidth,
      );

      expect(found?.timestamp ?? null).toBe(expected);
    });
  });

  describe('findEventsInRegion', () => {
    it.each<[string, () => LogEvent[], [number, number, number, number], number[]]>([
      ['every event in a region covering all', flat, [0, 500, 0, 1], [0, 200, 400]],
      ['only the events inside the time range', flat, [150, 350, 0, 1], [200]],
      [
        'an event the region only partly overlaps',
        () => [createEvent(100, 100)],
        [150, 300, 0, 1],
        [100],
      ],
      ['only the events inside the depth range', nested, [0, 200, 0, 0], [0]],
      ['nested events across both depths', nested, [0, 200, 0, 1], [0, 50]],
      ['nothing in a region after all events', flat, [600, 1000, 0, 1], []],
    ])('finds %s', (_name, events, [timeStart, timeEnd, depthStart, depthEnd], expected) => {
      const index = new TimelineEventIndex(events());

      const found = index.findEventsInRegion({ timeStart, timeEnd, depthStart, depthEnd });

      expect(found.map((event) => event.timestamp).sort((a, b) => a - b)).toEqual(expected);
    });
  });
});
