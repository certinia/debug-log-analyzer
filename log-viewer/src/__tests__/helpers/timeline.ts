/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { LogCategory } from '../../core/log/category.js';
import { buildLogIndex } from '../../core/log/LogIndex.js';
import type {
  PrecomputedRect,
  PrecomputedRectData,
} from '../../features/timeline/optimised/RectangleCache.js';
import {
  BUCKET_CONSTANTS,
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
export function rectsOf(roots: FrameSpec[]): PrecomputedRectData {
  const rectsByCategory = new Map<string, PrecomputedRect[]>(
    BUCKET_CONSTANTS.CATEGORY_PRIORITY.map((category) => [category, []]),
  );
  const rectsByDepth = new Map<number, PrecomputedRect[]>();
  let row = 0;
  const visit = (frames: FrameSpec[], depth: number): void => {
    for (const frame of frames) {
      const at = row++;
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
        selfDuration: frame.duration,
        category: frame.category,
        x: 0,
        y: depth * TIMELINE_CONSTANTS.EVENT_HEIGHT,
        width: 0,
        height: TIMELINE_CONSTANTS.EVENT_HEIGHT,
      };
      const ofCategory = rectsByCategory.get(frame.category);
      if (ofCategory) {
        ofCategory.push(rect);
        rectsByDepth.set(depth, [...(rectsByDepth.get(depth) ?? []), rect]);
      }
      visit(frame.children, depth + 1);
    }
  };
  visit(roots, 0);
  return { rectsByCategory, rectsByDepth };
}

/** Every category's buckets in one list. */
export function getAllBuckets<T>(bucketsMap: Map<string, T[]>): T[] {
  const allBuckets: T[] = [];
  for (const buckets of bucketsMap.values()) {
    allBuckets.push(...buckets);
  }
  return allBuckets;
}

/** The bucket count across every category. */
export function countBuckets(bucketsMap: Map<string, unknown[]>): number {
  let count = 0;
  for (const buckets of bucketsMap.values()) {
    count += buckets.length;
  }
  return count;
}
