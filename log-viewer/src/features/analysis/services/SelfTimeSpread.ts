/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { LogCategory } from '@apexdevtools/apex-log-parser';

import { idsBySelfTime, keySelfTimes, type KeySelfTimes } from '../../../core/log/keySelfTimes.js';
import type { LogIndex } from '../../../core/log/LogIndex.js';
import type { Derivation } from '../../../core/log/LogStore.js';

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
  /** The key id, so the second pass can find the calls again. */
  id: number;
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
 * The signatures are ranked from `times`; one pass over the index then collects
 * the values of the few that earned a lane. Nothing keeps a value per call for
 * the whole log.
 */
export function computeSelfTimeSpread(index: LogIndex, times: KeySelfTimes): SelfTimeSpread {
  const ranked = idsBySelfTime(times).map((id) => tally(index, times, id));
  const lanes = ranked.filter((found) => found.count > 1).slice(0, LANE_COUNT);
  const values = collect(index, times.ids, lanes);

  return {
    // `collect` returns one list per lane.
    lanes: lanes.map((lane, slot) => row(lane, values[slot]!)),
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

/** {@link computeSelfTimeSpread}, once per log. */
export const selfTimeSpread: Derivation<SelfTimeSpread> = async (index, store) =>
  computeSelfTimeSpread(index, await store.derive(keySelfTimes));

function tally(index: LogIndex, times: KeySelfTimes, id: number): Tally {
  // In range: ids and rows come from the same index as `times`.
  const worst = times.maxRow[id]!;
  const event = index.event(worst);
  return {
    id,
    text: event.text,
    category: event.category,
    eventIndex: index.eventIndex[worst]!,
    count: times.timedCount[id]!,
    selfTime: times.selfTime[id]!,
    max: index.self[worst]!,
  };
}

/** The self times of the signatures that earned a lane, ascending, one list per lane. */
function collect(index: LogIndex, ids: Uint32Array, lanes: Tally[]): number[][] {
  const values = lanes.map((): number[] => []);
  if (!lanes.length) {
    return values;
  }
  // Read past its end for a key above every lane, which `?? -1` takes as no lane.
  const slotOf = new Int8Array(Math.max(...lanes.map((lane) => lane.id)) + 1).fill(-1);
  lanes.forEach((lane, slot) => {
    slotOf[lane.id] = slot;
  });
  const { self, rowCount } = index;
  // In range: every row is below rowCount, every slot below lanes.length.
  for (let row = 0; row < rowCount; row++) {
    const value = self[row]!;
    if (value <= 0) {
      continue;
    }
    const slot = slotOf[ids[row]!] ?? -1;
    if (slot >= 0) {
      values[slot]!.push(value);
    }
  }
  for (const list of values) {
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
