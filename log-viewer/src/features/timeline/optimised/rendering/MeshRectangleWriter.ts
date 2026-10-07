/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * MeshRectangleWriter
 *
 * The mesh lifecycle and buffer handling shared by the timeline's rectangle renderers:
 * one mesh, one draw call, clip-space coordinates.
 *
 * A subclass owns only its per-rectangle write loop, which is what the two renderers
 * actually differ in. That loop is the hottest path in the chart, so it is written out
 * in each subclass rather than driven by a callback.
 */

import type { Container, Geometry, Mesh, Shader } from 'pixi.js';
import type { PixelBucket, RenderBatch, ViewportState } from '../../types/flamechart.types.js';
import { BUCKET_CONSTANTS, TIMELINE_CONSTANTS } from '../../types/flamechart.types.js';
import type { PrecomputedRect } from '../RectangleCache.js';
import type { RectangleGeometry, ViewportTransform } from '../RectangleGeometry.js';
import { createRectangleMesh } from './rectangleMesh.js';

export abstract class MeshRectangleWriter {
  protected batches: Map<string, RenderBatch>;
  protected geometry: RectangleGeometry;
  protected mesh: Mesh<Geometry, Shader>;
  private lastViewport: ViewportState | null = null;

  protected constructor(container: Container, batches: Map<string, RenderBatch>, label: string) {
    this.batches = batches;

    const { geometry, mesh } = createRectangleMesh(container, label);
    this.geometry = geometry;
    this.mesh = mesh;
  }

  /** Deliberately empty: the clip-space shader bypasses every container transform. */
  public setStageContainer(_stage: Container): void {}

  public clear(): void {
    this.geometry.setDrawCount(0);
    this.mesh.visible = false;
  }

  public destroy(): void {
    this.geometry.destroy();
    this.mesh.destroy();
  }

  /**
   * Size the buffers for this frame and answer the transform to write against, or null
   * where there is nothing to draw and the mesh has been hidden.
   *
   * A frame with no viewport of its own reuses the last one it was given.
   */
  protected beginFrame(
    culledRects: Map<string, PrecomputedRect[]>,
    buckets: Map<string, PixelBucket[]>,
    viewport: ViewportState | undefined,
  ): ViewportTransform | null {
    const vp = viewport || this.lastViewport;
    if (!vp) {
      return null;
    }
    this.lastViewport = vp;

    let totalRects = 0;
    for (const rectangles of culledRects.values()) {
      totalRects += rectangles.length;
    }
    for (const categoryBuckets of buckets.values()) {
      totalRects += categoryBuckets.length;
    }

    if (totalRects === 0) {
      this.clear();
      return null;
    }

    this.geometry.ensureCapacity(totalRects);

    // No canvasYOffset needed - main timeline has its own canvas
    return {
      offsetX: vp.offsetX,
      offsetY: vp.offsetY,
      displayWidth: vp.displayWidth,
      displayHeight: vp.displayHeight,
      canvasYOffset: 0,
    };
  }

  protected endFrame(rectIndex: number): void {
    this.geometry.setDrawCount(rectIndex);
    this.mesh.visible = true;
  }

  /**
   * Write every bucket, taking each one's colour from `colorOf`.
   *
   * A bucket is one block per pixel column, so this loop is bounded by the display
   * width and carries the callback that the per-rectangle loop must not.
   */
  protected writeBuckets(
    buckets: Map<string, PixelBucket[]>,
    startIndex: number,
    viewportTransform: ViewportTransform,
    colorOf: (bucket: PixelBucket) => number,
  ): number {
    const gap = TIMELINE_CONSTANTS.RECT_GAP;
    const halfGap = gap / 2;
    const blockWidth = BUCKET_CONSTANTS.BUCKET_BLOCK_WIDTH;
    const eventHeight = TIMELINE_CONSTANTS.EVENT_HEIGHT;
    const gappedHeight = Math.max(0, eventHeight - gap);

    let rectIndex = startIndex;

    for (const categoryBuckets of buckets.values()) {
      for (const bucket of categoryBuckets) {
        this.geometry.writeRectangle(
          rectIndex,
          bucket.x + halfGap,
          bucket.y + halfGap,
          blockWidth,
          gappedHeight,
          colorOf(bucket),
          viewportTransform,
        );
        rectIndex++;
      }
    }

    return rectIndex;
  }
}
