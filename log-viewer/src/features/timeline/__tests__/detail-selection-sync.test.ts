/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';

import { TimelineViewport } from '../optimised/TimelineViewport.js';
import { revealTarget, toDetailSelection } from '../utils/detail-selection-sync.js';

describe('toDetailSelection', () => {
  it('builds an event selection from an eventIndex', () => {
    expect(toDetailSelection(7)).toEqual({ kind: 'event', eventIndex: 7 });
  });

  it('keeps index 0, which is a real event and not "missing"', () => {
    expect(toDetailSelection(0)).toEqual({ kind: 'event', eventIndex: 0 });
  });

  it('returns null when there is no eventIndex to select', () => {
    expect(toDetailSelection(undefined)).toBeNull();
  });
});

describe('revealTarget', () => {
  // 1000px over a 1,000,000ns log, zoomed to 100,000ns starting at 200,000.
  const viewport = new TimelineViewport(1000, 600, 1_000_000, 10);
  viewport.setZoom(0.01);
  viewport.setPan(2000, 0);
  const bounds = viewport.getBounds();

  const frame = (timestamp: number, duration = 1_000, depth = bounds.depthStart) => ({
    timestamp,
    duration,
    depth,
  });

  const axesFor = (...frames: ReturnType<typeof frame>[]) => revealTarget(bounds, frames)?.axes;

  it('leaves a frame that is wholly in view where it is', () => {
    expect(revealTarget(bounds, [frame(250_000)])).toBeNull();
  });

  it('centres a frame clipped by the edge of the view', () => {
    expect(axesFor(frame(299_000, 5_000))).toEqual({ time: true, depth: false });
  });

  it('centres a frame that is off screen', () => {
    expect(axesFor(frame(400_000))).toEqual({ time: true, depth: false });
  });

  // It fills the screen either way, so a move would only lose the reader's bearings.
  it('leaves a frame spanning the view from edge to edge where it is', () => {
    expect(revealTarget(bounds, [frame(100_000, 500_000)])).toBeNull();
  });

  // Wider than the view, but all of it bar a sliver is off to the left.
  it('centres a wide frame showing only a sliver at the edge', () => {
    expect(axesFor(frame(100_000, 100_001))).toEqual({ time: true, depth: false });
  });

  it('centres a frame wider than the view that it does not reach', () => {
    expect(axesFor(frame(400_000, 500_000))).toEqual({ time: true, depth: false });
  });

  it('centres the depth on its own when only the depth is off screen', () => {
    expect(axesFor(frame(250_000, 1_000, bounds.depthEnd + 1))).toEqual({
      time: false,
      depth: true,
    });
  });

  it('leaves the view alone when one of several occurrences is in it', () => {
    expect(revealTarget(bounds, [frame(10_000), frame(260_000), frame(900_000)])).toBeNull();
  });

  it('brings in the occurrence nearest the middle of the view', () => {
    const target = revealTarget(bounds, [frame(900_000), frame(310_000), frame(10_000)]);

    expect(target?.frame.timestamp).toBe(310_000);
  });

  it('measures nearest from the middle of the frame, not its start', () => {
    const target = revealTarget(bounds, [frame(150_000, 20_000), frame(340_000)]);

    // Its middle lands at 160,000, which is nearer 250,000 than 340,500 is.
    expect(target?.frame.timestamp).toBe(150_000);
  });

  it('has nothing to bring in for a row that merges no frames', () => {
    expect(revealTarget(bounds, [])).toBeNull();
  });
});
