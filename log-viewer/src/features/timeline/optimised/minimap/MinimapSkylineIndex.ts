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
 *
 * It also keeps every frame's bounds, which is what `countFrames` needs: both are
 * the same width-independent, once-per-log projection of the log.
 */

/**
 * What the sweep reads off a frame. `PrecomputedRect` satisfies it, so the minimap
 * builds straight from the rectangles rather than from objects made for it.
 */
export interface SkylineFrame {
  timeStart: number;
  timeEnd: number;
  depth: number;
  category: string;
}

/** Category id 0 means no frame is on top, so a zeroed buffer is never wrong. */
export const GAP_CATEGORY = 0;

/** Ids are held in a Uint8Array, and id 0 is the gap. */
const MAX_CATEGORIES = 255;

/** Depths are held in a Uint16Array. Real logs reach ~30. */
const MAX_DEPTH = 65535;

/** What the sweep produces: the segments, and how many of them are real. */
interface Swept {
  starts: Float64Array;
  depths: Uint16Array;
  categories: Uint8Array;
  segments: number;
  violations: number;
}

/**
 * Every frame in one array, in the order the sweep needs: by start, then by depth
 * so a parent precedes the child that starts with it. Get that order wrong and the
 * sweep drops the parent as an overlap, losing a frame that may span the whole log.
 *
 * A new array of references, so the caller's own arrays are never reordered. Cheap
 * because each group arrives time-ordered, so this merges a handful of runs rather
 * than sorting from scratch: 12ms for 431k frames, against 43ms for the same frames
 * in the conversion's own order.
 */
function ordered(groups: readonly (readonly SkylineFrame[])[]): SkylineFrame[] {
  let total = 0;
  for (const group of groups) {
    total += group.length;
  }

  // Pre-sized and filled by index. Growing by push costs 1.6ms and 1.5MB of copies
  // at 431k frames, and `push(...group)` overflows the stack on a group that size.
  const frames: SkylineFrame[] = new Array(total);
  let at = 0;
  for (const group of groups) {
    for (const frame of group) {
      frames[at++] = frame;
    }
  }

  frames.sort((a, b) => a.timeStart - b.timeStart || a.depth - b.depth);
  return frames;
}

export class MinimapSkylineIndex {
  /** Segment boundaries, ascending. Length `segmentCount + 1`. */
  public readonly segmentStarts: Float64Array;

  /** Depth of the frame on top of each segment, 0 in a gap. */
  public readonly segmentDepths: Uint16Array;

  /** Category id of the frame on top of each segment, 0 in a gap. */
  public readonly segmentCategories: Uint8Array;

  /** Category name per id, appended to as the sweep meets them. Index 0 is the gap. */
  public readonly categoryNames: string[] = [''];

  /**
   * Frames the sweep contained or dropped: one that outlived its parent, one
   * that overlapped a frame at the same or a shallower depth, or one with no
   * duration. Zero on a well-formed log; asserted by the tests, and printed by
   * `pnpm measure minimap` as a tripwire on real logs.
   */
  public readonly violations: number;

  /**
   * Frame bounds as parallel arrays, for `countFrames`.
   *
   * A copy of numbers the rectangles already hold, so this looks like 6.6MB to
   * reclaim. It is not: `countFrames` runs on every width change, and reading the
   * scattered rectangles instead measures 10-15ms a call against 1ms, which would
   * put a resize step inside the frame budget.
   */
  private readonly frameStarts: Float64Array;
  private readonly frameEnds: Float64Array;

  private readonly categoryIds = new Map<string, number>();

  /**
   * @param groups - Frames in groups, each ascending by `timeStart`.
   * @param totalDuration - The log's end timestamp, which the last segment reaches.
   */
  constructor(groups: readonly (readonly SkylineFrame[])[], totalDuration: number) {
    const frames = ordered(groups);
    const count = frames.length;
    this.frameStarts = new Float64Array(count);
    this.frameEnds = new Float64Array(count);
    let deepest = 0;
    for (let i = 0; i < count; i++) {
      const frame = frames[i]!;
      this.frameStarts[i] = frame.timeStart;
      this.frameEnds[i] = frame.timeEnd;
      if (frame.depth > deepest) {
        deepest = frame.depth;
      }
    }

    // Depth strictly increases up the stack, so it can hold no more entries than
    // there are depths. Taken from the frames rather than passed in, so the sweep
    // cannot overflow on a caller's stale figure.
    const swept = this.sweep(frames, totalDuration, Math.min(deepest, MAX_DEPTH) + 2);
    this.violations = swept.violations;

    this.segmentStarts = swept.starts.subarray(0, swept.segments + 1);
    this.segmentDepths = swept.depths.subarray(0, swept.segments);
    this.segmentCategories = swept.categories.subarray(0, swept.segments);
  }

  /** Number of segments. `segmentStarts` holds one more, to close the last. */
  public get segmentCount(): number {
    return this.segmentDepths.length;
  }

  /**
   * Count the frames overlapping each bucket, by difference array.
   *
   * A frame adds one to the bucket it starts in and takes one back after the
   * bucket it ends in, so a running total gives every bucket its count in one
   * pass.
   *
   * A frame ending exactly on a boundary counts in the bucket after it, as the
   * per-bucket collect this replaced did. The segment walk does not, so such a
   * bucket reports a count at depth 0 and draws no bar.
   */
  public countFrames(bucketCount: number, bucketTimeWidth: number): Uint32Array {
    const { frameStarts, frameEnds } = this;
    const deltas = new Int32Array(bucketCount + 1);
    const lastBucket = bucketCount - 1;

    for (let i = 0; i < frameStarts.length; i++) {
      let first = Math.floor(frameStarts[i]! / bucketTimeWidth);
      if (first < 0) {
        first = 0;
      }
      let last = Math.floor(frameEnds[i]! / bucketTimeWidth);
      if (last > lastBucket) {
        last = lastBucket;
      }
      if (last < first) {
        continue;
      }
      deltas[first]!++;
      deltas[last + 1]!--;
    }

    const counts = new Uint32Array(bucketCount);
    let running = 0;
    for (let b = 0; b < bucketCount; b++) {
      running += deltas[b]!;
      counts[b] = running;
    }
    return counts;
  }

  /**
   * Sweep the frames, emitting one segment per stretch with the same frame on top.
   *
   * Frames nest, so the deepest active frame is always the one pushed last: the
   * sweep drains every frame that has ended before pushing the next, which is
   * what makes a frame's own end instant belong to whatever follows it.
   *
   * @param capacity - Stack depth the frames can reach.
   */
  private sweep(frames: readonly SkylineFrame[], totalDuration: number, capacity: number): Swept {
    // At most two segments a frame - the stretch before it, and its own end - plus
    // the trailing gap and the closer. Swept once into that bound and trimmed to a
    // view, rather than swept twice to size exactly: measured slack over four real
    // logs is 14 to 2,709 bytes, because a frame emits exactly two segments unless
    // a same-category sibling at its own depth abuts it to the nanosecond. Copying
    // into exact arrays would peak 9MB higher to reclaim that.
    const bound = 2 * frames.length + 2;
    const starts = new Float64Array(bound);
    const depths = new Uint16Array(bound);
    const categories = new Uint8Array(bound);

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
      starts[segments] = emittedTo;
      depths[segments] = depth;
      categories[segments] = category;
      segments++;
      emittedTo = to;
      lastDepth = depth;
      lastCategory = category;
    };

    /** Retire what has ended by `until`. `<=` because a frame is not on top at its own end. */
    const drainTo = (until: number): void => {
      while (stackTop > 0 && stackEnd[stackTop - 1]! <= until) {
        const at = stackTop - 1;
        emit(stackEnd[at]!, stackDepth[at]!, stackCategory[at]!);
        stackTop--;
      }
    };

    for (const frame of frames) {
      const start = frame.timeStart;
      // Clamped here, not on the store: the stack's strict-increase invariant and
      // its capacity are both in clamped units, so comparing raw depths could push
      // two equal-after-clamp frames and run past the end.
      const depth = frame.depth > MAX_DEPTH ? MAX_DEPTH : frame.depth;
      drainTo(start);

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
      if (stackTop > 0 && depth <= stackDepth[stackTop - 1]!) {
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
      stackDepth[stackTop] = depth;
      stackCategory[stackTop] = this.idFor(frame.category);
      stackTop++;
    }

    drainTo(Infinity);

    // The stretch after the last frame is a gap of its own. Closing the last real
    // segment on it instead would credit that time to the frame's category.
    emit(totalDuration, 0, GAP_CATEGORY);

    starts[segments] = emittedTo;
    return { starts, depths, categories, segments, violations };
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
