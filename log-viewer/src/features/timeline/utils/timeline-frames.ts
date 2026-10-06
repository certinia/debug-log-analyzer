/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { LogEvent } from '@apexdevtools/apex-log-parser';

import type { LogIndex } from '../../../core/log/LogIndex.js';
import type { PrecomputedRect } from '../optimised/RectangleCache.js';
import {
  type EventNode,
  NO_ROW,
  TIMELINE_CONSTANTS,
  type TimelineFrames,
  type TreeNode,
} from '../types/flamechart.types.js';

export type ApexEventNode = EventNode & { original: LogEvent };

const NO_ROWS: Int32Array = new Int32Array(0);

/**
 * The timeline's frames for a log, read from its {@link LogIndex}: a rect for each
 * shown row whose category is in `categories`, and the shown rows at each depth.
 *
 * A row is shown when it and every parent have a duration, so a frame with none
 * hides its whole subtree.
 *
 * @param logEndTime - The log's own end, which floors `totalDuration`.
 */
export function buildTimelineFrames(
  index: LogIndex,
  categories: Set<string>,
  logEndTime: number,
): TimelineFrames<ApexEventNode> {
  const { rowCount, start, total, depth, parent, subtreeEnd, categoryId } = index;
  const eventHeight = TIMELINE_CONSTANTS.EVENT_HEIGHT;

  const shown = new Uint8Array(rowCount);
  const rowsAt: number[][] = [];
  const rects: PrecomputedRect[] = [];
  const rectAt = new Int32Array(rowCount).fill(NO_ROW);
  const rectsByCategory = new Map<string, PrecomputedRect[]>();
  for (const category of categories) {
    rectsByCategory.set(category, []);
  }
  const rectsByDepth = new Map<number, PrecomputedRect[]>();
  const rectsOfCategory = index.categoryNames.map((name) => rectsByCategory.get(name));
  let maxDepth = 0;
  let totalDuration = logEndTime;

  // A hidden row is jumped over with its subtree, so every row reached has a shown parent.
  for (let row = 0; row < rowCount;) {
    const rowTotal = total[row]!;
    if (rowTotal <= 0) {
      row = subtreeEnd[row]!;
      continue;
    }
    shown[row] = 1;
    const d = depth[row]!;
    (rowsAt[d] ??= []).push(row);
    if (d > maxDepth) {
      maxDepth = d;
    }
    const rowStart = start[row]!;
    const end = rowStart + rowTotal;
    if (end > totalDuration) {
      totalDuration = end;
    }

    const ofCategory = rectsOfCategory[categoryId[row]!];
    if (ofCategory) {
      const event = index.event(row);
      const rect: PrecomputedRect = {
        id: String(row),
        timeStart: rowStart,
        timeEnd: end,
        depth: d,
        duration: rowTotal,
        selfDuration: index.self[row]!,
        category: event.category,
        eventRef: event,
        x: 0,
        y: d * eventHeight,
        width: 0,
        height: eventHeight,
      };
      rectAt[row] = rects.length;
      rects.push(rect);
      ofCategory.push(rect);
      let atDepth = rectsByDepth.get(d);
      if (!atDepth) {
        atDepth = [];
        rectsByDepth.set(d, atDepth);
      }
      atDepth.push(rect);
    }
    row++;
  }

  // Pre-order is start order unless the log's timestamps go backwards.
  const rowsByDepth = rowsAt.map((rows) => Int32Array.from(sortIfNeeded(rows, start)));

  return {
    rowCount,
    maxDepth,
    totalDuration,
    start,
    total,
    depth,
    parent,
    subtreeEnd,
    rectsByCategory,
    rectsByDepth,
    isVisible: (row) => shown[row] === 1,
    rowsAtDepth: (d) => rowsByDepth[d] ?? NO_ROWS,
    node: (row): TreeNode<ApexEventNode> => {
      const event = index.event(row);
      return {
        row,
        depth: depth[row],
        data: {
          id: String(row),
          timestamp: start[row]!,
          duration: total[row]!,
          type: typeOf(event),
          text: event.text,
          original: event,
        },
      };
    },
    text: (row) => index.event(row).text,
    type: (row) => typeOf(index.event(row)),
    rowOfOriginal: (original) => {
      if (!original) {
        return NO_ROW;
      }
      const row = index.rowOfEvent(original as LogEvent);
      return row !== NO_ROW && shown[row] === 1 ? row : NO_ROW;
    },
    rectOf: (row) => rects[rectAt[row] ?? NO_ROW],
  };
}

function typeOf(event: LogEvent): string {
  return event.type ?? event.category ?? 'UNKNOWN';
}

function sortIfNeeded(rows: number[], start: Float64Array): number[] {
  for (let i = 1; i < rows.length; i++) {
    if (start[rows[i]!]! < start[rows[i - 1]!]!) {
      return rows.sort((a, b) => start[a]! - start[b]!);
    }
  }
  return rows;
}
