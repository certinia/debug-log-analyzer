/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * Times what the timeline builds before its first frame, one search and one redraw's cull.
 *
 * The PixiJS setup needs WebGL, so it is not here.
 */
import type { ApexLog } from '@apexdevtools/apex-log-parser';

import { apexLimitTimeSeries } from '../../log-viewer/src/features/timeline/optimised/apex-limit-series.js';
import type { BatchColorInfo } from '../../log-viewer/src/features/timeline/optimised/BucketColorResolver.js';
import { RectangleCache } from '../../log-viewer/src/features/timeline/optimised/RectangleCache.js';
import { EventMatcher } from '../../log-viewer/src/features/timeline/optimised/search/EventMatcher.js';
import { TreeNavigator } from '../../log-viewer/src/features/timeline/optimised/selection/TreeNavigator.js';
import {
  BUCKET_CONSTANTS,
  type EventNode,
  TIMELINE_CONSTANTS,
  type ViewportState,
} from '../../log-viewer/src/features/timeline/types/flamechart.types.js';
import { categorySelfTimes } from '../../log-viewer/src/features/timeline/utils/category-self-time.js';
import { logEventToTreeAndRects } from '../../log-viewer/src/features/timeline/utils/tree-converter.js';
import { heapMb, line, nowMs, time } from './harness.js';

/** A word nearly every log holds many times, so the search walks and matches a lot. */
const SEARCH_TEXT = 'method';

/** Fixed per category, so a digest's bucket colours compare across revisions. */
const COLORS = new Map<string, BatchColorInfo>(
  BUCKET_CONSTANTS.CATEGORY_PRIORITY.map((category, i) => [category, { color: i + 1 }]),
);

/** Whole log, then a 10% and a 0.1% window: a wide view buckets, a narrow one draws rects. */
const WHOLE_LOG = { from: 0, share: 1 };
const WINDOWS = [WHOLE_LOG, { from: 0.5, share: 0.1 }, { from: 0.3, share: 0.001 }];

const DISPLAY_WIDTH = 1600;

/** Everything the timeline builds before its first frame, in the order its init builds it. */
function build(log: ApexLog) {
  categorySelfTimes(log);
  const categories = new Set<string>(BUCKET_CONSTANTS.CATEGORY_PRIORITY);
  const precomputed = logEventToTreeAndRects(log.children, categories, log.exitStamp);
  const cache = new RectangleCache(log.children, categories, precomputed);
  new TreeNavigator(precomputed.treeNodes, precomputed.maps);
  const matcher = new EventMatcher<EventNode>(precomputed.treeNodes, cache.getRectMapById());
  apexLimitTimeSeries(log);
  return { precomputed, cache, matcher };
}

function viewportFor(
  totalDuration: number,
  maxDepth: number,
  window: (typeof WINDOWS)[number],
): ViewportState {
  const zoom = DISPLAY_WIDTH / (totalDuration * window.share);
  return {
    zoom,
    offsetX: totalDuration * window.from * zoom,
    offsetY: 0,
    displayWidth: DISPLAY_WIDTH,
    displayHeight: (maxDepth + 2) * TIMELINE_CONSTANTS.EVENT_HEIGHT,
  };
}

/** A CSV of what the timeline holds and draws, so two revisions can be diffed. */
export function digestTimeline(log: ApexLog): void {
  const { precomputed, cache } = build(log);
  const { maxDepth, totalDuration, rectsByDepth } = precomputed;

  console.log('section,key,a,b,c,d');
  console.log(`total,,${maxDepth},${totalDuration},,`);
  const depths = [...rectsByDepth.keys()].sort((a, b) => a - b);
  for (const depth of depths) {
    const rects = rectsByDepth.get(depth)!;
    let start = 0;
    let self = 0;
    for (const rect of rects) {
      start += rect.timeStart;
      self += rect.selfDuration;
    }
    console.log(`depth,${depth},${rects.length},${start},${self},`);
  }

  for (const window of WINDOWS) {
    const culled = cache.getCulledRectangles(viewportFor(totalDuration, maxDepth, window), COLORS);
    const key = `${window.from}+${window.share}`;
    for (const category of BUCKET_CONSTANTS.CATEGORY_PRIORITY) {
      const rects = culled.visibleRects.get(category) ?? [];
      const buckets = culled.buckets.get(category) ?? [];
      let events = 0;
      let colors = 0;
      for (const bucket of buckets) {
        events += bucket.eventCount;
        colors += bucket.color;
      }
      console.log(`cull,${key}:${category},${rects.length},${buckets.length},${events},${colors}`);
    }
  }
}

export async function measureTimeline(log: ApexLog): Promise<void> {
  const before = heapMb();
  const { precomputed, cache, matcher } = await time('build to first frame', () => build(log));
  line('frames', `${precomputed.rectMap.size}, maxDepth ${precomputed.maxDepth}`);

  const search = await time(`search "${SEARCH_TEXT}"`, () =>
    matcher.search(
      (event) =>
        event.text.toLowerCase().includes(SEARCH_TEXT) ||
        event.type.toLowerCase().includes(SEARCH_TEXT),
    ),
  );
  line('matches', String(search.total));

  // The whole log in view is the worst cull: every depth, most of it bucketed.
  const viewport = viewportFor(precomputed.totalDuration, precomputed.maxDepth, WHOLE_LOG);
  cache.getCulledRectangles(viewport, COLORS);
  const runs = 20;
  const start = nowMs();
  for (let i = 0; i < runs; i++) {
    cache.getCulledRectangles(viewport, COLORS);
  }
  line('redraw, whole log in view', `${((nowMs() - start) / runs).toFixed(2)}ms`);
  line('heap held', `${heapMb() - before}MB`);
}
