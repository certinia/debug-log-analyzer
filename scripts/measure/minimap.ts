/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * Times the minimap density query.
 *
 * The minimap holds one bucket per pixel of its width, so every step of a width
 * drag is a fresh bucket count and a guaranteed cache miss. The drag sweep is
 * the number a resize actually pays.
 */
import type { ApexLog } from 'apex-log-parser';

import { MinimapDensityQuery } from '../../log-viewer/src/features/timeline/optimised/minimap/MinimapDensityQuery.js';
import { RectangleCache } from '../../log-viewer/src/features/timeline/optimised/RectangleCache.js';
import { BUCKET_CONSTANTS } from '../../log-viewer/src/features/timeline/types/flamechart.types.js';
import { logEventToTreeAndRects } from '../../log-viewer/src/features/timeline/utils/tree-converter.js';
import { heapMb, line, ms, nowMs, time } from './harness.js';

/** The widths the digest samples: odd and even, and either side of a 1536px panel. */
const DIGEST_WIDTHS = [97, 800, 1000, 1536, 1601];

/** One drag across 200px of panel edge, every intermediate width a cache miss. */
const DRAG_FROM = 1200;
const DRAG_TO = 1400;

/** Outside the drag, so the cold query does not leave the first drag width cached. */
const COLD_WIDTH = 1000;

/**
 * Also outside the drag. `heapMb` collects, and the first query after a full
 * collection costs ~65ms against a steady ~4ms, so without this the drag's worst
 * step is always step 0 and reports the collection rather than the query.
 */
const WARM_WIDTH = 1100;

interface Subject {
  query: MinimapDensityQuery;
  frames: number;
  maxDepth: number;
}

/** One query per run: the one width it caches makes every other width a miss anyway. */
function build(log: ApexLog): Subject {
  const categories = new Set<string>(BUCKET_CONSTANTS.CATEGORY_PRIORITY);
  const precomputed = logEventToTreeAndRects(log.children, categories, log.exitStamp);
  const cache = new RectangleCache(log.children, categories, precomputed);

  return {
    query: new MinimapDensityQuery(
      [...cache.getRectsByCategory().values()],
      precomputed.totalDuration,
      precomputed.maxDepth,
    ),
    // One entry per rect the conversion made, so this is the sweep's own input.
    frames: precomputed.rectMap.size,
    maxDepth: precomputed.maxDepth,
  };
}

/** A CSV row per bucket, so two revisions can be diffed to show the picture held. */
export function digestMinimap(log: ApexLog): void {
  const { query } = build(log);
  console.log('width,bucket,eventCount,maxDepth,dominantCategory');
  for (const width of DIGEST_WIDTHS) {
    const { buckets } = query.query(width);
    for (let b = 0; b < buckets.length; b++) {
      const bucket = buckets[b]!;
      console.log(
        `${width},${b},${bucket.eventCount},${bucket.maxDepth},${bucket.dominantCategory}`,
      );
    }
  }
}

export async function measureMinimap(log: ApexLog): Promise<void> {
  // Timed: the rectangles and the tree are built during timeline init, so this and
  // the cold query below are one bill the user pays before the first frame appears.
  const { query, frames, maxDepth } = await time('build rects + tree', () => build(log));
  console.log(`${frames} frames, maxDepth ${maxDepth}`);

  // The first query builds the skyline, so its own line carries the build's cost.
  await time(`cold query(${COLD_WIDTH})`, () => query.query(COLD_WIDTH));
  const stats = query.stats();
  const perFrame = (stats.segmentCount / frames).toFixed(2);
  console.log(
    `  ${stats.segmentCount} segments (${perFrame}/frame), ${stats.violations} violations`,
  );

  query.query(WARM_WIDTH);
  const drag: number[] = [];
  for (let width = DRAG_FROM; width <= DRAG_TO; width++) {
    const start = nowMs();
    query.query(width);
    drag.push(nowMs() - start);
  }
  const total = drag.reduce((sum, each) => sum + each, 0);
  const sorted = [...drag].sort((a, b) => a - b);
  const median = sorted[sorted.length >> 1]!;
  const worst = sorted[sorted.length - 1]!;
  line(
    `drag ${DRAG_FROM}->${DRAG_TO}px`,
    `median ${ms(median)}ms  worst ${ms(worst)}ms  ${Math.round(total)}ms total`,
  );

  // The cache holds one width, and the drag left a different one, so warm it before
  // timing: otherwise the first call is a miss and its recompute averages into all 100.
  query.query(DRAG_TO);
  const hitStart = nowMs();
  for (let i = 0; i < 100; i++) {
    query.query(DRAG_TO);
  }
  line('cached, same width', `${ms((nowMs() - hitStart) / 100)}ms`);
  line('heap held', `${heapMb()}MB`);
}
