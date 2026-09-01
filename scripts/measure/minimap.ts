/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * Times the minimap density query.
 *
 * The minimap holds one bucket per pixel of its width, so every step of a width
 * drag is a fresh bucket count and a guaranteed cache miss. The drag sweep is
 * the number a resize actually pays.
 *
 * `--digest` prints a CSV row per bucket instead of timings, so two revisions
 * can be diffed to show the picture did not change.
 */
import type { ApexLog } from 'apex-log-parser';

import { MinimapDensityQuery } from '../../log-viewer/src/features/timeline/optimised/minimap/MinimapDensityQuery.js';
import { MinimapSkylineIndex } from '../../log-viewer/src/features/timeline/optimised/minimap/MinimapSkylineIndex.js';
import { RectangleCache } from '../../log-viewer/src/features/timeline/optimised/RectangleCache.js';
import { BUCKET_CONSTANTS } from '../../log-viewer/src/features/timeline/types/flamechart.types.js';
import { logEventToTreeAndRects } from '../../log-viewer/src/features/timeline/utils/tree-converter.js';
import { heapMb, nowMs, time } from './harness.js';

/** The widths the digest samples: odd and even, and either side of a 1536px panel. */
const DIGEST_WIDTHS = [97, 800, 1000, 1536, 1601];

/** One drag across 200px of panel edge, every intermediate width a cache miss. */
const DRAG_FROM = 1200;
const DRAG_TO = 1400;

/** Outside the drag, so the cold query does not leave the first drag width cached. */
const COLD_WIDTH = 1000;

const ms = (value: number): string => value.toFixed(2).padStart(7);

export async function measureMinimap(log: ApexLog, digest: boolean): Promise<void> {
  const categories = new Set<string>(BUCKET_CONSTANTS.CATEGORY_PRIORITY);
  const precomputed = logEventToTreeAndRects(log.children, categories, log.exitStamp);
  const cache = new RectangleCache(log.children, categories, precomputed);

  const build = (): MinimapDensityQuery =>
    new MinimapDensityQuery(
      cache.getSegmentTree(),
      precomputed.totalDuration,
      precomputed.maxDepth,
    );

  if (digest) {
    console.log('width,bucket,eventCount,maxDepth,dominantCategory');
    for (const width of DIGEST_WIDTHS) {
      const { buckets } = build().query(width);
      for (let b = 0; b < buckets.length; b++) {
        const bucket = buckets[b]!;
        console.log(
          `${width},${b},${bucket.eventCount},${bucket.maxDepth},${bucket.dominantCategory}`,
        );
      }
    }
    return;
  }

  let frames = 0;
  for (const rects of cache.getRectsByCategory().values()) {
    frames += rects.length;
  }
  console.log(`${frames} frames, maxDepth ${precomputed.maxDepth}`);

  // The width-independent half: built once per log, so a resize walks it instead
  // of rebuilding. Violations say how well-nested the log really is.
  const skyline = await time('skyline index', () => {
    const tree = cache.getSegmentTree();
    return new MinimapSkylineIndex(
      tree.getAllFramesSorted(),
      precomputed.totalDuration,
      precomputed.maxDepth,
    );
  });
  const bytes = skyline.segmentCount * 11 + frames * 16;
  console.log(
    `  ${skyline.segmentCount} segments (${(skyline.segmentCount / frames).toFixed(2)}/frame), ` +
      `${Math.round(bytes / 1048576)}MB, ${skyline.violations} violations`,
  );

  // Apart from the drag: the first query also pays the segment tree's deferred
  // frame sort, and a resize never repeats it.
  const query = build();
  await time(`cold query(${COLD_WIDTH})`, () => query.query(COLD_WIDTH));

  const drag: number[] = [];
  for (let width = DRAG_FROM; width <= DRAG_TO; width++) {
    const start = nowMs();
    query.query(width);
    drag.push(nowMs() - start);
  }
  const total = drag.reduce((sum, each) => sum + each, 0);
  const sorted = [...drag].sort((a, b) => a - b);
  const median = sorted[sorted.length >> 1]!;
  console.log(
    `drag ${DRAG_FROM}->${DRAG_TO}px                median ${ms(median)}ms  worst ${ms(sorted[sorted.length - 1]!)}ms  ${Math.round(total)}ms total`,
  );

  // The cache holds one width, and the drag left a different one, so warm it before
  // timing: otherwise the first call is a miss and its recompute averages into all 100.
  query.query(DRAG_TO);
  const hitStart = nowMs();
  for (let i = 0; i < 100; i++) {
    query.query(DRAG_TO);
  }
  console.log(`cached, same width               ${ms((nowMs() - hitStart) / 100)}ms`);
  console.log(`heap held                        ${heapMb()}MB`);
}
