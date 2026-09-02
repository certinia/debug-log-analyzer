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
import { ApexLogTimeline } from '../optimised/ApexLogTimeline.js';

/** What the emphasis was asked to do, in order: an eventIndex to mark, or 'clear'. */
type EmphasisCall = number | 'clear';

function timelineWithSpy(): {
  select: (eventIndex: number | undefined) => void;
  selectMarker: (eventIndex: number | undefined) => void;
  revealFromInspector: (eventIndex: number) => void;
  emphasised: () => EmphasisCall[];
} {
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
    getViewportManager: () => null,
  };
  internals['pickEmphasis'] = (eventIndex: number) => calls.push(eventIndex);
  internals['clearEmphasis'] = () => calls.push('clear');
  // One root event, so the inspector's reveal can resolve it.
  const event = { eventIndex: 4, timestamp: 0, duration: { total: 10 }, parent: null };
  internals['apexLog'] = { eventsById: { 4: event } };

  const handleSelect = internals['handleSelect'] as (node: unknown) => void;
  const handleMarkerSelect = internals['handleMarkerSelect'] as (marker: unknown) => void;
  const reveal = internals['selectFrameByEventIndex'] as (eventIndex: number) => void;

  return {
    select: (eventIndex) => {
      calls = [];
      handleSelect.call(timeline, eventIndex === undefined ? null : { original: { eventIndex } });
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
  it('dims nothing when a frame is clicked on the chart', () => {
    const timeline = timelineWithSpy();

    timeline.select(7);

    expect(timeline.emphasised()).toEqual(['clear']);
  });

  it('dims nothing when a marker is clicked on the chart', () => {
    const timeline = timelineWithSpy();

    timeline.selectMarker(7);

    expect(timeline.emphasised()).toEqual(['clear']);
  });

  // The inspector marks the frame it asked for, and that mark is what dims the rest. The
  // select it drives clears first, so the mark has to land after it.
  it('marks the frame the inspector reveals, after the select it drives', () => {
    const timeline = timelineWithSpy();

    timeline.revealFromInspector(4);

    expect(timeline.emphasised()).toEqual(['clear', 4]);
  });

  // The chart is the source of truth once clicked, so it drops the mark left behind.
  it('drops the inspector mark when the chart is then clicked', () => {
    const timeline = timelineWithSpy();

    timeline.revealFromInspector(4);
    timeline.select(9);

    expect(timeline.emphasised()).toEqual(['clear']);
  });
});
