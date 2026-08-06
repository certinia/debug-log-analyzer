/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ApexLog, LogEvent } from 'apex-log-parser';

import { DatabaseAccess } from '../../database/services/Database.js';
import { getEventKey } from './Aggregation.js';

/** One frame on the hot path, entry point first. */
export interface HotPathFrame {
  text: string;
  /** The instance with the most total time, so a click lands on the worst one. */
  eventIndex: number;
  /** Total time summed across every merged sibling; its share of the log is `totalTime / totalTime(log)`. */
  totalTime: number;
  /** How many sibling instances the frame merges. */
  count: number;
}

/** One signature in the top-self-time list. */
export interface HotSpotRow {
  text: string;
  /** The instance with the most self time, so a click lands on the worst one. */
  eventIndex: number;
  /** Self time summed across every instance of the signature. */
  selfTime: number;
  /** How many instances the signature has, timed or not, so `selfTime / count` is the honest average. */
  count: number;
}

/** Where the log runs hottest, plus the caveat that would poison those figures. */
export interface ExecutionHighlights {
  /** The log's own total time, the denominator for every share shown. */
  totalTime: number;
  hotPath: HotPathFrame[];
  hotSpots: HotSpotRow[];
  /** Calls the log's size cap cut off; their subtrees under-report every timing. */
  truncation: { regionCount: number; firstEventIndex: number } | null;
}

/**
 * Follow the biggest child while it still holds this share of its parent's
 * time; below it the time has spread out, and the last frame is the hot spot.
 */
const HOT_PATH_FOLLOW_SHARE = 0.4;

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
    hotPath: computeHotPath(apexLog.children),
    ...scanEvents(apexLog.eventsById),
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
 * time beats the largest child group, which makes this frame the hot spot.
 */
function computeHotPath(roots: LogEvent[]): HotPathFrame[] {
  const frames: HotPathFrame[] = [];
  let current = largestGroup(roots);
  while (current && current.total > 0) {
    const worst = largestInstance(current.instances);
    frames.push({
      text: worst.text,
      eventIndex: worst.eventIndex,
      totalTime: current.total,
      count: current.instances.length,
    });
    const next = largestGroup(childrenOf(current.instances));
    if (!next || next.total < HOT_PATH_FOLLOW_SHARE * current.total || current.self > next.total) {
      break;
    }
    current = next;
  }
  return frames;
}

/** Every child of every instance, without materialising a flattened array per level. */
function* childrenOf(parents: LogEvent[]): Generator<LogEvent> {
  for (const parent of parents) {
    yield* parent.children;
  }
}

/** Merge the events by signature and return the group holding the most total time. */
function largestGroup(events: Iterable<LogEvent>): FrameGroup | null {
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
  let largest: FrameGroup | null = null;
  for (const group of groups.values()) {
    if (!largest || group.total > largest.total) {
      largest = group;
    }
  }
  return largest;
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
 * end. Truncation flags every unclosed frame in a cut-off chain, so only
 * top-most flagged events count as regions; `eventsById` is in time order, so
 * the first one seen is the first in the log.
 */
function scanEvents(events: LogEvent[]): Pick<ExecutionHighlights, 'hotSpots' | 'truncation'> {
  const spots = new Map<string, HotSpotRow & { maxSelf: number }>();
  let regionCount = 0;
  let firstEventIndex = -1;

  for (const event of events) {
    if (event.isTruncated && !event.parent?.isTruncated) {
      regionCount++;
      if (firstEventIndex < 0) {
        firstEventIndex = event.eventIndex;
      }
    }
    const self = event.duration.self;
    const timed = Math.max(self, 0);
    const key = getEventKey(event);
    const spot = spots.get(key);
    if (!spot) {
      spots.set(key, {
        text: event.text,
        eventIndex: event.eventIndex,
        selfTime: timed,
        count: 1,
        maxSelf: self,
      });
    } else {
      spot.selfTime += timed;
      spot.count++;
      if (self > spot.maxSelf) {
        spot.maxSelf = self;
        spot.eventIndex = event.eventIndex;
      }
    }
  }

  const hotSpots = [...spots.values()]
    .filter((spot) => spot.selfTime > 0)
    .sort((a, b) => b.selfTime - a.selfTime)
    .slice(0, HOT_SPOT_COUNT)
    .map(({ text, eventIndex, selfTime, count }) => ({ text, eventIndex, selfTime, count }));

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

/** The highlights for the log on screen, or null before the first parse. */
export function getCurrentExecutionHighlights(): ExecutionHighlights | null {
  const apexLog = DatabaseAccess.instance()?.getApexLog();
  return apexLog ? getExecutionHighlights(apexLog) : null;
}
