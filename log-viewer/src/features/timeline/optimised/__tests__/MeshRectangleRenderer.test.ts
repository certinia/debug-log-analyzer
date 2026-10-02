/**
 * @jest-environment jsdom
 */

/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

import { describe, expect, it } from '@jest/globals';
import { Container, type Mesh } from 'pixi.js';

import { readQuads } from '#test-helpers/mesh.js';
import { timelineEvent } from '#test-helpers/timeline.js';
import { makeViewport } from '#test-helpers/viewport.js';
import type { RenderBatch, ViewportState } from '../../types/flamechart.types.js';
import type { BatchColorInfo } from '../BucketColorResolver.js';
import { MeshRectangleRenderer } from '../MeshRectangleRenderer.js';
import { RectangleCache, type PrecomputedRect } from '../RectangleCache.js';

type Category = RenderBatch['category'];

const APEX_COLOR = 0x2d7ff9;
const SOQL_COLOR = 0x4caf50;

const batchColors = new Map<string, BatchColorInfo>([
  ['Apex', { color: APEX_COLOR }],
  ['SOQL', { color: SOQL_COLOR }],
]);

interface DrawnRect {
  x: number;
  y: number;
  width: number;
  height: number;
  color: number;
}

function batches(...categories: Category[]): Map<string, RenderBatch> {
  // Only called with the categories `batchColors` holds.
  return new Map(
    categories.map((category) => [
      category,
      { category, color: batchColors.get(category)!.color, rectangles: [], isDirty: true },
    ]),
  );
}

function batchOf(renderBatches: Map<string, RenderBatch>, category: Category): RenderBatch {
  const batch = renderBatches.get(category);
  if (!batch) {
    throw new Error(`no ${category} batch`);
  }
  return batch;
}

function setup(renderBatches = batches('Apex', 'SOQL')) {
  const container = new Container();
  const renderer = new MeshRectangleRenderer(container, renderBatches);
  const mesh = container.children[0] as Mesh;
  return { renderer, mesh, renderBatches };
}

/** A rect placed by hand, as the cache would hand it over after culling. */
function rect(x: number, width: number, depth = 0): PrecomputedRect {
  return {
    id: `${x}-${depth}`,
    timeStart: x,
    timeEnd: x + width,
    depth,
    duration: width,
    selfDuration: width,
    category: 'Apex',
    eventRef: timelineEvent(x, width, 'Apex'),
    x,
    y: depth * 15,
    width,
    height: 15,
  };
}

const round = (value: number): number => Math.round(value * 1e4) / 1e4;

/** Read the rectangles back out of the mesh's vertex buffers, in world pixels. */
function drawnRects(mesh: Mesh, viewport: ViewportState): DrawnRect[] {
  const { displayWidth, displayHeight, offsetX, offsetY } = viewport;
  const toWorldX = (clipX: number): number => ((clipX + 1) / 2) * displayWidth + offsetX;
  const toWorldY = (clipY: number): number =>
    displayHeight - offsetY - ((1 - clipY) / 2) * displayHeight;

  return readQuads(mesh).map(({ left, right, top, bottom, color }) => ({
    x: round(toWorldX(left)),
    y: round(toWorldY(bottom)),
    width: round(toWorldX(right) - toWorldX(left)),
    height: round(toWorldY(top) - toWorldY(bottom)),
    color,
  }));
}

function visible(cache: RectangleCache, viewport: ViewportState): PrecomputedRect[] {
  const { visibleRects } = cache.getCulledRectangles(viewport, batchColors);
  return [...visibleRects.values()].flat();
}

describe('MeshRectangleRenderer', () => {
  describe('with rectangles culled by RectangleCache', () => {
    it('places each frame from zoom and depth and keeps its event', () => {
      const child = timelineEvent(150, 50, 'SOQL');
      const parent = timelineEvent(100, 200, 'Apex', [child]);
      const cache = new RectangleCache([parent], new Set(['Apex', 'SOQL']));
      const viewport = makeViewport({ zoom: 2 });

      const { visibleRects, buckets, stats } = cache.getCulledRectangles(viewport, batchColors);

      expect(stats.bucketCount).toBe(0);
      expect(visibleRects.get('Apex')).toEqual([
        expect.objectContaining({ x: 200, width: 400, y: 0, height: 15 }),
      ]);
      expect(visibleRects.get('Apex')?.[0]?.eventRef).toBe(parent);
      expect(visibleRects.get('SOQL')).toEqual([
        expect.objectContaining({ x: 300, width: 100, y: 15, height: 15 }),
      ]);
      expect(visibleRects.get('SOQL')?.[0]?.eventRef).toBe(child);

      const { renderer, mesh } = setup();
      renderer.render(visibleRects, buckets, viewport);

      // Each frame is inset by half the 1px gap on every side.
      expect(drawnRects(mesh, viewport)).toEqual([
        { x: 300.5, y: 15.5, width: 99, height: 14, color: SOQL_COLOR },
        { x: 200.5, y: 0.5, width: 399, height: 14, color: APEX_COLOR },
      ]);
      expect(mesh.visible).toBe(true);
    });

    it('drops a frame with no duration', () => {
      const instant = timelineEvent(500, 0, 'Apex');
      const timed = timelineEvent(100, 200, 'Apex');
      const cache = new RectangleCache([timed, instant], new Set(['Apex']));

      expect(cache.getRectMap().has(instant)).toBe(false);
      expect(visible(cache, makeViewport()).map((r) => r.eventRef)).toEqual([timed]);
    });

    it('drops a frame whose category the cache was not given', () => {
      const unknown = timelineEvent(500, 200, 'Mystery' as Category);
      const known = timelineEvent(100, 200, 'Apex');
      const cache = new RectangleCache([known, unknown], new Set(['Apex']));

      expect(cache.getRectMap().has(unknown)).toBe(false);
      expect(visible(cache, makeViewport()).map((r) => r.eventRef)).toEqual([known]);
    });

    describe('under vertical pan', () => {
      const depth3 = timelineEvent(0, 400, 'Apex');
      const depth2 = timelineEvent(0, 400, 'Apex', [depth3]);
      const depth1 = timelineEvent(0, 400, 'Apex', [depth2]);
      const depth0 = timelineEvent(0, 400, 'Apex', [depth1]);
      const cache = new RectangleCache([depth0], new Set(['Apex']));

      it('keeps every row in view with no pan', () => {
        expect(visible(cache, makeViewport()).map((r) => r.depth)).toEqual([0, 1, 2, 3]);
      });

      it('drops the rows panned out of view and draws the rest against the pan', () => {
        // Panned up two rows: depth 2 now sits on the bottom edge of the canvas.
        const viewport = makeViewport({ offsetY: -30 });
        const { visibleRects, buckets } = cache.getCulledRectangles(viewport, batchColors);

        expect(visibleRects.get('Apex')?.map((r) => r.eventRef)).toEqual([depth2, depth3]);

        const { renderer, mesh } = setup();
        renderer.render(visibleRects, buckets, viewport);

        expect(drawnRects(mesh, viewport)).toEqual([
          expect.objectContaining({ y: 30.5, height: 14 }),
          expect.objectContaining({ y: 45.5, height: 14 }),
        ]);
        const positions = mesh.geometry.getAttribute('aPosition').buffer.data as Float32Array;
        // The bottom edge of depth 2, half a gap above the bottom of the canvas.
        expect(positions[5]).toBeCloseTo(-1 + (0.5 / viewport.displayHeight) * 2);
      });
    });

    it('hides the mesh when nothing is in view', () => {
      const cache = new RectangleCache([timelineEvent(100, 200, 'Apex')], new Set(['Apex']));
      const viewport = makeViewport({ offsetX: 5000 });
      const { visibleRects, buckets } = cache.getCulledRectangles(viewport, batchColors);
      const { renderer, mesh } = setup();

      renderer.render(visibleRects, buckets, viewport);

      expect(drawnRects(mesh, viewport)).toHaveLength(0);
      expect(mesh.visible).toBe(false);
    });
  });

  describe('render', () => {
    const viewport = makeViewport();

    it('skips a category that has no batch', () => {
      const { renderer, mesh, renderBatches } = setup(batches('Apex'));

      renderer.render(
        new Map([
          ['SOQL', [rect(100, 50)]],
          ['Apex', [rect(300, 50)]],
        ]),
        new Map(),
        viewport,
      );

      expect(drawnRects(mesh, viewport)).toEqual([
        { x: 300.5, y: 0.5, width: 49, height: 14, color: APEX_COLOR },
      ]);
      expect([...renderBatches.keys()]).toEqual(['Apex']);
    });

    it('refills the batch of each rendered category and marks it clean', () => {
      const renderBatches = batches('Apex', 'SOQL');
      const stale = rect(900, 50);
      batchOf(renderBatches, 'Apex').rectangles.push(stale);
      batchOf(renderBatches, 'SOQL').rectangles.push(stale);
      batchOf(renderBatches, 'SOQL').isDirty = false;
      const { renderer } = setup(renderBatches);
      const first = rect(100, 50);
      const second = rect(300, 50);

      renderer.render(new Map([['Apex', [first, second]]]), new Map(), viewport);

      const apex = batchOf(renderBatches, 'Apex');
      expect(apex.rectangles).toHaveLength(2);
      expect(apex.rectangles[0]).toBe(first);
      expect(apex.rectangles[1]).toBe(second);
      expect(apex.isDirty).toBe(false);

      // A batch with nothing to render this frame is emptied and left dirty.
      const soql = batchOf(renderBatches, 'SOQL');
      expect(soql.rectangles).toEqual([]);
      expect(soql.isDirty).toBe(true);
    });

    it('does not draw a rect with no width left after the gap, but keeps it in the batch', () => {
      const { renderer, mesh, renderBatches } = setup();

      renderer.render(
        new Map([['Apex', [rect(100, 1), rect(200, 0.5), rect(300, 3)]]]),
        new Map(),
        viewport,
      );

      expect(drawnRects(mesh, viewport)).toEqual([
        { x: 300.5, y: 0.5, width: 2, height: 14, color: APEX_COLOR },
      ]);
      expect(batchOf(renderBatches, 'Apex').rectangles).toHaveLength(3);
    });
  });
});
