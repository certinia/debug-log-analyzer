/**
 * @jest-environment jsdom
 */

/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { makeViewport } from '#test-helpers/viewport.js';
import { FlameChart } from '../FlameChart.js';

const HIT_NODE = { id: '0-0', timestamp: 0, duration: 10, depth: 0, original: { eventIndex: 1 } };

/** The private collaborators `resize` and one `render()` need to reach the wash, and nothing else. */
function stubbedChart({ displayHeight = 300, culling = false } = {}): {
  chart: FlameChart;
  internals: Record<string, unknown>;
  rendererResize: jest.Mock;
  appRender: jest.Mock;
  hoverRender: jest.Mock;
  hitTest: jest.Mock;
} {
  const chart = new FlameChart();
  const rendererResize = jest.fn();
  const appRender = jest.fn();
  const hoverRender = jest.fn();
  const hitTest = jest.fn(() => ({ eventNode: HIT_NODE, marker: null }));

  const internals = chart as unknown as Record<string, unknown>;
  internals['app'] = {
    renderer: { resize: rendererResize, resolution: 1 },
    screen: { height: 300 },
    render: appRender,
  };
  internals['container'] = document.createElement('div');
  internals['index'] = { maxDepth: 1 };
  internals['worldContainer'] = { position: { set: jest.fn() } };
  internals['batchRenderer'] = { render: jest.fn(), clear: jest.fn() };
  internals['rectangleManager'] = {
    getCulledRectangles: () => ({ visibleRects: new Map(), buckets: new Map() }),
  };
  internals['hitDetector'] = { setVisibleRects: jest.fn(), setBuckets: jest.fn(), hitTest };
  internals['hoverHighlightRenderer'] = { render: hoverRender };
  internals['viewport'] = {
    getState: () => makeViewport({ displayWidth: 400, displayHeight }),
    setStateForResize: jest.fn(),
    screenYToDepth: () => 0,
  };
  // The geometry init applied: 364 container - 60 minimap - 4 gap = the 300 below.
  internals['appliedMinimapHeight'] = 60;
  internals['appliedOverheadHeight'] = 64;
  internals['state'] = {
    viewport: null,
    needsRender: false,
    batchColorsCache: new Map(),
    renderDirty: {
      background: false,
      culling,
      eventRendering: false,
      highlights: false,
      overlays: false,
      minimap: false,
      metricStrip: false,
    },
  };

  return { chart, internals, rendererResize, appRender, hoverRender, hitTest };
}

const render = (internals: Record<string, unknown>, chart: FlameChart): void =>
  (internals['render'] as () => void).call(chart);

type Tracker = {
  setPointer: (x: number, y: number) => void;
  invalidateHit: () => void;
  setHovered: (frame: unknown) => boolean;
};

/**
 * A pan or a zoom moves the frames under a still pointer, and neither reports a mouse move.
 * The chart asks the hit test again inside the render that moved them, before the phase that
 * draws the wash — asking afterwards cannot reach the screen, because the render loop clears
 * `needsRender` on the way out and books no further frame.
 */
describe('the hover wash after the frames move', () => {
  function pointerStale(internals: Record<string, unknown>): void {
    const tracker = internals['hoverTracker'] as Tracker;
    tracker.setPointer(40, 10);
    tracker.invalidateHit();
  }

  it('washes the frame now under the pointer, in the render that moved it', () => {
    const { chart, internals, hoverRender } = stubbedChart({ culling: true });
    pointerStale(internals);

    render(internals, chart);

    // Not null: the re-hit ran early enough for this render's overlay phase to read it.
    expect(hoverRender).toHaveBeenCalledTimes(1);
    expect(hoverRender.mock.calls[0]?.[1]).toEqual({ node: HIT_NODE, depth: 0 });
  });

  // The reader never moved the pointer, so what the re-hit found is reported as the frames'
  // doing. A panel put on a frame by find or by the keyboard reads that and stays put.
  it('reports a re-hit as the frames moving, not as a pointer move', () => {
    const { chart, internals } = stubbedChart({ culling: true });
    const onMouseMove = jest.fn();
    internals['callbacks'] = { onMouseMove };
    pointerStale(internals);

    render(internals, chart);

    expect(onMouseMove).toHaveBeenCalledWith(40, expect.any(Number), HIT_NODE, null, 'frames');
  });

  // A drag moves the view or draws its own overlay. Washing a frame the pointer never chose,
  // and a tooltip churning through frames as they slide past, are both noise.
  it('washes nothing while a drag owns the pointer, and asks once it ends', () => {
    const { chart, internals, hitTest, hoverRender } = stubbedChart({ culling: true });
    let dragging = true;
    internals['interactionHandler'] = {
      isPointerDragging: () => dragging,
      updateCursor: jest.fn(),
    };
    const onMouseMove = jest.fn();
    internals['callbacks'] = { onMouseMove };
    (internals['hoverTracker'] as Tracker).setHovered({ node: HIT_NODE, depth: 0 });
    pointerStale(internals);

    render(internals, chart);

    expect(hitTest).not.toHaveBeenCalled();
    // Cleared, not frozen: a wash left behind would slide away with the frame under it.
    expect(hoverRender).toHaveBeenCalledWith(expect.anything(), null);
    // And the tooltip goes with it.
    expect(onMouseMove).toHaveBeenCalledWith(0, 0, null, null, 'pointer');

    // The hit stayed marked stale, so the first render after the drag picks it up.
    dragging = false;
    (internals['state'] as { renderDirty: Record<string, boolean> }).renderDirty['culling'] = true;
    render(internals, chart);
    expect(hitTest).toHaveBeenCalled();
  });

  // Culling is what moves the frames, so a render that reuses it leaves the answer standing.
  it('does not ask again on a render that reuses the culled frames', () => {
    const { chart, internals, hitTest } = stubbedChart();
    (internals['hoverTracker'] as Tracker).setPointer(40, 10);
    (internals['state'] as { renderDirty: Record<string, boolean> }).renderDirty['overlays'] = true;
    internals['cachedVisibleRects'] = new Map();
    internals['cachedBuckets'] = new Map();

    render(internals, chart);

    expect(hitTest).not.toHaveBeenCalled();
  });
});

/**
 * A resize must repaint in the same frame it clears in. PIXI's `renderer.resize` assigns
 * `canvas.width`, which wipes the drawing buffer, so a repaint deferred to the next frame
 * leaves this one to composite a blank canvas.
 */
describe('FlameChart.resize', () => {
  const realDevicePixelRatio = window.devicePixelRatio;

  afterEach(() => {
    jest.restoreAllMocks();
    Object.defineProperty(window, 'devicePixelRatio', {
      value: realDevicePixelRatio,
      configurable: true,
    });
  });

  it('paints before it returns, so the cleared canvas is never composited', () => {
    const { chart, rendererResize, appRender } = stubbedChart();
    const raf = jest.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);

    chart.resize(500, 400);

    // Both inside the one call: the clear and the paint share a frame.
    expect(rendererResize).toHaveBeenCalled();
    expect(appRender).toHaveBeenCalled();
    // Nothing left for a later frame to do.
    expect(raf).not.toHaveBeenCalled();
  });

  // A resize that changes nothing has no canvas to wipe, so drawing now buys nothing and a
  // render already booked still stands. Loading a log arrives here with the geometry unchanged.
  it('does not draw when the geometry is unchanged', () => {
    const { chart, rendererResize, appRender } = stubbedChart();

    // 364 - 60 minimap - 4 gap = the 300 the viewport already reports, at the same width.
    chart.resize(400, 364);

    expect(rendererResize).not.toHaveBeenCalled();
    expect(appRender).not.toHaveBeenCalled();
  });

  it('still draws when the main timeline height changes at the same width', () => {
    const { chart, appRender } = stubbedChart();
    jest.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);

    chart.resize(400, 400);

    expect(appRender).toHaveBeenCalled();
  });

  // The minimap is a tenth of the container, clamped, so it can move a pixel while the main
  // timeline keeps the height it had. Skipping then leaves its canvas short of its box.
  it('draws when only the minimap height moved', () => {
    // 604 - 60 - 4 and 605 - 61 - 4 are both 540, so only the minimap changed.
    const { chart, appRender } = stubbedChart({ displayHeight: 540 });
    jest.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);

    expect(chart.resize(400, 605)).toBe(true);
    expect(appRender).toHaveBeenCalled();
  });

  // The metric strip appearing adds 15 + 4 to the overhead, so a container that grows by the
  // same 19px leaves the main timeline height alone. The minimap is clamped at 60 across both,
  // so every value the guard used to compare was unchanged while the overhead moved by 19.
  it('draws when the overhead moved but the main timeline height did not', () => {
    const { chart, internals, appRender } = stubbedChart();
    internals['metricStripOrchestrator'] = {
      getIsVisible: () => true,
      getHeight: () => 15,
      resize: jest.fn(),
      holdsHover: () => false,
      getCursorTimeNs: () => null,
      render: jest.fn(),
    };
    jest.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);

    // 383 - 60 - 4 - 15 - 4 = the 300 the viewport already reports, at the same width.
    expect(chart.resize(400, 383)).toBe(true);
    expect(appRender).toHaveBeenCalled();
    // Stale at 64, every hit test and tooltip would sit 19px out.
    expect(internals['mainTimelineYOffset']).toBe(83);
  });

  it('draws when only the device pixel ratio moved', () => {
    const { chart, rendererResize, appRender } = stubbedChart();
    jest.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
    Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true });

    // The geometry the skip case above rejects, so only the ratio is left to act on.
    expect(chart.resize(400, 364)).toBe(true);
    expect(rendererResize).toHaveBeenCalledWith(400, 300, 2);
    expect(appRender).toHaveBeenCalled();
  });

  // The metric strip resizes its own canvas before asking the host to relayout, so a resize
  // that cannot run has to say so — otherwise nothing draws the strip it just blanked.
  it('reports whether it applied, so a caller can draw instead', () => {
    const { chart } = stubbedChart();
    jest.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);

    // Smaller than the minimap and its gap, so no main timeline is left.
    expect(chart.resize(400, 40)).toBe(false);
    expect(chart.resize(400, 400)).toBe(true);
  });

  // The queued paint is dropped to draw in this frame. If the draw cannot happen, the paint
  // is still owed, or the chart stays blank with nothing left to fill it.
  it('books the dropped frame again when it cannot draw after all', () => {
    const { chart, internals, appRender } = stubbedChart();
    // No rectangleManager, so `canRender` fails and `render` bails.
    internals['rectangleManager'] = null;
    (internals['state'] as { needsRender: boolean }).needsRender = true;
    const raf = jest.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);

    chart.resize(500, 400);

    expect(appRender).not.toHaveBeenCalled();
    expect(raf).toHaveBeenCalled();
  });

  it('drops a render already queued, rather than painting twice', () => {
    const { chart, internals, appRender } = stubbedChart();
    const cancel = jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    internals['renderLoopId'] = 7;

    chart.resize(500, 400);

    expect(cancel).toHaveBeenCalledWith(7);
    expect(appRender).toHaveBeenCalledTimes(1);
    expect(internals['renderLoopId']).toBeNull();
  });
});
