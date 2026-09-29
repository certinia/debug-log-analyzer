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
import { internalsOf, stubChartInternals } from '../../../../__tests__/helpers/flameChart.js';
import { makeViewport } from '../../../../__tests__/helpers/viewport.js';
import { FlameChart } from '../FlameChart.js';

const HIT_NODE = { id: '0-0', timestamp: 0, duration: 10, depth: 0, original: { eventIndex: 1 } };

/** The shared stub, plus the hit-test and wash handles this suite asserts on. */
function stubbedChart(): { chart: FlameChart; hoverRender: jest.Mock; hitTest: jest.Mock } {
  const chart = new FlameChart();
  const hoverRender = jest.fn();
  const hitTest = jest.fn(() => ({ eventNode: HIT_NODE, marker: null }));

  // Culling dirty: the re-hit this is about happens inside the cull the render then does.
  const internals = stubChartInternals(chart, { culling: true });
  internals['app'] = {
    renderer: { resize: jest.fn() },
    screen: { height: 300 },
    render: jest.fn(),
  };
  internals['hitDetector'] = { setVisibleRects: jest.fn(), setBuckets: jest.fn(), hitTest };
  internals['hoverHighlightRenderer'] = { render: hoverRender };
  internals['viewport'] = {
    getState: () => makeViewport({ displayWidth: 400, displayHeight: 300 }),
    screenYToDepth: () => 0,
  };

  return { chart, hoverRender, hitTest };
}

describe('the hover wash after the frames move', () => {
  it('washes the frame now under the pointer, in the render that moved it', () => {
    const { chart, hoverRender } = stubbedChart();
    const internals = internalsOf(chart);
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

  // The reader never moved the pointer, so what the re-hit found is reported as the frames'
  // doing. A panel put on a frame by find or by the keyboard reads that and stays put.
  it('reports a re-hit as the frames moving, not as a pointer move', () => {
    const { chart } = stubbedChart();
    const internals = internalsOf(chart);
    const onMouseMove = jest.fn();
    internals['callbacks'] = { onMouseMove };
    const tracker = internals['hoverTracker'] as {
      setPointer: (x: number, y: number) => void;
      invalidateHit: () => void;
    };
    tracker.setPointer(40, 10);
    tracker.invalidateHit();

    (internals['render'] as () => void).call(chart);

    expect(onMouseMove).toHaveBeenCalledWith(40, expect.any(Number), HIT_NODE, null, 'frames');
  });

  // A drag moves the view or draws its own overlay. Washing a frame the pointer never chose,
  // and a tooltip churning through frames as they slide past, are both noise.
  it('washes nothing while a drag owns the pointer, and asks once it ends', () => {
    const { chart, hitTest, hoverRender } = stubbedChart();
    const internals = internalsOf(chart);
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
    expect(onMouseMove).toHaveBeenCalledWith(0, 0, null, null, 'pointer');

    // The hit stayed marked stale, so the first render after the drag picks it up.
    dragging = false;
    (internals['state'] as { renderDirty: Record<string, boolean> }).renderDirty['culling'] = true;
    (internals['render'] as () => void).call(chart);
    expect(hitTest).toHaveBeenCalled();
  });

  // Culling is what moves the frames, so a render that reuses it leaves the answer standing.
  it('does not ask again on a render that reuses the culled frames', () => {
    const { chart, hitTest } = stubbedChart();
    const internals = internalsOf(chart);
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
