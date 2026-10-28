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
import { indexOf, rawStoreOf } from '#test-helpers/apexLog.js';
import { buildLogIndex } from '#core/log/LogIndex.js';
import { ApexLogTimeline } from '../optimised/ApexLogTimeline.js';
import {
  BUCKET_CONSTANTS,
  type ViewportBounds,
  type ViewportPanAxes,
} from '../types/flamechart.types.js';
import { buildTimelineFrames } from '../utils/timeline-frames.js';

/** 100,000ns of a log on screen, from 200,000, over six depths. */
const BOUNDS: ViewportBounds = {
  timeStart: 200_000,
  timeEnd: 300_000,
  depthStart: 0,
  depthEnd: 5,
};

/** A top-level frame; `eventIndex` names it in the test, and maps to its id in the parsed log. */
type Frame = { eventIndex: number; timestamp: number; total: number };

/** A frame the chart was panned to, with every argument it was given. */
type Panned = { timestamp: number; duration: number; depth: number; axes: ViewportPanAxes };

async function timelineWith(...events: Frame[]): Promise<{
  revealFromInspector: (eventIndex: number) => void;
  pickMergedRow: (eventIndexes: number[]) => void;
  panned: () => Panned[];
  selected: () => number;
}> {
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
    getViewportBounds: () => BOUNDS,
    panToFrame: (timestamp: number, duration: number, depth: number, axes: ViewportPanAxes) => {
      panned.push({ timestamp, duration, depth, axes });
    },
  };
  const text = (frame: Frame) => `ns.F${frame.eventIndex}.run()`;
  const { log } = await rawStoreOf(
    events
      .map(
        (frame) =>
          `09:18:22.6 (${frame.timestamp})|METHOD_ENTRY|[1]|01p|${text(frame)}\n` +
          `09:18:22.6 (${frame.timestamp + frame.total})|METHOD_EXIT|[1]|${text(frame)}\n`,
      )
      .join(''),
  );
  const index = buildLogIndex(log);
  internals['index'] = index;
  internals['frames'] = buildTimelineFrames(index, new Set(BUCKET_CONSTANTS.CATEGORY_PRIORITY), 0);
  const ids = new Map(events.map((frame) => [frame.eventIndex, indexOf(log, text(frame))]));
  const idOf = (eventIndex: number) => ids.get(eventIndex) ?? -1;

  const reveal = internals['selectFrameByEventIndex'] as (eventIndex: number) => void;
  const pan = internals['panToNearestFrame'] as (eventIndexes: readonly number[]) => void;

  return {
    revealFromInspector: (eventIndex) => reveal.call(timeline, idOf(eventIndex)),
    pickMergedRow: (eventIndexes) => pan.call(timeline, eventIndexes.map(idOf)),
    panned: () => panned,
    selected: () => selected,
  };
}

describe('revealing one frame from the inspector', () => {
  it('centres the view on a frame the edge of the view clips', async () => {
    const timeline = await timelineWith({ eventIndex: 4, timestamp: 299_000, total: 5_000 });

    timeline.revealFromInspector(4);

    expect(timeline.panned()).toEqual([
      { timestamp: 299_000, duration: 5_000, depth: 0, axes: { time: true, depth: false } },
    ]);
  });

  it('leaves the view alone for a frame already on screen', async () => {
    const timeline = await timelineWith({ eventIndex: 4, timestamp: 250_000, total: 1_000 });

    timeline.revealFromInspector(4);

    expect(timeline.panned()).toEqual([]);
  });
});

describe('picking a merged row in the inspector', () => {
  it('pans to the occurrence nearest the view, selecting none of them', async () => {
    const timeline = await timelineWith(
      { eventIndex: 4, timestamp: 10_000, total: 1_000 },
      { eventIndex: 5, timestamp: 310_000, total: 1_000 },
    );

    timeline.pickMergedRow([4, 5]);

    expect(timeline.panned()).toEqual([
      { timestamp: 310_000, duration: 1_000, depth: 0, axes: { time: true, depth: false } },
    ]);
    expect(timeline.selected()).toBe(0);
  });

  it('leaves the view alone when one occurrence is already on screen', async () => {
    const timeline = await timelineWith(
      { eventIndex: 4, timestamp: 10_000, total: 1_000 },
      { eventIndex: 5, timestamp: 260_000, total: 1_000 },
    );

    timeline.pickMergedRow([4, 5]);

    expect(timeline.panned()).toEqual([]);
  });
});
