/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

import { describe, expect, it } from '@jest/globals';

import { columnsOf, span as frame, type SpanSpec } from '#test-helpers/timeline.js';
import { MinimapSkylineIndex } from '../minimap/MinimapSkylineIndex.js';

/** The index as a readable list of `[start, end, depth, category]`. */
function segments(index: MinimapSkylineIndex): [number, number, number, string][] {
  const out: [number, number, number, string][] = [];
  for (let i = 0; i < index.segmentCount; i++) {
    out.push([
      index.segmentStarts[i]!,
      index.segmentStarts[i + 1]!,
      index.segmentDepths[i]!,
      index.categoryNames[index.segmentCategories[i]!]!,
    ]);
  }
  return out;
}

function build(frames: SpanSpec[], totalDuration = 1000): MinimapSkylineIndex {
  // In whatever order the test wrote it: columnsOf sorts each depth by start, as the frames do.
  return new MinimapSkylineIndex(columnsOf(frames), totalDuration);
}

describe('MinimapSkylineIndex', () => {
  it('splits the timeline where the frame on top changes', () => {
    // depth 0: |------------ Method (0-1000) ------------|
    // depth 1:              |-- DML (300-400) --|
    const index = build([frame('Method', 0, 1000, 0), frame('DML', 300, 400, 1)]);

    expect(segments(index)).toEqual([
      [0, 300, 0, 'Method'],
      [300, 400, 1, 'DML'],
      [400, 1000, 0, 'Method'],
    ]);
    expect(index.violations).toBe(0);
  });

  it('leaves a gap where no frame runs', () => {
    const index = build([frame('Method', 0, 200, 0), frame('SOQL', 600, 700, 0)]);

    expect(segments(index)).toEqual([
      [0, 200, 0, 'Method'],
      [200, 600, 0, ''],
      [600, 700, 0, 'SOQL'],
      [700, 1000, 0, ''],
    ]);
  });

  it('leaves the stretch after the last frame as a gap', () => {
    const index = build([frame('Method', 0, 200, 0)], 1000);

    // Closing the Method segment at 1000 instead would colour the rest of the
    // minimap with a frame that had already ended.
    expect(segments(index)).toEqual([
      [0, 200, 0, 'Method'],
      [200, 1000, 0, ''],
    ]);
  });

  it('orders segments by time with no overlap', () => {
    const frames: SpanSpec[] = [];
    for (let root = 0; root < 40; root++) {
      const start = root * 25;
      frames.push(frame('Apex', start, start + 20, 0));
      frames.push(frame('SOQL', start + 5, start + 8, 1));
      frames.push(frame('DML', start + 10, start + 19, 1));
      frames.push(frame('System', start + 11, start + 14, 2));
    }
    const index = build(frames, 1000);

    expect(index.segmentCount).toBeGreaterThan(40);
    expect(index.violations).toBe(0);
    for (let i = 0; i < index.segmentCount; i++) {
      expect(index.segmentStarts[i]!).toBeLessThan(index.segmentStarts[i + 1]!);
    }
  });

  it('keeps a parent that starts at the same time as its child', () => {
    // The parent must still be on top after the child ends, or a frame spanning
    // the whole log is lost.
    const index = build([frame('Method', 0, 1000, 0), frame('SOQL', 0, 100, 1)], 1000);

    expect(segments(index)).toEqual([
      [0, 100, 1, 'SOQL'],
      [100, 1000, 0, 'Method'],
    ]);
    expect(index.violations).toBe(0);
  });

  // Four depths take two merge rounds, so the tie rule must hold for merged runs too.
  it('keeps every ancestor that starts with its descendants', () => {
    const index = build([
      frame('Method', 0, 1000, 0),
      frame('Apex', 0, 400, 1),
      frame('SOQL', 0, 200, 2),
      frame('DML', 0, 100, 3),
    ]);

    expect(segments(index)).toEqual([
      [0, 100, 3, 'DML'],
      [100, 200, 2, 'SOQL'],
      [200, 400, 1, 'Apex'],
      [400, 1000, 0, 'Method'],
    ]);
    expect(index.violations).toBe(0);
  });

  it('contains a frame that outlives its parent', () => {
    // depth 0: |-- Method (0-100) --|
    // depth 1: |------ SOQL (0-200) ------|
    const index = build([frame('Method', 0, 100, 0), frame('SOQL', 0, 200, 1)], 200);

    // The child is cut to its parent's end rather than reaching past it.
    expect(segments(index)).toEqual([
      [0, 100, 1, 'SOQL'],
      [100, 200, 0, ''],
    ]);
    expect(index.violations).toBe(1);
  });

  it('keeps the first of two frames that overlap at the same depth', () => {
    const index = build([frame('Method', 0, 100, 0), frame('SOQL', 50, 150, 0)], 150);

    expect(segments(index)).toEqual([
      [0, 100, 0, 'Method'],
      [100, 150, 0, ''],
    ]);
    expect(index.violations).toBe(1);
  });

  it('ignores a frame with no duration', () => {
    const index = build([frame('Method', 0, 1000, 0), frame('DML', 500, 500, 1)], 1000);

    expect(segments(index)).toEqual([[0, 1000, 0, 'Method']]);
    expect(index.violations).toBe(1);
  });

  it('counts a frame in every bucket it spans', () => {
    const index = build([frame('Method', 0, 1000, 0), frame('DML', 300, 400, 1)]);

    // Ten buckets of 100. The child adds a second count over 300-400, and a
    // frame ending on a boundary counts in the bucket after it.
    expect(Array.from(index.countFrames(10, 100))).toEqual([1, 1, 1, 2, 2, 1, 1, 1, 1, 1]);
  });

  it('handles a log with no frames', () => {
    const index = build([], 1000);

    expect(segments(index)).toEqual([[0, 1000, 0, '']]);
    expect(index.violations).toBe(0);
  });
});
