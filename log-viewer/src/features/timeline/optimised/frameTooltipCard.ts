/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * What the timeline's hover card says, and in what order — no DOM, so the content
 * can be read in a test without laying a panel out.
 *
 * The card is a preview, not a report: it leads with the reading the hover was for,
 * keeps the rows a glance can take in, and leaves the rest to the Inspector. Every row
 * is the same three columns — label, reading, the frame's own figure — so the readings
 * line up down the card.
 *
 * A reading is measured against the log's own total, never against a governor limit:
 * the hover is for deciding where to look, and "is the work here" varies frame to frame
 * where "is the transaction near a limit" does not. Risk against limits is the governor
 * strip's job, and the Inspector's. The denominator is spelled "of", not "/", so a
 * reading cannot be taken for consumption of a cap.
 */

import type { ApexLog, LogEvent } from 'apex-log-parser';

import { EVENT_METRICS, HEAP_PEAK } from '../../../core/metrics/eventMetrics.js';
import { DEFAULT_NAMESPACE } from '../../../core/utility/CallerNamespace.js';
import {
  computeWallClockMs,
  formatByteSize,
  formatDuration,
  formatInteger,
  formatWallClockTime,
} from '../../../core/utility/Util.js';
import type { TimelineMarker } from '../types/flamechart.types.js';

/**
 * How many metric rows the card holds. Past this the least-pressured are dropped and
 * counted in the footer — a hover that has to be read top to bottom has stopped
 * being a hover.
 */
export const MAX_METRIC_ROWS = 6;

/** A metric that always earns its row: a throw is rare, and never incidental. */
const NEVER_DROPPED = new Set(['Throws']);

/** One line of the card: a reading, and the frame's own share of it. */
export interface CardRow {
  label: string;
  value: string;
  /** The frame's own reading, bare. Kept at zero — `0` says the work is in a child. */
  self: string | null;
  /**
   * The branch's share of the log's own total, 0–1. Not shown: the reading already
   * names the log's figure, so the share is what ranks the rows for the cap.
   */
  share: number | null;
  /** The reading takes the self column too, for one that is not a figure. */
  wide?: boolean;
  /** The reading the hover was for. Carries the card's one piece of emphasis. */
  lead?: boolean;
}

/** A frame or a marker as the card reads it, top to bottom. */
export interface TooltipCard {
  /** The marker's summary. A frame's name is its description block instead. */
  title?: string;
  /** Category, type, namespace and line — the parts of the identity line, in order. */
  identity?: string[];
  /** Row groups, parted by space. They are all readings, so no rule divides them. */
  groups: CardRow[][];
  /** Metrics the cap left out. */
  hidden?: number;
  /** The colour of the rail down the card's left edge. */
  rail: string;
}

/** The reading the hover was for: how long the frame took, and how much was its own. */
function timeRow(event: LogEvent): CardRow | null {
  if (!event.exitStamp || !event.duration.total) {
    return null;
  }
  return {
    // Free qualifies which time this is, so it rides with the label rather than in a
    // figure column, where it collided with the reading. Salesforce does not charge
    // this duration against CPU, which is why it shows on the database frames.
    label: event.cpuType === 'free' ? 'Time · free' : 'Time',
    // Alone of the readings, this one names no log figure to read against: the chart
    // is the duration chart, so the log's span is already on the axis, in the minimap,
    // and in the frame's own width. It would also pair mismatched units — "58.2 ms of
    // 24.6 s" is a ratio no eye can take.
    value: formatDuration(event.duration.total),
    self: formatDuration(event.duration.self),
    // Unranked: the timing row is its own group, so the cap never weighs it.
    share: null,
    lead: true,
  };
}

/**
 * A branch's share of the log's own total. Both come from the same tree sum, never
 * from the cumulative figures Salesforce reports: mixing the two would put a branch
 * over 100% whenever the log dropped events those figures still counted.
 *
 * A signed net can be negative, and a share of it says nothing, so it goes unstated.
 */
function shareOfLog(value: number, logTotal: number): number | null {
  if (logTotal <= 0 || value < 0) {
    return null;
  }
  return Math.min(1, value / logTotal);
}

/** The frame's clock range, where the log records a start time to count from. */
function wallClockRow(event: LogEvent, apexLog: ApexLog | null | undefined): CardRow | null {
  const { startTime, timestamp } = apexLog ?? {};
  if (startTime === null || startTime === undefined || timestamp === undefined) {
    return null;
  }
  const at = (ns: number) => formatWallClockTime(computeWallClockMs(startTime, timestamp, ns));
  return {
    label: 'Wall clock',
    value: event.exitStamp
      ? `${at(event.timestamp)} → ${at(event.exitStamp)}`
      : at(event.timestamp),
    self: null,
    share: null,
    wide: true,
  };
}

/**
 * Every non-zero metric the frame reports, in {@link EVENT_METRICS} order. Ranking
 * decides what the cap drops; the order never changes, so a row cannot overtake
 * another as the pointer moves between frames.
 */
function metricRows(event: LogEvent, apexLog: ApexLog | null | undefined): CardRow[] {
  const rows: CardRow[] = [];

  for (const metric of EVENT_METRICS) {
    const { total, self } = metric.pick(event);
    if (!total && !self) {
      continue;
    }
    // Compact bytes: the card is width-bound where the Inspector is not.
    const format = metric.bytes ? formatByteSize : formatInteger;
    const logTotal = apexLog ? metric.pick(apexLog).total : 0;
    const share = shareOfLog(total, logTotal);
    rows.push({
      label: metric.label,
      // Spelled "of" rather than "/": the log's total is not a cap, and a slash would
      // read as one. A byte magnitude names no log figure at all — the unit follows the
      // value, so the pair would read "100 bytes of 6 MB".
      value:
        share !== null && !metric.bytes ? `${format(total)} of ${format(logTotal)}` : format(total),
      share,
      // Zero included: it is what says the work happened in a descendant, not here.
      self: metric.noSelf ? null : format(self),
    });
  }

  const peak = HEAP_PEAK.pick(event);
  if (peak) {
    rows.push({
      label: HEAP_PEAK.label,
      value: formatByteSize(peak),
      self: null,
      // A peak composes by max, not by sum: every frame spanning the transaction's peak
      // reports the root's own figure, so a share of it would be 1 and would outrank
      // every summed metric on the card. Unranked, so the cap drops it first.
      share: null,
    });
  }
  return rows;
}

/**
 * The rows the cap keeps, still in reading order. The branch's share of the log
 * decides what survives, so the metrics this branch is most answerable for are the
 * ones kept — except a throw, which is a signal in itself.
 */
function capped(rows: CardRow[]): { kept: CardRow[]; hidden: number } {
  if (rows.length <= MAX_METRIC_ROWS) {
    return { kept: rows, hidden: 0 };
  }
  // Sort is stable, so equal pressure holds reading order; picking the survivors back out
  // by membership restores that order without a second sort.
  const keep = new Set(
    [...rows]
      .sort((a, b) => notable(b) - notable(a) || (b.share ?? 0) - (a.share ?? 0))
      .slice(0, MAX_METRIC_ROWS),
  );
  return { kept: rows.filter((row) => keep.has(row)), hidden: rows.length - MAX_METRIC_ROWS };
}

/** A tier above any share, so a metric that always earns its row sorts first. */
function notable(row: CardRow): number {
  return NEVER_DROPPED.has(row.label) ? 1 : 0;
}

/** The identity line: what the frame is, whose code it is, and where it came from. */
function identityOf(event: LogEvent): string[] {
  const parts: string[] = [];
  if (event.category) {
    parts.push(event.category);
  }
  if (event.type) {
    parts.push(event.type);
  }
  if (event.namespace && event.namespace !== DEFAULT_NAMESPACE) {
    parts.push(event.namespace);
  }
  // The call site, in the code that contains it — not where the frame is defined. So
  // "from": it is what tells two calls to one method from different places apart, and
  // it is the line Go to Source lands on. EXTERNAL stands alone: the caller is outside
  // the classes the log covers, so there is no line to have come from.
  if (event.lineNumber !== null && event.lineNumber !== undefined) {
    parts.push(
      typeof event.lineNumber === 'number' ? `from line ${event.lineNumber}` : event.lineNumber,
    );
  }
  return parts;
}

/**
 * The card for a hovered frame.
 * @param rail - The category's colour, which the caller resolves from the palette.
 */
export function frameCard(event: LogEvent, rail: string, apexLog?: ApexLog | null): TooltipCard {
  const time = timeRow(event);
  // No exit means nothing measured: the counts are summed on the way out, so a frame
  // still open has no reading to report.
  const { kept, hidden } = capped(event.exitStamp ? metricRows(event, apexLog) : []);
  // Last: the clock is reference data, not what the hover asked.
  const clock = wallClockRow(event, apexLog);

  return {
    // No title — a frame's name is the description block, pretty-printed where it is a
    // query, so a title over it would only say the same thing twice.
    identity: identityOf(event),
    groups: [time ? [time] : [], kept, clock ? [clock] : []].filter((group) => group.length > 0),
    hidden,
    rail,
  };
}

/** The card for a truncation or exception marker. */
export function markerCard(marker: TimelineMarker, rail: string): TooltipCard {
  const span =
    marker.endTime !== undefined && marker.endTime > marker.startTime
      ? {
          label: 'Spans',
          value: formatDuration(marker.endTime - marker.startTime),
          self: null,
          share: null,
          // The marker's one reading, so it leads as a frame's timing row does.
          lead: true,
        }
      : null;
  return {
    title: marker.summary,
    groups: span ? [[span]] : [],
    rail,
  };
}
