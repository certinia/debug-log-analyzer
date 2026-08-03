/**
 * @jest-environment jsdom
 */

/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

/**
 * Unit tests for TimelineInteractionHandler
 *
 * Covers the wheel/mouse event wiring implicated in the Windows "zoom not
 * working" report (#853) — the layer that translates native WheelEvent /
 * MouseEvent (deltaMode, shiftKey, altKey) into viewport calls:
 * - bare wheel → mouse-anchored zoom (in/out)
 * - deltaMode line/page normalization
 * - Shift+wheel / Alt+wheel → pan (never zoom)
 * - enableZoom:false → wheel no-op
 * - Alt/Shift+mousedown → area-zoom / measurement start, with Alt priority
 * - non-left button ignored; preventDefault on wheel
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { TimelineViewport } from '../../TimelineViewport.js';
import { wheelZoomFactor } from '../../ViewportUtils.js';
import {
  type InteractionCallbacks,
  TimelineInteractionHandler,
} from '../TimelineInteractionHandler.js';

describe('TimelineInteractionHandler', () => {
  const DISPLAY_WIDTH = 1000;
  const DISPLAY_HEIGHT = 600;
  const TOTAL_DURATION = 1_000_000;
  const MAX_DEPTH = 10;

  let canvas: HTMLCanvasElement;
  let viewport: TimelineViewport;
  let handler: TimelineInteractionHandler;

  function createHandler(
    options: ConstructorParameters<typeof TimelineInteractionHandler>[2] = {},
    callbacks: InteractionCallbacks = {},
  ): TimelineInteractionHandler {
    return new TimelineInteractionHandler(canvas, viewport, options, callbacks);
  }

  function dispatchWheel(init: WheelEventInit): WheelEvent {
    const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });
    canvas.dispatchEvent(event);
    return event;
  }

  function dispatchMouseDown(init: MouseEventInit): MouseEvent {
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true, ...init });
    canvas.dispatchEvent(event);
    return event;
  }

  beforeEach(() => {
    canvas = document.createElement('canvas');
    document.body.appendChild(canvas);
    viewport = new TimelineViewport(DISPLAY_WIDTH, DISPLAY_HEIGHT, TOTAL_DURATION, MAX_DEPTH);
  });

  afterEach(() => {
    handler.destroy();
    document.body.removeChild(canvas);
    jest.restoreAllMocks();
  });

  describe('wheel zoom', () => {
    it('zooms in on scroll up (negative deltaY), anchored at the cursor', () => {
      handler = createHandler();
      const setZoom = jest.spyOn(viewport, 'setZoom');
      const startZoom = viewport.getState().zoom;

      dispatchWheel({ deltaY: -10, clientX: 250 });

      expect(setZoom).toHaveBeenCalledTimes(1);
      const [requestedZoom, anchorX] = setZoom.mock.calls[0] as [number, number];
      expect(requestedZoom).toBeGreaterThan(startZoom);
      // canvas rect.left is 0 in jsdom, so anchor == clientX
      expect(anchorX).toBe(250);
    });

    it('zooms out on scroll down (positive deltaY)', () => {
      handler = createHandler();
      const setZoom = jest.spyOn(viewport, 'setZoom');
      const startZoom = viewport.getState().zoom;

      dispatchWheel({ deltaY: 10, clientX: 250 });

      expect(setZoom).toHaveBeenCalledTimes(1);
      const [requestedZoom] = setZoom.mock.calls[0] as [number, number];
      expect(requestedZoom).toBeLessThan(startZoom);
    });

    it('calls preventDefault so the webview does not scroll the page', () => {
      handler = createHandler();
      const event = dispatchWheel({ deltaY: -10, clientX: 250 });
      expect(event.defaultPrevented).toBe(true);
    });

    it('applies the shared wheelZoomFactor to the current zoom', () => {
      handler = createHandler();
      const setZoom = jest.spyOn(viewport, 'setZoom');
      const startZoom = viewport.getState().zoom;

      dispatchWheel({ deltaY: -10, deltaMode: 0, clientX: 100 });

      const [requestedZoom] = setZoom.mock.calls[0] as [number, number];
      expect(requestedZoom).toBeCloseTo(startZoom * wheelZoomFactor(-10, 0, 1), 10);
    });

    it('clamps a large delta so one event cannot produce a huge jump', () => {
      handler = createHandler();
      const setZoom = jest.spyOn(viewport, 'setZoom');
      const startZoom = viewport.getState().zoom;

      // Windows fast-scroll / momentum: an unclamped linear factor would go
      // negative here; clamped exponential stays bounded and positive.
      dispatchWheel({ deltaY: -10000, deltaMode: 0, clientX: 100 });

      const [requestedZoom] = setZoom.mock.calls[0] as [number, number];
      expect(requestedZoom).toBeCloseTo(startZoom * wheelZoomFactor(-10000, 0, 1), 10);
      expect(requestedZoom).toBeLessThan(startZoom * 1.2); // bounded, no runaway jump
    });

    it('does not zoom when enableZoom is false', () => {
      handler = createHandler({ enableZoom: false });
      const setZoom = jest.spyOn(viewport, 'setZoom');

      dispatchWheel({ deltaY: -10, clientX: 250 });

      expect(setZoom).not.toHaveBeenCalled();
    });
  });

  describe('wheel pan (never zoom)', () => {
    it('Shift+wheel pans vertically when deltaY dominates', () => {
      handler = createHandler();
      const panBy = jest.spyOn(viewport, 'panBy');
      const setZoom = jest.spyOn(viewport, 'setZoom');

      dispatchWheel({ deltaY: 40, deltaX: 0, shiftKey: true });

      expect(setZoom).not.toHaveBeenCalled();
      expect(panBy).toHaveBeenCalledWith(0, 40);
    });

    it('Shift+wheel pans horizontally when deltaX dominates', () => {
      handler = createHandler();
      const panBy = jest.spyOn(viewport, 'panBy');

      dispatchWheel({ deltaX: 40, deltaY: 5, shiftKey: true });

      expect(panBy).toHaveBeenCalledWith(40, 0);
    });

    it('Alt+wheel pans horizontally using -deltaY', () => {
      handler = createHandler();
      const panBy = jest.spyOn(viewport, 'panBy');
      const setZoom = jest.spyOn(viewport, 'setZoom');

      dispatchWheel({ deltaY: 40, altKey: true });

      expect(setZoom).not.toHaveBeenCalled();
      expect(panBy).toHaveBeenCalledWith(-40, 0);
    });
  });

  describe('mousedown modes', () => {
    it('Alt+mousedown starts area zoom at the cursor', () => {
      const onAreaZoomStart = jest.fn<(screenX: number) => void>();
      const onMeasureStart = jest.fn<(screenX: number) => void>();
      handler = createHandler({}, { onAreaZoomStart, onMeasureStart });

      dispatchMouseDown({ button: 0, altKey: true, clientX: 300 });

      expect(onAreaZoomStart).toHaveBeenCalledWith(300);
      expect(onMeasureStart).not.toHaveBeenCalled();
    });

    it('Shift+mousedown starts measurement at the cursor', () => {
      const onMeasureStart = jest.fn<(screenX: number) => void>();
      handler = createHandler({}, { onMeasureStart });

      dispatchMouseDown({ button: 0, shiftKey: true, clientX: 300 });

      expect(onMeasureStart).toHaveBeenCalledWith(300);
    });

    it('gives Alt priority over Shift when both are held', () => {
      const onAreaZoomStart = jest.fn<(screenX: number) => void>();
      const onMeasureStart = jest.fn<(screenX: number) => void>();
      handler = createHandler({}, { onAreaZoomStart, onMeasureStart });

      dispatchMouseDown({ button: 0, altKey: true, shiftKey: true, clientX: 300 });

      expect(onAreaZoomStart).toHaveBeenCalledTimes(1);
      expect(onMeasureStart).not.toHaveBeenCalled();
    });

    it('ignores non-left mouse buttons', () => {
      const onAreaZoomStart = jest.fn<(screenX: number) => void>();
      const onMeasureStart = jest.fn<(screenX: number) => void>();
      handler = createHandler({}, { onAreaZoomStart, onMeasureStart });

      dispatchMouseDown({ button: 2, altKey: true, clientX: 300 });

      expect(onAreaZoomStart).not.toHaveBeenCalled();
      expect(onMeasureStart).not.toHaveBeenCalled();
    });
  });
});
