/**
 * @jest-environment jsdom
 */

/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * What a reveal from the inspector does to the view. `revealTarget` holds the
 * policy and is tested with it; this covers the wiring - the frame and axes it
 * works out reach the chart, and a frame needing no move asks for none.
 */

import { describe, expect, it, jest } from '@jest/globals';
import { ApexLogTimeline } from '../optimised/ApexLogTimeline.js';
import type { ViewportBounds, ViewportPanAxes } from '../types/flamechart.types.js';

/** 100,000ns of a log on screen, from 200,000, over six depths. */
const BOUNDS: ViewportBounds = {
  timeStart: 200_000,
  timeEnd: 300_000,
  depthStart: 0,
  depthEnd: 5,
};

type Frame = { eventIndex: number; timestamp: number; total: number };

/** A frame the chart was panned to, with every argument it was given. */
type Panned = { timestamp: number; duration: number; depth: number; axes: ViewportPanAxes };

function timelineWith(...events: Frame[]): {
  revealFromInspector: (eventIndex: number) => void;
  pickMergedRow: (eventIndexes: number[]) => void;
  panned: () => Panned[];
  selected: () => number;
} {
  const timeline = new ApexLogTimeline();
  const internals = timeline as unknown as Record<string, unknown>;
  const panned: Panned[] = [];
  let selected = 0;

  internals['flamechart'] = {
    locateByEventNodes: jest.fn(),
    selectByEventNode: () => {
      selected++;
      return true;
    },
    getViewportManager: () => ({ getBounds: () => BOUNDS }),
    panToFrame: (timestamp: number, duration: number, depth: number, axes: ViewportPanAxes) => {
      panned.push({ timestamp, duration, depth, axes });
    },
  };
  internals['apexLog'] = {
    eventsById: Object.fromEntries(
      events.map((event) => [
        event.eventIndex,
        {
          eventIndex: event.eventIndex,
          timestamp: event.timestamp,
          duration: { total: event.total },
          parent: null,
        },
      ]),
    ),
  };

  const reveal = internals['selectFrameByEventIndex'] as (eventIndex: number) => void;
  const pan = internals['panToNearestFrame'] as (eventIndexes: readonly number[]) => void;

  return {
    revealFromInspector: (eventIndex) => reveal.call(timeline, eventIndex),
    pickMergedRow: (eventIndexes) => pan.call(timeline, eventIndexes),
    panned: () => panned,
    selected: () => selected,
  };
}

describe('revealing one frame from the inspector', () => {
  it('centres the view on a frame the edge of the view clips', () => {
    const timeline = timelineWith({ eventIndex: 4, timestamp: 299_000, total: 5_000 });

    timeline.revealFromInspector(4);

    expect(timeline.panned()).toEqual([
      { timestamp: 299_000, duration: 5_000, depth: 0, axes: { time: true, depth: false } },
    ]);
  });

  it('leaves the view alone for a frame already on screen', () => {
    const timeline = timelineWith({ eventIndex: 4, timestamp: 250_000, total: 1_000 });

    timeline.revealFromInspector(4);

    expect(timeline.panned()).toEqual([]);
  });
});

describe('picking a merged row in the inspector', () => {
  it('pans to the occurrence nearest the view, selecting none of them', () => {
    const timeline = timelineWith(
      { eventIndex: 4, timestamp: 10_000, total: 1_000 },
      { eventIndex: 5, timestamp: 310_000, total: 1_000 },
    );

    timeline.pickMergedRow([4, 5]);

    expect(timeline.panned()).toEqual([
      { timestamp: 310_000, duration: 1_000, depth: 0, axes: { time: true, depth: false } },
    ]);
    expect(timeline.selected()).toBe(0);
  });

  it('leaves the view alone when one occurrence is already on screen', () => {
    const timeline = timelineWith(
      { eventIndex: 4, timestamp: 10_000, total: 1_000 },
      { eventIndex: 5, timestamp: 260_000, total: 1_000 },
    );

    timeline.pickMergedRow([4, 5]);

    expect(timeline.panned()).toEqual([]);
  });
});
