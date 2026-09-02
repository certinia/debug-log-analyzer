/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ApexLog, LogCategory, LogEvent } from 'apex-log-parser';

import { getEventKey } from '../../../core/log/eventKeys.js';

/** Signatures the spread draws a histogram for, the most self time first. */
const LANE_COUNT = 5;

/** One-off calls the spread names beneath the lanes, the most self time first. */
const SINGLE_COUNT = 3;

/** Buckets across a lane. Twenty-four still reads as a shape at the pane's narrowest. */
const BIN_COUNT = 24;

/** The share of the log's self time the concentration line counts up to. */
export const CONCENTRATION_PERCENT = 80;

/** How high a bin holding one call draws, as a share of the tallest, so a lone
 *  outlier stays visible beside a bin holding hundreds. */
const MIN_BIN_PERCENT = 10;

/** One signature's calls, ranked and bucketed. */
export interface SpreadRow {
  text: string;
  /** The worst call's category, so the lane takes the flame chart's own colour. */
  category: LogCategory;
  /** The call with the most self time, so a click lands on the outlier. */
  eventIndex: number;
  /** Timed calls of the signature. */
  count: number;
  /** Self time summed across those calls. */
  selfTime: number;
  median: number;
  p95: number;
  /** The worst call's self time — the top of the lane's scale. */
  max: number;
  /** Calls per bucket over `0..max`, so a lane draws without the raw values. */
  bins: number[];
  /** Bin heights as percentages of the fullest bin, so a lane needs no maths to draw. */
  heights: number[];
}

/** A call the log made once: there is no spread to draw, only the time it cost. */
export interface SingleRow {
  text: string;
  category: LogCategory;
  eventIndex: number;
  selfTime: number;
}

/** How the log's self time spreads: within a signature, and across them all. */
export interface SelfTimeSpread {
  lanes: SpreadRow[];
  /** Calls made once, which hold self time but have no shape. */
  singles: SingleRow[];
  /** Signatures holding {@link CONCENTRATION_PERCENT} of the log's self time,
   *  out of every timed signature; null when the log timed nothing. */
  concentration: { signatures: number; total: number } | null;
}

/** What one signature's calls came to, before the values are bucketed. */
interface Tally {
  /** The signature the calls were grouped by, so the second pass can find them again. */
  key: string;
  text: string;
  category: LogCategory;
  eventIndex: number;
  count: number;
  selfTime: number;
  max: number;
}

/**
 * The distribution behind the Analysis grid's averages. A signature's mean self
 * time hides its shape: 400 calls at 2 ms and 399 at 2 ms plus one at 900 ms
 * average the same, and only the second is a bug you can fix. Every APM answers
 * this with a histogram over the calls, which is what a lane draws.
 *
 * Only calls the log timed count. A call with no self time was not measured, and
 * a bucket of unmeasured zeros would read as free work. A call the log made once
 * often holds the most self time of all, so it is named beneath the lanes rather
 * than drawn as one: a histogram of a single call has no shape to read.
 *
 * Two flat passes over the log's events: the first ranks the signatures, the
 * second collects the values of the few that earned a lane. Nothing keeps a value
 * per call for the whole log.
 */
export function computeSelfTimeSpread(apexLog: ApexLog): SelfTimeSpread {
  const tallies = tally(apexLog);
  const ranked = [...tallies.values()].sort((a, b) => b.selfTime - a.selfTime);
  const lanes = ranked.filter((found) => found.count > 1).slice(0, LANE_COUNT);
  const values = collect(apexLog.eventsById, lanes);

  return {
    lanes: lanes.map((lane) => row(lane, values.get(lane.key) ?? [])),
    singles: ranked
      .filter((found) => found.count === 1)
      .slice(0, SINGLE_COUNT)
      .map(({ text, category, eventIndex, selfTime }) => ({
        text,
        category,
        eventIndex,
        selfTime,
      })),
    concentration: concentrationOf(ranked),
  };
}

/** Sum, count and rank the timed calls of every signature in one pass. */
function tally(apexLog: ApexLog): Map<string, Tally> {
  const tallies = new Map<string, Tally>();
  for (const event of apexLog.eventsById) {
    const self = event.duration.self;
    // The log itself holds the gap time, and no grid row stands for it.
    if (self <= 0 || event === apexLog) {
      continue;
    }
    const key = getEventKey(event);
    const found = tallies.get(key);
    if (!found) {
      tallies.set(key, {
        key,
        text: event.text,
        category: event.category,
        eventIndex: event.eventIndex,
        count: 1,
        selfTime: self,
        max: self,
      });
      continue;
    }
    found.count++;
    found.selfTime += self;
    if (self > found.max) {
      found.max = self;
      found.eventIndex = event.eventIndex;
      found.category = event.category;
    }
  }
  return tallies;
}

/** The self times of the signatures that earned a lane, ascending. */
function collect(events: LogEvent[], lanes: Tally[]): Map<string, number[]> {
  if (!lanes.length) {
    return new Map();
  }
  const values = new Map<string, number[]>(lanes.map((lane) => [lane.key, []]));
  for (const event of events) {
    const self = event.duration.self;
    if (self <= 0) {
      continue;
    }
    values.get(getEventKey(event))?.push(self);
  }
  for (const list of values.values()) {
    list.sort((a, b) => a - b);
  }
  return values;
}

/** One lane: the readings the row names, and the shape it draws. */
function row(lane: Tally, sorted: number[]): SpreadRow {
  const bins = new Array<number>(BIN_COUNT).fill(0);
  for (const value of sorted) {
    // The top value belongs to the last bin, not one past the end.
    const index = Math.min(Math.floor((value / lane.max) * BIN_COUNT), BIN_COUNT - 1);
    bins[index]!++;
  }
  return {
    text: lane.text,
    category: lane.category,
    eventIndex: lane.eventIndex,
    count: lane.count,
    selfTime: lane.selfTime,
    median: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: lane.max,
    bins,
    heights: binHeights(bins),
  };
}

/** Nearest-rank percentile of an ascending list, the reading a histogram supports. */
function percentile(sorted: number[], share: number): number {
  if (!sorted.length) {
    return 0;
  }
  return sorted[Math.min(Math.ceil(share * sorted.length) - 1, sorted.length - 1)] ?? 0;
}

/** How few signatures the log's self time comes down to. */
function concentrationOf(ranked: Tally[]): SelfTimeSpread['concentration'] {
  const total = ranked.reduce((sum, found) => sum + found.selfTime, 0);
  if (total <= 0) {
    return null;
  }
  const target = (CONCENTRATION_PERCENT / 100) * total;
  let running = 0;
  let signatures = 0;
  while (running < target && signatures < ranked.length) {
    running += ranked[signatures]!.selfTime;
    signatures++;
  }
  return { signatures, total: ranked.length };
}

/** Memo of the two passes: the tree is built once per log, the pane re-opens often. */
const spreadCache = new WeakMap<ApexLog, SelfTimeSpread>();

/** The memoised per-log entry point; the passes run once per parsed log. */
export function getSelfTimeSpread(apexLog: ApexLog): SelfTimeSpread {
  let spread = spreadCache.get(apexLog);
  if (!spread) {
    spread = computeSelfTimeSpread(apexLog);
    spreadCache.set(apexLog, spread);
  }
  return spread;
}

/** The self times a bin covers, so a hovered bin can name its own range. */
export function binRange(max: number, index: number): [number, number] {
  const step = max / BIN_COUNT;
  return [step * index, step * (index + 1)];
}

/** Which bin a point along a lane falls in, from its share of the lane's width. */
export function binAt(share: number): number {
  return Math.min(Math.max(Math.floor(share * BIN_COUNT), 0), BIN_COUNT - 1);
}

/** Bin heights as percentages of the tallest, so an occupied bin always draws. */
function binHeights(bins: number[]): number[] {
  const peak = Math.max(...bins);
  return bins.map((count) => (count > 0 ? Math.max((count / peak) * 100, MIN_BIN_PERCENT) : 0));
}
