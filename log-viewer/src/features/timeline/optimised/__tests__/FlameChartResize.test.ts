/**
 * @jest-environment jsdom
 */

/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * A resize must repaint in the same frame it clears in. PIXI's `renderer.resize` assigns
 * `canvas.width`, which wipes the drawing buffer, so a repaint deferred to the next frame
 * leaves this one to composite a blank canvas.
 */

import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { FlameChart } from '../FlameChart.js';

/** The private collaborators `resize` and `render` need, and nothing else. */
function stubbedChart(displayHeight = 300): {
  chart: FlameChart;
  rendererResize: jest.Mock;
  appRender: jest.Mock;
} {
  const chart = new FlameChart();
  const rendererResize = jest.fn();
  const appRender = jest.fn();

  const internals = chart as unknown as Record<string, unknown>;
  internals['app'] = {
    renderer: { resize: rendererResize },
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
  internals['viewport'] = {
    getState: () => ({
      zoom: 1,
      offsetX: 0,
      offsetY: 0,
      displayWidth: 400,
      displayHeight,
    }),
    setStateForResize: jest.fn(),
  };
  // The geometry init applied: 364 container - 60 minimap - 4 gap = the 300 below.
  internals['appliedMinimapHeight'] = 60;
  internals['state'] = {
    viewport: null,
    needsRender: false,
    batchColorsCache: new Map(),
    renderDirty: {
      background: false,
      culling: false,
      eventRendering: false,
      highlights: false,
      overlays: false,
      minimap: false,
      metricStrip: false,
    },
  };

  return { chart, rendererResize, appRender };
}

describe('FlameChart.resize', () => {
  afterEach(() => {
    jest.restoreAllMocks();
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
    const { chart, appRender } = stubbedChart(540);
    jest.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);

    expect(chart.resize(400, 605)).toBe(true);
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
    const { chart, appRender } = stubbedChart();
    const internals = chart as unknown as Record<string, unknown>;
    // No rectangleManager, so `canRender` fails and `render` bails.
    internals['rectangleManager'] = null;
    (internals['state'] as { needsRender: boolean }).needsRender = true;
    const raf = jest.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);

    chart.resize(500, 400);

    expect(appRender).not.toHaveBeenCalled();
    expect(raf).toHaveBeenCalled();
  });

  it('drops a render already queued, rather than painting twice', () => {
    const { chart, appRender } = stubbedChart();
    const cancel = jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    (chart as unknown as Record<string, unknown>)['renderLoopId'] = 7;

    chart.resize(500, 400);

    expect(cancel).toHaveBeenCalledWith(7);
    expect(appRender).toHaveBeenCalledTimes(1);
    expect((chart as unknown as Record<string, number | null>)['renderLoopId']).toBeNull();
  });
});
