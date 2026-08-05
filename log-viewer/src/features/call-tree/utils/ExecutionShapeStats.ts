/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { LogEvent } from 'apex-log-parser';

import { EXCLUDED_DETAIL_TYPES } from './DetailsFilter.js';

/** The structural profile of a parsed log's call tree. */
export interface ExecutionShapeStats {
  /** Every event in the tree, detail rows included. */
  eventCount: number;
  /** Rows the call tree shows by default — detail rows excluded. */
  nodeCount: number;
  /** Depth of the deepest shown node; top-level events sit at depth 1. */
  maxDepth: number;
  /** Mean depth across the shown nodes. */
  meanDepth: number;
  /** Call chains the log's size cap cut off before their exit events. */
  truncatedRegionCount: number;
  /** The first shown node at {@link maxDepth}, in time order. */
  deepest: { text: string; depth: number } | null;
  /** The point with the most shown children; a `null` text is the log root. */
  widest: { text: string | null; childCount: number } | null;
}

/**
 * One post-order walk of the call tree for its shape: structure, not time.
 * "Shown" follows the tab's default Show-Details filter — a node counts when
 * it is significant itself (`isParent`, non-zero total, a discontinuity, or a
 * type in {@link EXCLUDED_DETAIL_TYPES}) or any descendant is, the same
 * roll-up `_hasDetailsDeep` precomputes for the grid. Truncation flags every
 * unclosed frame in a cut-off chain, so only top-most flagged nodes count as
 * regions.
 */
export function computeExecutionShapeStats(roots: LogEvent[]): ExecutionShapeStats {
  let eventCount = 0;
  let nodeCount = 0;
  let depthSum = 0;
  let maxDepth = 0;
  let truncatedRegionCount = 0;
  let deepest: ExecutionShapeStats['deepest'] = null;
  let widestChildCount = 0;
  let widestText: string | null = null;

  function walk(event: LogEvent, depth: number, parentTruncated: boolean): boolean {
    eventCount++;
    if (event.isTruncated && !parentTruncated) {
      truncatedRegionCount++;
    }

    let shownChildCount = 0;
    for (const child of event.children) {
      if (walk(child, depth + 1, event.isTruncated)) {
        shownChildCount++;
      }
    }

    const shown =
      shownChildCount > 0 ||
      event.isParent ||
      event.duration.total > 0 ||
      event.discontinuity ||
      !!(event.type && EXCLUDED_DETAIL_TYPES.has(event.type));
    if (!shown) {
      return false;
    }

    nodeCount++;
    depthSum += depth;
    if (depth > maxDepth) {
      maxDepth = depth;
      deepest = { text: event.text, depth };
    }
    if (shownChildCount > widestChildCount) {
      widestChildCount = shownChildCount;
      widestText = event.text;
    }
    return true;
  }

  let shownRoots = 0;
  for (const root of roots) {
    if (walk(root, 1, false)) {
      shownRoots++;
    }
  }
  if (shownRoots > widestChildCount) {
    widestChildCount = shownRoots;
    widestText = null;
  }

  return {
    eventCount,
    nodeCount,
    maxDepth,
    meanDepth: nodeCount > 0 ? depthSum / nodeCount : 0,
    truncatedRegionCount,
    deepest,
    widest: widestChildCount > 0 ? { text: widestText, childCount: widestChildCount } : null,
  };
}
