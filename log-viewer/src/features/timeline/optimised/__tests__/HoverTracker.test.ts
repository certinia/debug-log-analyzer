/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * What the pointer is over, and when that answer has to be worked out again.
 */

import { describe, expect, it } from '@jest/globals';
import type { EventNode, HoveredFrame } from '../../types/flamechart.types.js';
import { HoverTracker } from '../interaction/HoverTracker.js';

/** The hit test builds a fresh EventNode every time; `original` is the stable identity. */
function hit(original: object, depth = 0): HoveredFrame {
  return {
    node: { id: '0-0', timestamp: 0, duration: 10, type: 'M', text: 'm', original } as EventNode,
    depth,
  };
}

describe('HoverTracker hovered frame', () => {
  const frame = {};

  it('reports a change once, so a sweep repaints per frame crossed', () => {
    const tracker = new HoverTracker();

    expect(tracker.setHovered(hit(frame))).toBe(true);
    expect(tracker.setHovered(hit(frame))).toBe(false);
    expect(tracker.getHovered()?.node.original).toBe(frame);
  });

  it('tells apart two frames sharing a timestamp and a depth', () => {
    const tracker = new HoverTracker();
    const sibling = {};

    tracker.setHovered(hit(frame));

    // Same id, different log event: a zero-duration sibling under a coarse clock.
    expect(tracker.setHovered(hit(sibling))).toBe(true);
  });

  it('reports the change to nothing hovered', () => {
    const tracker = new HoverTracker();
    tracker.setHovered(hit(frame));

    expect(tracker.setHovered(null)).toBe(true);
    expect(tracker.setHovered(null)).toBe(false);
    expect(tracker.getHovered()).toBeNull();
  });

  // `original` is optional on EventNode, and two frames sharing `undefined` are not the same
  // frame. Reading them as changed repaints needlessly; reading them as equal sticks the wash.
  it('treats frames with no log event as different frames', () => {
    const tracker = new HoverTracker();

    expect(tracker.setHovered({ node: { id: 'a' } as never, depth: 0 })).toBe(true);
    expect(tracker.setHovered({ node: { id: 'b' } as never, depth: 1 })).toBe(true);
  });
});

describe('HoverTracker stale hits', () => {
  it('asks again after the frames move under a still pointer', () => {
    const tracker = new HoverTracker();
    tracker.setPointer(40, 10);

    tracker.invalidateHit();

    expect(tracker.takeStaleHit()).toEqual({ x: 40, y: 10 });
    // Once only: the answer now stands.
    expect(tracker.takeStaleHit()).toBeNull();
  });

  it('has nothing to ask about before the pointer has been anywhere', () => {
    const tracker = new HoverTracker();

    tracker.invalidateHit();

    expect(tracker.takeStaleHit()).toBeNull();
  });

  // A move reports its own hit, so moving alone leaves nothing to ask about.
  it('does not ask again for a move on its own', () => {
    const tracker = new HoverTracker();

    tracker.setPointer(10, 10);
    tracker.setPointer(20, 10);

    expect(tracker.takeStaleHit()).toBeNull();
  });

  it('drops everything when the pointer leaves the chart', () => {
    const tracker = new HoverTracker();
    tracker.setPointer(40, 10);
    tracker.invalidateHit();
    tracker.setHovered(hit({}));

    tracker.clearPointer();

    expect(tracker.getHovered()).toBeNull();
    expect(tracker.takeStaleHit()).toBeNull();
  });
});
