/**
 * @vitest-environment jsdom
 */

/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

import { describe, expect, it } from 'vitest';
import { Container, type Mesh } from 'pixi.js';

import { readQuads } from '#test-helpers/mesh.js';
import type { MarkerType, TimelineMarker, ViewportState } from '../../types/flamechart.types.js';
import { MARKER_ALPHA_BY_TYPE, MARKER_COLORS } from '../../types/flamechart.types.js';
import { MeshMarkerRenderer } from '../markers/MeshMarkerRenderer.js';
import { TimelineViewport } from '../TimelineViewport.js';

// Powers of two keep zoom, offsets and bounds exact, so edge-touching cases are not
// decided by float rounding. At the default fit zoom, 1px is 64ns.
const WIDTH = 1024;
const HEIGHT = 600;
const TOTAL_NS = 65536;
const NS_PER_PX = TOTAL_NS / WIDTH;

const px = (pixels: number): number => pixels * NS_PER_PX;

interface DrawnRect {
  x: number;
  width: number;
  top: number;
  bottom: number;
  color: number;
  alpha: number;
}

function marker(id: string, type: MarkerType, startTime: number, endTime?: number): TimelineMarker {
  return { id, type, summary: id, startTime, endTime };
}

function setup(
  markers: TimelineMarker[],
  viewport = new TimelineViewport(WIDTH, HEIGHT, TOTAL_NS, 10),
) {
  const container = new Container();
  const renderer = new MeshMarkerRenderer(container, viewport, markers);
  const mesh = container.children[0] as Mesh;
  return { renderer, mesh, viewport };
}

/** Read the rectangles back out of the mesh's vertex buffers, in world pixels. */
function drawnRects(mesh: Mesh, state: Readonly<ViewportState>): DrawnRect[] {
  const toWorldX = (clipX: number): number =>
    ((clipX + 1) / 2) * state.displayWidth + state.offsetX;
  const toScreenY = (clipY: number): number => ((1 - clipY) / 2) * state.displayHeight;

  return readQuads(mesh).map(({ left, right, top, bottom, color, alpha }) => ({
    x: toWorldX(left),
    width: toWorldX(right) - toWorldX(left),
    top: toScreenY(top),
    bottom: toScreenY(bottom),
    color,
    alpha,
  }));
}

describe('MeshMarkerRenderer', () => {
  it('draws nothing and hides the mesh when there are no markers', () => {
    const { renderer, mesh, viewport } = setup([]);

    renderer.render();

    expect(drawnRects(mesh, viewport.getState())).toHaveLength(0);
    expect(mesh.visible).toBe(false);
    expect(renderer.hitTest(0, 0)).toBeNull();
  });

  it('draws a band over the full canvas height and shows the mesh', () => {
    const { renderer, mesh, viewport } = setup([marker('skip', 'skip', px(100), px(400))]);

    renderer.render();

    const [rect] = drawnRects(mesh, viewport.getState());
    expect(mesh.visible).toBe(true);
    expect(rect?.top).toBeCloseTo(0);
    expect(rect?.bottom).toBeCloseTo(HEIGHT);
  });

  describe('viewport culling', () => {
    // Zoomed to 1px = 32ns and panned 512px right: the view spans 16384ns to 49152ns.
    function pannedViewport(): TimelineViewport {
      const viewport = new TimelineViewport(WIDTH, HEIGHT, TOTAL_NS, 10);
      viewport.setZoom(1 / 32, 0);
      viewport.setPan(512, 0);
      return viewport;
    }

    const before = marker('before', 'skip', 3200, 16000);
    const touchesStart = marker('touchesStart', 'skip', 6400, 16384);
    const inside = marker('inside', 'skip', 38400, 41600);
    const touchesEnd = marker('touchesEnd', 'exception', 49152);
    const after = marker('after', 'exception', 49184);

    it('draws markers that overlap or touch the view and skips the rest', () => {
      const viewport = pannedViewport();
      expect(viewport.getBounds()).toMatchObject({ timeStart: 16384, timeEnd: 49152 });
      const { renderer, mesh } = setup([after, inside, before, touchesEnd, touchesStart], viewport);

      renderer.render();

      expect(drawnRects(mesh, viewport.getState())).toEqual([
        expect.objectContaining({ x: 200, width: 312 }),
        expect.objectContaining({ x: 1200, width: 100 }),
        expect.objectContaining({ x: 1536, width: 2 }),
      ]);
    });

    it('hit tests only the markers it drew, in screen pixels', () => {
      const viewport = pannedViewport();
      const { renderer } = setup([after, inside, before, touchesEnd, touchesStart], viewport);

      renderer.render();

      // Screen x is world x less the 512px pan.
      expect(renderer.hitTest(1200 - 512 + 50, 0)).toBe(inside);
      expect(renderer.hitTest(1536 - 512 + 1, 0)).toBe(touchesEnd);
      expect(renderer.hitTest(0, 0)).toBe(touchesStart);
      expect(renderer.hitTest(1540 - 512, 0)).toBeNull();
    });

    it('hides the mesh when every marker is outside the view', () => {
      const viewport = pannedViewport();
      const { renderer, mesh } = setup([before, after], viewport);

      renderer.render();

      expect(drawnRects(mesh, viewport.getState())).toHaveLength(0);
      expect(mesh.visible).toBe(false);
      expect(renderer.hitTest(0, 0)).toBeNull();
    });
  });

  it.each<MarkerType>(['exception', 'error', 'skip', 'unexpected'])(
    'colours a %s marker from MARKER_COLORS and MARKER_ALPHA_BY_TYPE',
    (type) => {
      const { renderer, mesh, viewport } = setup([marker(type, type, px(100), px(200))]);

      renderer.render();

      expect(drawnRects(mesh, viewport.getState())).toEqual([
        expect.objectContaining({
          color: MARKER_COLORS[type],
          alpha: Math.round(MARKER_ALPHA_BY_TYPE[type] * 255),
        }),
      ]);
    },
  );

  describe('extent', () => {
    it('draws a bounded marker across its exact range', () => {
      const { renderer, mesh, viewport } = setup([marker('band', 'skip', px(100), px(400))]);

      renderer.render();

      expect(drawnRects(mesh, viewport.getState())).toEqual([
        expect.objectContaining({ x: 100, width: 300 }),
      ]);
    });

    // Regression: an unbounded marker used to shade up to the next marker's start.
    it('draws a marker with no endTime as a 2px point, not out to the next marker', () => {
      const point = marker('point', 'error', px(300));
      const next = marker('next', 'error', px(700), px(800));
      const { renderer, mesh, viewport } = setup([point, next]);

      renderer.render();

      expect(drawnRects(mesh, viewport.getState())).toEqual([
        expect.objectContaining({ x: 300, width: 2 }),
        expect.objectContaining({ x: 700, width: 100 }),
      ]);
      expect(renderer.hitTest(301, 0)).toBe(point);
      expect(renderer.hitTest(500, 0)).toBeNull();
    });

    it('widens a bounded marker narrower than 2px to 2px', () => {
      const { renderer, mesh, viewport } = setup([marker('thin', 'skip', px(100), px(100.25))]);

      renderer.render();

      expect(drawnRects(mesh, viewport.getState())).toEqual([
        expect.objectContaining({ x: 100, width: 2 }),
      ]);
    });
  });

  describe('layout', () => {
    it('shifts an abutting band right to leave a 1px gap', () => {
      const { renderer, mesh, viewport } = setup([
        marker('first', 'skip', px(100), px(200)),
        marker('second', 'skip', px(200), px(300)),
      ]);

      renderer.render();

      expect(drawnRects(mesh, viewport.getState())).toEqual([
        expect.objectContaining({ x: 100, width: 100 }),
        expect.objectContaining({ x: 201, width: 100 }),
      ]);
    });

    it('collapses a point within 4px of the last drawn rect, and keeps it for hit testing', () => {
      const first = marker('first', 'exception', px(500));
      const merged = marker('merged', 'exception', px(505));
      const separate = marker('separate', 'exception', px(506));
      const { renderer, mesh, viewport } = setup([first, merged, separate]);

      renderer.render();

      expect(drawnRects(mesh, viewport.getState())).toEqual([
        expect.objectContaining({ x: 500, width: 2 }),
        expect.objectContaining({ x: 506, width: 2 }),
      ]);
      expect(renderer.hitTest(505, 0)).toBe(merged);
    });
  });

  it('sorts markers by start time before laying them out', () => {
    const { renderer, mesh, viewport } = setup([
      marker('later', 'skip', px(300), px(400)),
      marker('earlier', 'skip', px(100), px(350)),
    ]);

    renderer.render();

    expect(drawnRects(mesh, viewport.getState())).toEqual([
      expect.objectContaining({ x: 100, width: 250 }),
      expect.objectContaining({ x: 351, width: 100 }),
    ]);
  });

  describe('updateMarkers', () => {
    it('clears the hit-testable markers until the next render', () => {
      const old = marker('old', 'skip', px(100), px(200));
      const { renderer } = setup([old]);
      renderer.render();
      expect(renderer.hitTest(150, 0)).toBe(old);

      renderer.updateMarkers([marker('new', 'skip', px(600), px(700))]);

      expect(renderer.hitTest(150, 0)).toBeNull();
      expect(renderer.hitTest(650, 0)).toBeNull();
    });

    it('sorts the new markers by time, then the more severe first', () => {
      const skip = marker('skip', 'skip', px(600), px(700));
      const error = marker('error', 'error', px(600), px(700));
      const { renderer, mesh, viewport } = setup([marker('old', 'skip', px(100), px(200))]);

      renderer.updateMarkers([skip, error]);
      renderer.render();

      expect(drawnRects(mesh, viewport.getState())).toEqual([
        expect.objectContaining({ x: 600, width: 100, color: MARKER_COLORS.error }),
        expect.objectContaining({ x: 701, width: 100, color: MARKER_COLORS.skip }),
      ]);
      expect(renderer.hitTest(650, 0)).toBe(error);
    });

    it('hides the mesh after the markers are replaced with none', () => {
      const { renderer, mesh } = setup([marker('old', 'skip', px(100), px(200))]);
      renderer.render();

      renderer.updateMarkers([]);
      renderer.render();

      expect(mesh.visible).toBe(false);
    });
  });
});
