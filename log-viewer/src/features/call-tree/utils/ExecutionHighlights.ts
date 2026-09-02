/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ApexLog, LogCategory, LogEvent } from 'apex-log-parser';

import { getEventKey } from '../../../core/log/eventKeys.js';

/** One frame on the hot path, entry point first. */
export interface HotPathFrame {
  text: string;
  /** The instance with the most total time, so a click lands on the worst one. */
  eventIndex: number;
  /** Every merged instance, so a hover marks all of them, not just the worst. */
  eventIndexes: number[];
  /** Total time summed across every merged sibling; its share of the log is `totalTime / totalTime(log)`. */
  totalTime: number;
  /** Self time summed across the same instances — the part of `totalTime` this
   *  frame spent itself, so `0 <= selfTime <= totalTime` always holds. */
  selfTime: number;
  /** How many sibling instances the frame merges. */
  count: number;
  /** The largest instance's category, so the row takes the flame chart's own colour. */
  category: LogCategory;
}

/** What the last hot path frame is: it does the work itself, or it only splits the time up. */
export type HotPathEnd = 'hot-spot' | 'fan-out';

/** One signature in the top-self-time list. */
export interface HotSpotRow {
  text: string;
  /** The instance with the most self time, so a click lands on the worst one. */
  eventIndex: number;
  /** Self time summed across every instance of the signature. */
  selfTime: number;
  /** Total time summed across the outermost instances, so recursion counts its
   *  wall time once; never below `selfTime`, which untimed outer calls would
   *  otherwise leave it. */
  totalTime: number;
  /** How many instances the signature has, timed or not, so `selfTime / count` is the honest average. */
  count: number;
  /** The worst instance's category, so the row takes the flame chart's own colour. */
  category: LogCategory;
}

/** Where the log runs hottest, plus the caveat that would poison those figures. */
export interface ExecutionHighlights {
  /** The log's own total time, the denominator for every share shown. */
  totalTime: number;
  hotPath: HotPathFrame[];
  /** What the last frame of the path is, which decides how the row reads. */
  hotPathEnd: HotPathEnd;
  /** The last frame's own children, biggest first; empty unless the path fans
   *  out. A branch is a frame the path did not follow, so it reads the same. */
  hotPathBranches: HotPathFrame[];
  hotSpots: HotSpotRow[];
  /** Calls the log's size cap cut off; their subtrees under-report every timing. */
  truncation: { regionCount: number; firstEventIndex: number } | null;
}

/**
 * Follow the biggest child while it still holds this share of its parent's
 * time; below it the time has spread out, and the last frame is the hot spot.
 */
const HOT_PATH_FOLLOW_SHARE = 0.4;

/**
 * A last frame keeping this much of its own time does the work itself, so it is
 * the hot spot; below it the frame only splits the time up, and its children are
 * the reading. The stop reason does not decide this, the measured share does.
 */
const SELF_DOMINANT_SHARE = 0.5;

/** A child under this share of the fanned-out frame is noise, not a branch. */
const BRANCH_SHARE_FLOOR = 0.05;

/** How many signatures the hot-spot list names. */
const HOT_SPOT_COUNT = 5;

/**
 * One pass over the parsed log for where the time went: the hot path (the
 * chain of calls holding most of the log's time, Visual Studio's Hot Path /
 * Chrome's heaviest stack), the hot spots (the signatures with the most self
 * time), and the truncation caveat that undermines both. Structure follows the
 * real tree, so every row resolves to a `LogEvent` the tabs can reveal.
 */
export function computeExecutionHighlights(apexLog: ApexLog): ExecutionHighlights {
  return {
    totalTime: apexLog.duration.total,
    ...computeHotPath(apexLog.children),
    ...scanEvents(apexLog),
  };
}

/** Same-signature siblings walked as one frame, the way every profiler's hot path merges. */
interface FrameGroup {
  instances: LogEvent[];
  /** Total time summed across the group's instances. */
  total: number;
  /** Self time summed across the group's instances. */
  self: number;
}

/**
 * Walk from the roots over an aggregated view of the tree: same-signature
 * siblings merge into one frame (a loop's 200 calls read as one line), the walk
 * follows the largest merged group, and it stops where the time spreads out —
 * either no child group holds the follow share, or the current frame's own self
 * time beats the largest child group. Where the last frame keeps little of its
 * own time it is no hot spot, so its children come back as the branches the time
 * fanned out to.
 */
function computeHotPath(
  roots: LogEvent[],
): Pick<ExecutionHighlights, 'hotPath' | 'hotPathEnd' | 'hotPathBranches'> {
  const hotPath: HotPathFrame[] = [];
  let current = sortedGroups(roots)[0];
  let children: FrameGroup[] = [];
  while (current && current.total > 0) {
    hotPath.push(frameOf(current));
    children = sortedGroups(childrenOf(current.instances));
    const next = children[0];
    if (!next || next.total < HOT_PATH_FOLLOW_SHARE * current.total || current.self > next.total) {
      break;
    }
    current = next;
  }
  const last = hotPath[hotPath.length - 1];
  const branches =
    last && last.selfTime < SELF_DOMINANT_SHARE * last.totalTime
      ? children.filter((group) => group.total >= BRANCH_SHARE_FLOOR * last.totalTime).map(frameOf)
      : [];
  // A fan-out with no branch above the floor would point at rows that do not
  // exist: the time stops at the frame after all, so it reads as the hot spot.
  return {
    hotPath,
    hotPathEnd: branches.length > 0 ? 'fan-out' : 'hot-spot',
    hotPathBranches: branches,
  };
}

/** The frame the walk landed on, in the shape the rows read. */
function frameOf(group: FrameGroup): HotPathFrame {
  const worst = largestInstance(group.instances);
  return {
    text: worst.text,
    eventIndex: worst.eventIndex,
    eventIndexes: group.instances.map((instance) => instance.eventIndex),
    totalTime: group.total,
    // An instance reporting a negative self can drag the group's sum outside
    // its total; the frame's own share of itself cannot sit outside it.
    selfTime: Math.min(Math.max(group.self, 0), group.total),
    count: group.instances.length,
    category: worst.category,
  };
}

/** Every child of every instance, without materialising a flattened array per level. */
function* childrenOf(parents: LogEvent[]): Generator<LogEvent> {
  for (const parent of parents) {
    yield* parent.children;
  }
}

/** Merge the events by signature, biggest total time first. */
function sortedGroups(events: Iterable<LogEvent>): FrameGroup[] {
  const groups = new Map<string, FrameGroup>();
  for (const event of events) {
    const key = getEventKey(event);
    const group = groups.get(key);
    if (group) {
      group.instances.push(event);
      group.total += event.duration.total;
      group.self += event.duration.self;
    } else {
      groups.set(key, {
        instances: [event],
        total: event.duration.total,
        self: event.duration.self,
      });
    }
  }
  return [...groups.values()].sort((a, b) => b.total - a.total);
}

function largestInstance(instances: LogEvent[]): LogEvent {
  // A group is only ever created holding an instance, so the array is never empty.
  let largest = instances[0]!;
  for (const instance of instances) {
    if (instance.duration.total > largest.duration.total) {
      largest = instance;
    }
  }
  return largest;
}

/**
 * Aggregate self time by signature and count truncated regions in one flat
 * pass. Every instance counts, including the untimed ones, so the count divides
 * the self time honestly; signatures with no self time at all drop out at the
 * end. Total time counts the outermost instances only: recursion nests the same
 * wall time inside itself, and `eventsById` is in time order, so an instance that
 * starts before the last counted one of its signature ended is inside it. The
 * call-stack route `Aggregation.ts` and `RowGrouper.ts` take with a `Multiset`
 * is not open to a flat pass, which never sees a frame close.
 * Truncation flags every unclosed frame in a cut-off chain, so only top-most
 * flagged events count as regions; the first one seen is the first in the log.
 */
function scanEvents(apexLog: ApexLog): Pick<ExecutionHighlights, 'hotSpots' | 'truncation'> {
  const spots = new Map<string, { row: HotSpotRow; maxSelf: number; countedUntil: number }>();
  let regionCount = 0;
  let firstEventIndex = -1;

  for (const event of apexLog.eventsById) {
    // The log itself holds the gap time, and no call stands for it.
    if (event === apexLog) {
      continue;
    }
    if (event.isTruncated && !event.parent?.isTruncated) {
      regionCount++;
      if (firstEventIndex < 0) {
        firstEventIndex = event.eventIndex;
      }
    }
    const self = event.duration.self;
    const timed = Math.max(self, 0);
    const total = Math.max(event.duration.total, 0);
    const end = event.exitStamp ?? event.timestamp;
    const key = getEventKey(event);
    const spot = spots.get(key);
    if (!spot) {
      spots.set(key, {
        row: {
          text: event.text,
          eventIndex: event.eventIndex,
          selfTime: timed,
          totalTime: total,
          count: 1,
          category: event.category,
        },
        maxSelf: self,
        countedUntil: end,
      });
    } else {
      spot.row.selfTime += timed;
      if (event.timestamp >= spot.countedUntil) {
        spot.row.totalTime += total;
        spot.countedUntil = end;
      }
      spot.row.count++;
      if (self > spot.maxSelf) {
        spot.maxSelf = self;
        spot.row.eventIndex = event.eventIndex;
        spot.row.category = event.category;
      }
    }
  }

  const hotSpots = [...spots.values()]
    .filter(({ row }) => row.selfTime > 0)
    .map(({ row }) => row)
    .sort((a, b) => b.selfTime - a.selfTime)
    .slice(0, HOT_SPOT_COUNT);
  for (const row of hotSpots) {
    // Nothing timed the outermost instances of a signature whose nested ones
    // were timed; the row still holds self time, so the total answers for both.
    row.totalTime = Math.max(row.totalTime, row.selfTime);
  }

  return {
    hotSpots,
    truncation: regionCount > 0 ? { regionCount, firstEventIndex } : null,
  };
}

/** Memo of the pass: the tree is built once per log, the tab re-opens often. */
const highlightsCache = new WeakMap<ApexLog, ExecutionHighlights>();

/** The memoised per-log entry point; the pass runs once per parsed log. */
export function getExecutionHighlights(apexLog: ApexLog): ExecutionHighlights {
  let highlights = highlightsCache.get(apexLog);
  if (!highlights) {
    highlights = computeExecutionHighlights(apexLog);
    highlightsCache.set(apexLog, highlights);
  }
  return highlights;
}
