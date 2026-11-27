/**
 * @jest-environment jsdom
 */

/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * Where going to an event by id lands the chart: which frame is selected, and where the view
 * moves. The climb from a detail to its frame is tested here; `drawnRowAtOrAbove`'s own
 * tests cover the rest of the climb.
 */

import { describe, expect, it } from '@jest/globals';
import { idOf, rawStoreOf } from '#test-helpers/apexLog.js';
import { buildLogIndex } from '#core/log/LogIndex.js';
import { ApexLogTimeline } from '../optimised/ApexLogTimeline.js';
import { BUCKET_CONSTANTS, type EventNode } from '../types/flamechart.types.js';
import { buildTimelineFrames } from '../utils/timeline-frames.js';

/** A method holding a debug line, then a debug line with no frame around it. */
const LOG =
  '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.Outer.run()\n' +
  '09:18:22.6 (1500)|USER_DEBUG|[2]|DEBUG|inside\n' +
  '09:18:22.6 (2000)|METHOD_EXIT|[1]|ns.Outer.run()\n' +
  '09:18:22.6 (3000)|USER_DEBUG|[3]|DEBUG|alone\n';

async function navigated(text: string) {
  const timeline = new ApexLogTimeline();
  const internals = timeline as unknown as Record<string, unknown>;
  const selected: string[] = [];
  const focused: number[][] = [];
  internals['flamechart'] = {
    selectByEventNode: (node: EventNode) => selected.push(node.text),
    focusOn: (timestamp: number, duration: number, depth: number) =>
      focused.push([timestamp, duration, depth]),
  };
  const { log } = await rawStoreOf(LOG);
  const index = buildLogIndex(log);
  internals['index'] = index;
  internals['frames'] = buildTimelineFrames(index, new Set(BUCKET_CONSTANTS.CATEGORY_PRIORITY), 0);

  timeline.navigateToEventId(idOf(log, text));
  return { selected, focused };
}

describe('navigateToEventId', () => {
  // The chart draws no rect for a detail, so going to it selected nothing.
  it('selects the frame a detail sits in, and moves to that frame', async () => {
    const { selected, focused } = await navigated('DEBUG | inside');

    expect(selected).toEqual(['ns.Outer.run()']);
    expect(focused).toEqual([[1000, 1000, 0]]);
  });

  // With no drawn frame above it, the move was dropped along with the selection.
  it('still moves to an event with no drawn frame above it, selecting nothing', async () => {
    const { selected, focused } = await navigated('DEBUG | alone');

    expect(selected).toEqual([]);
    expect(focused).toEqual([[3000, 0, 0]]);
  });
});
