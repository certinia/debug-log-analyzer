/**
 * @jest-environment jsdom
 */

/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * A pan or a zoom moves the frames under a still pointer, and neither reports a mouse move.
 * The chart asks the hit test again inside the render that moved them, before the phase that
 * draws the wash — asking afterwards cannot reach the screen, because the render loop clears
 * `needsRender` on the way out and books no further frame.
 */

import { describe, expect, it, jest } from '@jest/globals';
import { FlameChart } from '../FlameChart.js';

const HIT_NODE = { id: '0-0', timestamp: 0, duration: 10, depth: 0, original: { eventIndex: 1 } };

/** The private collaborators one `render()` needs to reach the wash, and nothing else. */
function stubbedChart(): { chart: FlameChart; hoverRender: jest.Mock; hitTest: jest.Mock } {
  const chart = new FlameChart();
  const hoverRender = jest.fn();
  const hitTest = jest.fn(() => ({ eventNode: HIT_NODE, marker: null }));

  const internals = chart as unknown as Record<string, unknown>;
  internals['app'] = {
    renderer: { resize: jest.fn() },
    screen: { height: 300 },
    render: jest.fn(),
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
    getState: () => ({ zoom: 1, offsetX: 0, offsetY: 0, displayWidth: 400, displayHeight: 300 }),
    screenYToDepth: () => 0,
  };
  internals['state'] = {
    viewport: null,
    needsRender: false,
    batchColorsCache: new Map(),
    renderDirty: {
      background: false,
      culling: true,
      eventRendering: false,
      highlights: false,
      overlays: false,
      minimap: false,
      metricStrip: false,
    },
  };

  return { chart, hoverRender, hitTest };
}

describe('the hover wash after the frames move', () => {
  it('washes the frame now under the pointer, in the render that moved it', () => {
    const { chart, hoverRender } = stubbedChart();
    const internals = chart as unknown as Record<string, unknown>;
    const tracker = internals['hoverTracker'] as {
      setPointer: (x: number, y: number) => void;
      invalidateHit: () => void;
    };
    tracker.setPointer(40, 10);
    tracker.invalidateHit();

    (internals['render'] as () => void).call(chart);

    // Not null: the re-hit ran early enough for this render's overlay phase to read it.
    expect(hoverRender).toHaveBeenCalledTimes(1);
    expect(hoverRender.mock.calls[0]?.[1]).toEqual({ node: HIT_NODE, depth: 0 });
  });

  // A drag moves the view or draws its own overlay. Washing a frame the pointer never chose,
  // and a tooltip churning through frames as they slide past, are both noise.
  it('washes nothing while a drag owns the pointer, and asks once it ends', () => {
    const { chart, hitTest, hoverRender } = stubbedChart();
    const internals = chart as unknown as Record<string, unknown>;
    let dragging = true;
    internals['interactionHandler'] = {
      isPointerDragging: () => dragging,
      updateCursor: jest.fn(),
    };
    const onMouseMove = jest.fn();
    internals['callbacks'] = { onMouseMove };
    const tracker = internals['hoverTracker'] as {
      setPointer: (x: number, y: number) => void;
      invalidateHit: () => void;
      setHovered: (frame: unknown) => boolean;
    };
    tracker.setHovered({ node: HIT_NODE, depth: 0 });
    tracker.setPointer(40, 10);
    tracker.invalidateHit();

    (internals['render'] as () => void).call(chart);

    expect(hitTest).not.toHaveBeenCalled();
    // Cleared, not frozen: a wash left behind would slide away with the frame under it.
    expect(hoverRender).toHaveBeenCalledWith(expect.anything(), null);
    // And the tooltip goes with it.
    expect(onMouseMove).toHaveBeenCalledWith(0, 0, null, null);

    // The hit stayed marked stale, so the first render after the drag picks it up.
    dragging = false;
    (internals['state'] as { renderDirty: Record<string, boolean> }).renderDirty['culling'] = true;
    (internals['render'] as () => void).call(chart);
    expect(hitTest).toHaveBeenCalled();
  });

  // Culling is what moves the frames, so a render that reuses it leaves the answer standing.
  it('does not ask again on a render that reuses the culled frames', () => {
    const { chart, hitTest } = stubbedChart();
    const internals = chart as unknown as Record<string, unknown>;
    (internals['hoverTracker'] as { setPointer: (x: number, y: number) => void }).setPointer(
      40,
      10,
    );
    const state = internals['state'] as { renderDirty: Record<string, boolean> };
    state.renderDirty['culling'] = false;
    state.renderDirty['overlays'] = true;
    internals['cachedVisibleRects'] = new Map();
    internals['cachedBuckets'] = new Map();

    (internals['render'] as () => void).call(chart);

    expect(hitTest).not.toHaveBeenCalled();
  });
});
