/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * MeshSearchStyleRenderer
 *
 * Renders rectangles with search-aware styling using PixiJS Mesh (Chrome DevTools style).
 * Matched events retain original colors, non-matched events are desaturated to greyscale.
 *
 * Responsibilities:
 * - Render rectangles with search styling
 * - Desaturate non-matched events
 * - Maintain original colors for matched events
 *
 * Does NOT:
 * - Pre-compute rectangles (done by RectangleCache)
 * - Perform culling (done by RectangleCache)
 * - Draw highlight borders (done by SearchHighlightRenderer)
 * - Implement search logic
 */

import type { Container } from 'pixi.js';
import type { PixelBucket, RenderBatch, ViewportState } from '../../types/flamechart.types.js';
import { TIMELINE_CONSTANTS } from '../../types/flamechart.types.js';
import type { MatchedEventInfo } from '../../types/search.types.js';
import type { PrecomputedRect } from '../RectangleCache.js';
import { colorToGreyscale } from '../rendering/ColorUtils.js';
import { MeshRectangleWriter } from '../rendering/MeshRectangleWriter.js';
import { buildMatchIndex, resolveBucketSearchColor } from './SearchBucketMatcher.js';

export class MeshSearchStyleRenderer extends MeshRectangleWriter {
  constructor(container: Container, batches: Map<string, RenderBatch>) {
    super(container, batches, 'MeshSearchStyleRenderer');
    this.mesh.visible = false;
  }

  /**
   * Render culled rectangles and buckets with search styling.
   * Matched events: original colors
   * Non-matched events: desaturated greyscale
   * Buckets: search-aware styling based on matched events
   *
   * @param culledRects - Rectangles grouped by category (from RectangleCache)
   * @param matchedEventIds - Set of event IDs that match search (retain original colors)
   * @param buckets - Aggregated pixel buckets grouped by category
   * @param viewport - Current viewport state for coordinate transforms
   * @param matchedEventsInfo - Lightweight info about matched events for bucket highlighting
   */
  public render(
    culledRects: Map<string, PrecomputedRect[]>,
    matchedEventIds: ReadonlySet<string>,
    buckets: Map<string, PixelBucket[]> = new Map(),
    viewport?: ViewportState,
    matchedEventsInfo: ReadonlyArray<MatchedEventInfo> = [],
  ): void {
    const viewportTransform = this.beginFrame(culledRects, buckets, viewport);
    if (!viewportTransform) {
      return;
    }

    // Pre-calculate constants outside loops
    const gap = TIMELINE_CONSTANTS.RECT_GAP;
    const halfGap = gap / 2;

    let rectIndex = 0;

    // Write rectangles per category with search styling
    for (const [category, rectangles] of culledRects) {
      const batch = this.batches.get(category);
      if (!batch) {
        continue;
      }

      const originalColor = batch.color;
      const greyColor = colorToGreyscale(originalColor);

      for (const rect of rectangles) {
        const color = matchedEventIds.has(rect.id) ? originalColor : greyColor;

        const x = rect.x + halfGap;
        const y = rect.y + halfGap;
        const width = Math.max(0, rect.width - gap);
        const height = Math.max(0, rect.height - gap);

        if (width > 0 && height > 0) {
          this.geometry.writeRectangle(rectIndex, x, y, width, height, color, viewportTransform);
          rectIndex++;
        }
      }
    }

    // A bucket's colour comes from the matches inside it, by time range: `eventRefs` is
    // empty on a memory-optimised bucket.
    const matchIndex = buildMatchIndex(matchedEventsInfo);
    rectIndex = this.writeBuckets(buckets, rectIndex, viewportTransform, (bucket) =>
      resolveBucketSearchColor(bucket, matchIndex, this.batches),
    );

    this.endFrame(rectIndex);
  }
}
