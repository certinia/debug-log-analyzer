/**
 * @jest-environment jsdom
 */

/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * What a reveal from the inspector does to the view. `revealPanAxes` holds the
 * policy and is tested with it; this covers the wiring - the axes it works out
 * reach the chart, and a frame needing no move asks for none.
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

function timelineWith(event: { eventIndex: number; timestamp: number; total: number }): {
  revealFromInspector: (eventIndex: number) => void;
  centred: () => (ViewportPanAxes | undefined)[];
} {
  const timeline = new ApexLogTimeline();
  const internals = timeline as unknown as Record<string, unknown>;
  const centred: (ViewportPanAxes | undefined)[] = [];

  internals['flamechart'] = {
    locateByEventNodes: jest.fn(),
    selectByEventNode: () => true,
    getViewportManager: () => ({ getBounds: () => BOUNDS }),
    centerOnSelectedFrame: (axes?: ViewportPanAxes) => {
      centred.push(axes);
    },
  };
  internals['apexLog'] = {
    eventsById: {
      [event.eventIndex]: {
        eventIndex: event.eventIndex,
        timestamp: event.timestamp,
        duration: { total: event.total },
        parent: null,
      },
    },
  };

  const reveal = internals['selectFrameByEventIndex'] as (eventIndex: number) => void;

  return {
    revealFromInspector: (eventIndex) => reveal.call(timeline, eventIndex),
    centred: () => centred,
  };
}

describe('revealing a frame from the inspector', () => {
  it('centres the view on a frame the edge of the view clips', () => {
    const timeline = timelineWith({ eventIndex: 4, timestamp: 299_000, total: 5_000 });

    timeline.revealFromInspector(4);

    expect(timeline.centred()).toEqual([{ time: true, depth: false }]);
  });

  it('leaves the view alone for a frame already on screen', () => {
    const timeline = timelineWith({ eventIndex: 4, timestamp: 250_000, total: 1_000 });

    timeline.revealFromInspector(4);

    expect(timeline.centred()).toEqual([]);
  });
});
