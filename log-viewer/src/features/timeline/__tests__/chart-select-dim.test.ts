/**
 * @jest-environment jsdom
 */

/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * Who dims the chart. A click on the chart selects and dims nothing; the inspector's own
 * select keeps its dim. Chrome DevTools dims for a search or a filter, never for a select.
 */

import { describe, expect, it, jest } from '@jest/globals';
import { indexOf } from '#test-helpers/apexLog.js';
import { framesOf } from '#test-helpers/timeline.js';
import { ApexLogTimeline } from '../optimised/ApexLogTimeline.js';

/** One drawn frame, so the inspector's reveal can resolve it. */
const ONE_FRAME =
  '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.A.run()\n' +
  '09:18:22.6 (2000)|METHOD_EXIT|[1]|ns.A.run()\n';

/** What the emphasis was asked to do, in order: an eventIndex to mark, or 'clear'. */
type EmphasisCall = number | 'clear';

async function timelineWithSpy(): Promise<{
  frame: number;
  select: (eventIndex: number | undefined) => void;
  selectMarker: (eventIndex: number | undefined) => void;
  revealFromInspector: (eventIndex: number) => void;
  emphasised: () => EmphasisCall[];
}> {
  const timeline = new ApexLogTimeline();
  const internals = timeline as unknown as Record<string, unknown>;
  let calls: EmphasisCall[] = [];

  internals['flamechart'] = {
    locateByEventNodes: jest.fn(),
    // The inspector's select re-enters handleSelect, as the real chart does.
    selectByEventNode: () => {
      handleSelect.call(timeline, null);
      return true;
    },
    getViewportBounds: () => null,
  };
  internals['pickEmphasis'] = (eventIndex: number) => calls.push(eventIndex);
  internals['clearEmphasis'] = () => calls.push('clear');
  const { log, index, frames } = await framesOf(ONE_FRAME);
  internals['index'] = index;
  internals['frames'] = frames;

  const handleSelect = internals['handleSelect'] as (node: unknown) => void;
  const handleMarkerSelect = internals['handleMarkerSelect'] as (marker: unknown) => void;
  const reveal = internals['selectFrameByEventIndex'] as (eventIndex: number) => void;

  return {
    frame: indexOf(log, 'ns.A.run()'),
    select: (eventIndex) => {
      calls = [];
      handleSelect.call(
        timeline,
        eventIndex === undefined ? null : { original: { id: eventIndex } },
      );
    },
    selectMarker: (eventIndex) => {
      calls = [];
      handleMarkerSelect.call(timeline, eventIndex === undefined ? null : { eventIndex });
    },
    revealFromInspector: (eventIndex) => {
      calls = [];
      reveal.call(timeline, eventIndex);
    },
    emphasised: () => calls,
  };
}

describe('who dims the chart', () => {
  it('dims nothing when a frame is clicked on the chart', async () => {
    const timeline = await timelineWithSpy();

    timeline.select(7);

    expect(timeline.emphasised()).toEqual(['clear']);
  });

  it('dims nothing when a marker is clicked on the chart', async () => {
    const timeline = await timelineWithSpy();

    timeline.selectMarker(7);

    expect(timeline.emphasised()).toEqual(['clear']);
  });

  // The inspector marks the frame it asked for, and that mark is what dims the rest. The
  // select it drives clears first, so the mark has to land after it.
  it('marks the frame the inspector reveals, after the select it drives', async () => {
    const timeline = await timelineWithSpy();

    timeline.revealFromInspector(timeline.frame);

    expect(timeline.emphasised()).toEqual(['clear', timeline.frame]);
  });

  // The chart is the source of truth once clicked, so it drops the mark left behind.
  it('drops the inspector mark when the chart is then clicked', async () => {
    const timeline = await timelineWithSpy();

    timeline.revealFromInspector(4);
    timeline.select(9);

    expect(timeline.emphasised()).toEqual(['clear']);
  });
});
