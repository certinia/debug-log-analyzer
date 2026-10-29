/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { LOG_CATEGORY, type LogCategory } from '#core/log/category.js';
import { buildLogIndex } from '#core/log/LogIndex.js';
import type { PrecomputedRect } from '../../features/timeline/optimised/RectangleCache.js';
import {
  BUCKET_CONSTANTS,
  type RectColumns,
  TIMELINE_CONSTANTS,
} from '../../features/timeline/types/flamechart.types.js';
import { buildTimelineFrames } from '../../features/timeline/utils/timeline-frames.js';
import { storeOf } from './apexLog.js';

/** A frame for {@link rectsOf}: when it runs, its category, and the frames it calls. */
export interface FrameSpec {
  timestamp: number;
  duration: number;
  category: LogCategory;
  children: FrameSpec[];
}

/** A frame for {@link columnsOf}: where it sits, and its category. */
export interface SpanSpec {
  category: string;
  timeStart: number;
  timeEnd: number;
  depth: number;
}

export function span(
  category: string,
  timeStart: number,
  timeEnd: number,
  depth: number,
): SpanSpec {
  return { category, timeStart, timeEnd, depth };
}

/** `spans` as columns, one row each, every depth's rows ascending by start as frames give them. */
export function columnsOf(spans: SpanSpec[]): RectColumns {
  // Id 0 is no category, as in LogIndex.
  const categoryNames = [...new Set(['', ...spans.map((span) => span.category)])];
  const start = Float64Array.from(spans, (span) => span.timeStart);
  const depth = Uint16Array.from(spans, (span) => span.depth);
  return {
    start,
    total: Float64Array.from(spans, (span) => span.timeEnd - span.timeStart),
    depth,
    categoryId: Uint8Array.from(spans, (span) => categoryNames.indexOf(span.category)),
    categoryNames,
    rectRowsByDepth: rowsByDepth([...spans.keys()], start, depth),
    rectOf: () => undefined,
  };
}

function rowsByDepth(rows: number[], start: Float64Array, depth: Uint16Array): Int32Array[] {
  const byDepth: Int32Array[] = [];
  for (const row of [...rows].sort((a, b) => start[a]! - start[b]!)) {
    const at = depth[row]!;
    byDepth[at] = Int32Array.of(...(byDepth[at] ?? []), row);
  }
  return byDepth;
}

/** The timeline's frames for a log `body`, as the chart builds them. */
export async function framesOf(body: string, logEnd = 0) {
  const { log } = await storeOf(body);
  const index = buildLogIndex(log);
  const categories = new Set<string>(BUCKET_CONSTANTS.CATEGORY_PRIORITY);
  return { log, index, frames: buildTimelineFrames(index, categories, logEnd) };
}

/** A frame spanning `duration` from `timestamp`, all of it self time. */
export function timelineEvent(
  timestamp: number,
  duration: number,
  category: LogCategory = 'Apex',
  children: FrameSpec[] = [],
): FrameSpec {
  return { timestamp, duration, category, children };
}

/**
 * The rects the chart draws for `roots`, as `buildTimelineFrames` lays them out:
 * rows in pre-order, and a frame with no duration hiding its subtree.
 */
export function rectsOf(roots: FrameSpec[]): RectColumns {
  const drawn = new Set<string>(BUCKET_CONSTANTS.CATEGORY_PRIORITY);
  const rects: PrecomputedRect[] = [];
  const categories: LogCategory[] = [];
  let row = 0;
  const visit = (frames: FrameSpec[], depth: number): void => {
    for (const frame of frames) {
      const at = row++;
      categories[at] = frame.category;
      if (frame.duration <= 0) {
        continue;
      }
      const rect: PrecomputedRect = {
        id: String(at),
        row: at,
        timeStart: frame.timestamp,
        timeEnd: frame.timestamp + frame.duration,
        depth,
        duration: frame.duration,
        category: frame.category,
        x: 0,
        y: depth * TIMELINE_CONSTANTS.EVENT_HEIGHT,
        width: 0,
        height: TIMELINE_CONSTANTS.EVENT_HEIGHT,
      };
      if (drawn.has(frame.category)) {
        rects.push(rect);
      }
      visit(frame.children, depth + 1);
    }
  };
  visit(roots, 0);

  // LogIndex's id order, then any category the test made up.
  const categoryNames = [...new Set<string>(['', ...Object.values(LOG_CATEGORY), ...categories])];
  const rectAt = new Map(rects.map((rect) => [rect.row, rect]));
  const start = Float64Array.from({ length: row }, (_, at) => rectAt.get(at)?.timeStart ?? 0);
  const depth = Uint16Array.from({ length: row }, (_, at) => rectAt.get(at)?.depth ?? 0);
  return {
    start,
    total: Float64Array.from({ length: row }, (_, at) => rectAt.get(at)?.duration ?? 0),
    depth,
    categoryId: Uint8Array.from(categories, (category) => categoryNames.indexOf(category)),
    categoryNames,
    rectRowsByDepth: rowsByDepth([...rectAt.keys()], start, depth),
    // A copy, as the frames make a new rect on every call.
    rectOf: (at) => {
      const rect = rectAt.get(at);
      return rect && { ...rect };
    },
  };
}
