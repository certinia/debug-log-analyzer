/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * MinimapSkylineIndex
 *
 * The log seen from above: over each stretch of time, which frame is on top and
 * how deep it is. The deepest frame at an instant is the one you would see
 * looking down on the flame chart, so that frame's category is what should
 * colour the minimap there.
 *
 * Built once per log, and never invalidated. Which frame is on top at a given
 * time does not depend on how wide the minimap is, so a resize walks this index
 * instead of rebuilding it.
 *
 * The segments tile the timeline: segment `i` spans
 * `[segmentStarts[i], segmentStarts[i + 1])`, and a stretch with no frame
 * running is a segment of its own with category id 0. So a walk needs no bounds
 * test beyond the segment count, and no segment-end array.
 */

import type { SkylineFrame } from '../TemporalSegmentTree.js';

/** Category id 0 means no frame is on top, so a zeroed buffer is never wrong. */
const GAP_CATEGORY = 0;

/** Ids are held in a Uint8Array, and id 0 is the gap. */
const MAX_CATEGORIES = 255;

/** Depths are held in a Uint16Array. Real logs reach ~30. */
const MAX_DEPTH = 65535;

/** Where the sweep writes. Null on the counting pass. */
interface SkylineBuffers {
  starts: Float64Array;
  depths: Uint16Array;
  categories: Uint8Array;
}

export class MinimapSkylineIndex {
  /** Number of segments. `segmentStarts` holds one more, to close the last. */
  public readonly segmentCount: number;

  /** Segment boundaries, ascending. Length `segmentCount + 1`. */
  public readonly segmentStarts: Float64Array;

  /** Depth of the frame on top of each segment, 0 in a gap. */
  public readonly segmentDepths: Uint16Array;

  /** Category id of the frame on top of each segment, 0 in a gap. */
  public readonly segmentCategories: Uint8Array;

  /** Category name per id, appended to as the sweep meets them. Index 0 is the gap. */
  public readonly categoryNames: string[] = [''];

  /** Frame bounds as parallel arrays, for counting frames per bucket. */
  public readonly frameStarts: Float64Array;
  public readonly frameEnds: Float64Array;

  /**
   * Frames the sweep had to contain: one that outlived its parent, one that
   * overlapped a frame at the same or a shallower depth, or one with no
   * duration. Zero on a well-formed log; asserted by the tests.
   */
  public readonly violations: number;

  private readonly categoryIds = new Map<string, number>();

  /**
   * @param frames - Every frame, ascending by `timeStart`. Reordered in place at equal starts.
   * @param totalDuration - The log's end timestamp, which the last segment reaches.
   * @param maxDepth - Deepest frame in the log, which bounds the sweep's stack.
   */
  constructor(frames: SkylineFrame[], totalDuration: number, maxDepth: number) {
    orderEqualStartsByDepth(frames);

    const count = frames.length;
    this.frameStarts = new Float64Array(count);
    this.frameEnds = new Float64Array(count);
    for (let i = 0; i < count; i++) {
      const frame = frames[i]!;
      this.frameStarts[i] = frame.timeStart;
      this.frameEnds[i] = frame.timeEnd;
    }

    // Swept twice, counting then writing, so the arrays are allocated at exactly
    // the size needed. Growing by doubling would peak about half again as large,
    // and this module trades speed for memory.
    const counted = this.sweep(frames, totalDuration, maxDepth, null);
    this.segmentCount = counted.segments;
    this.violations = counted.violations;

    this.segmentStarts = new Float64Array(counted.segments + 1);
    this.segmentDepths = new Uint16Array(counted.segments);
    this.segmentCategories = new Uint8Array(counted.segments);
    this.sweep(frames, totalDuration, maxDepth, {
      starts: this.segmentStarts,
      depths: this.segmentDepths,
      categories: this.segmentCategories,
    });
  }

  /** The category a segment's id names, or the empty string for a gap. */
  public categoryOf(segment: number): string {
    return this.categoryNames[this.segmentCategories[segment]!]!;
  }

  /**
   * Sweep the frames, emitting one segment per stretch with the same frame on top.
   *
   * Frames nest, so the deepest active frame is always the one pushed last: the
   * sweep drains every frame that has ended before pushing the next, which is
   * what makes a frame's own end instant belong to whatever follows it.
   *
   * @param buffers - Where to write, or null to only count.
   */
  private sweep(
    frames: readonly SkylineFrame[],
    totalDuration: number,
    maxDepth: number,
    buffers: SkylineBuffers | null,
  ): { segments: number; violations: number } {
    // Depth strictly increases up the stack, so it can hold no more entries than
    // there are depths.
    const capacity = Math.max(1, maxDepth + 2);
    const stackEnd = new Float64Array(capacity);
    const stackDepth = new Uint16Array(capacity);
    const stackCategory = new Uint8Array(capacity);

    let stackTop = 0;
    let segments = 0;
    let violations = 0;
    let emittedTo = 0;
    let lastDepth = -1;
    let lastCategory = -1;

    const emit = (to: number, depth: number, category: number): void => {
      if (to <= emittedTo) {
        return;
      }
      // A run with the same frame on top is one segment, however many frames
      // started and ended alongside it.
      if (depth === lastDepth && category === lastCategory) {
        emittedTo = to;
        return;
      }
      if (buffers) {
        buffers.starts[segments] = emittedTo;
        buffers.depths[segments] = depth;
        buffers.categories[segments] = category;
      }
      segments++;
      emittedTo = to;
      lastDepth = depth;
      lastCategory = category;
    };

    for (const frame of frames) {
      const start = frame.timeStart;

      // Retire what has ended. `<=` because a frame is not on top at its own end.
      while (stackTop > 0 && stackEnd[stackTop - 1]! <= start) {
        const at = stackTop - 1;
        emit(stackEnd[at]!, stackDepth[at]!, stackCategory[at]!);
        stackTop--;
      }

      // The stretch before this frame belongs to whatever encloses it, or to a gap.
      if (start > emittedTo) {
        const enclosing = stackTop - 1;
        emit(
          start,
          stackTop > 0 ? stackDepth[enclosing]! : 0,
          stackTop > 0 ? stackCategory[enclosing]! : GAP_CATEGORY,
        );
      }

      if (frame.timeEnd <= start) {
        violations++;
        continue;
      }

      // A frame no deeper than the one it overlaps cannot be on top of it. Today's
      // sweep gives that frame the same outcome, by keeping the deepest.
      if (stackTop > 0 && frame.depth <= stackDepth[stackTop - 1]!) {
        violations++;
        continue;
      }
      if (stackTop === capacity) {
        violations++;
        continue;
      }

      // Contain the frame in whatever it sits inside, so `stackEnd` stays
      // non-increasing upwards and the stack keeps its order.
      let end = frame.timeEnd;
      if (stackTop > 0 && end > stackEnd[stackTop - 1]!) {
        end = stackEnd[stackTop - 1]!;
        violations++;
      }

      stackEnd[stackTop] = end;
      stackDepth[stackTop] = frame.depth > MAX_DEPTH ? MAX_DEPTH : frame.depth;
      stackCategory[stackTop] = this.idFor(frame.category);
      stackTop++;
    }

    while (stackTop > 0) {
      const at = stackTop - 1;
      emit(stackEnd[at]!, stackDepth[at]!, stackCategory[at]!);
      stackTop--;
    }

    // The stretch after the last frame is a gap of its own. Closing the last real
    // segment on it instead would credit that time to the frame's category.
    emit(totalDuration, 0, GAP_CATEGORY);

    if (buffers) {
      buffers.starts[segments] = emittedTo;
    }
    return { segments, violations };
  }

  /**
   * Intern a category name. Categories come from log events, so the set is open;
   * a log with more than 255 of them shares the last id, which only costs colour.
   */
  private idFor(category: string): number {
    const known = this.categoryIds.get(category);
    if (known !== undefined) {
      return known;
    }
    if (this.categoryNames.length > MAX_CATEGORIES) {
      return MAX_CATEGORIES;
    }
    const id = this.categoryNames.length;
    this.categoryNames.push(category);
    this.categoryIds.set(category, id);
    return id;
  }
}

/**
 * Order frames that start together by depth, shallowest first.
 *
 * `takeFramesSorted` sorts by `timeStart` alone, so the order at an equal start
 * is whatever the tree happened to build. The sweep needs the parent pushed
 * before its child, or the child is on the stack first and the parent is dropped
 * as an overlap - losing a frame that may span the whole log.
 *
 * Ties are rare, so this is a scan that almost never sorts anything.
 */
function orderEqualStartsByDepth(frames: SkylineFrame[]): void {
  const count = frames.length;
  let runStart = 0;
  for (let i = 1; i <= count; i++) {
    if (i < count && frames[i]!.timeStart === frames[runStart]!.timeStart) {
      continue;
    }
    if (i - runStart > 1) {
      const run = frames.slice(runStart, i).sort((a, b) => a.depth - b.depth);
      for (let at = 0; at < run.length; at++) {
        frames[runStart + at] = run[at]!;
      }
    }
    runStart = i;
  }
}
