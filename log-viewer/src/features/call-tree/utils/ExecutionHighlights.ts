/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ApexLog, LogEvent, LogCategory } from '@apexdevtools/apex-log-parser';

import { type SignatureLookup, signatureSlot } from '../../../core/log/eventKeys.js';
import { signatureTimes, type SignatureTimes } from '../../../core/log/signatureTimes.js';
import type { Derivation } from '../../../core/log/LogStore.js';
import { CHECK_EVERY, frameBudget, type Tick } from '../../../core/utility/FrameBudget.js';

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
  /** Sections the platform dropped; a timing spanning one may under-report. */
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
export const executionHighlights: Derivation<ExecutionHighlights> = async (_, store) => {
  const apexLog = store.log;
  // Together, so the two sliced passes take turns.
  const [hotPath, times] = await Promise.all([
    computeHotPath(apexLog.children),
    store.derive(signatureTimes),
  ]);
  return {
    totalTime: apexLog.duration.total,
    ...hotPath,
    hotSpots: hotSpotsOf(times),
    truncation: truncationOf(apexLog),
  };
};

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
async function computeHotPath(
  roots: LogEvent[],
): Promise<Pick<ExecutionHighlights, 'hotPath' | 'hotPathEnd' | 'hotPathBranches'>> {
  // A level can hold a loop's every call, so the grouping hands the thread back.
  const tick = frameBudget({});
  const hotPath: HotPathFrame[] = [];
  let current = (await sortedGroups([roots], tick))[0];
  let children: FrameGroup[] = [];
  while (current && current.total > 0) {
    hotPath.push(frameOf(current));
    children = await sortedGroups(
      current.instances.map((instance) => instance.children),
      tick,
    );
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

/** Merge the events of every list by signature, biggest total time first. */
async function sortedGroups(lists: readonly LogEvent[][], tick: Tick): Promise<FrameGroup[]> {
  const lookup: SignatureLookup<FrameGroup> = new Map();
  const groups: FrameGroup[] = [];
  let seen = 0;
  for (const events of lists) {
    for (const event of events) {
      if (++seen % CHECK_EVERY === 0) {
        await tick();
      }
      const byText = signatureSlot(lookup, event);
      const group = byText.get(event.text);
      if (group) {
        group.instances.push(event);
        group.total += event.duration.total;
        group.self += event.duration.self;
      } else {
        const made = {
          instances: [event],
          total: event.duration.total,
          self: event.duration.self,
        };
        byText.set(event.text, made);
        groups.push(made);
      }
    }
  }
  return groups.sort((a, b) => b.total - a.total);
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
 * The signatures with the most self time. Every instance counts, including the
 * untimed ones, so the count divides the self time honestly; signatures with no
 * self time at all drop out. Total time counts the outermost instances only:
 * recursion nests the same wall time inside itself.
 */
function hotSpotsOf(times: SignatureTimes): HotSpotRow[] {
  return times.ranked
    .slice(0, HOT_SPOT_COUNT)
    .map(({ text, eventIndex, selfTime, outerTotal, count, category }) => ({
      text,
      eventIndex,
      selfTime,
      // Nothing timed the outermost instances of a signature whose nested ones
      // were timed; the row still holds self time, so the total answers for both.
      totalTime: Math.max(outerTotal, selfTime),
      count,
      category,
    }));
}

function truncationOf(apexLog: ApexLog): ExecutionHighlights['truncation'] {
  // The same regions the Analysis notice counts, so the two never state a different
  // number for one log. An event's own `isTruncated` cannot: the parser sets it on
  // the log root too, which masks every chain hanging off it.
  const { regions } = apexLog.truncation;
  return regions.length
    ? { regionCount: regions.length, firstEventIndex: regions[0]?.eventIndex ?? -1 }
    : null;
}
