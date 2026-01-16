/**
 * @jest-environment jsdom
 */

/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

/**
 * Unit tests for KeyboardHandler
 *
 * Tests keyboard input handling for flame chart viewport controls:
 * - Pan via Arrow keys and A/D keys
 * - Zoom via W/S and +/-/= keys
 * - Reset zoom via Home / 0 keys
 * - Escape key for cancel/deselect
 * - Shift hold detection for hints overlay
 */

import {
  KEYBOARD_CONSTANTS,
  KeyboardHandler,
  type KeyboardCallbacks,
} from '../optimised/interaction/KeyboardHandler.js';
import { TimelineViewport } from '../optimised/TimelineViewport.js';

describe('KeyboardHandler', () => {
  const DISPLAY_WIDTH = 1000;
  const DISPLAY_HEIGHT = 600;
  const TOTAL_DURATION = 1_000_000;
  const MAX_DEPTH = 10;

  let container: HTMLElement;
  let viewport: TimelineViewport;
  let handler: KeyboardHandler;
  let callbacks: Required<KeyboardCallbacks>;

  beforeEach(() => {
    // Create a mock container element
    container = document.createElement('div');
    document.body.appendChild(container);

    // Create viewport
    viewport = new TimelineViewport(DISPLAY_WIDTH, DISPLAY_HEIGHT, TOTAL_DURATION, MAX_DEPTH);

    // Create mock callbacks
    callbacks = {
      onPan: jest.fn(),
      onZoom: jest.fn(),
      onResetZoom: jest.fn(),
      onEscape: jest.fn(),
      onShiftHeld: jest.fn(),
    };

    handler = new KeyboardHandler(container, viewport, callbacks);
    handler.attach();
  });

  afterEach(() => {
    handler.destroy();
    document.body.removeChild(container);
    jest.clearAllMocks();
  });

  /**
   * Helper to dispatch a keyboard event
   */
  function dispatchKeyEvent(
    type: 'keydown' | 'keyup',
    key: string,
    options: Partial<KeyboardEventInit> = {},
  ): KeyboardEvent {
    const event = new KeyboardEvent(type, {
      key,
      bubbles: true,
      cancelable: true,
      ...options,
    });
    container.dispatchEvent(event);
    return event;
  }

  describe('pan keys (Arrow keys and A/D)', () => {
    it('should pan left on ArrowLeft', () => {
      dispatchKeyEvent('keydown', 'ArrowLeft');

      expect(callbacks.onPan).toHaveBeenCalledTimes(1);
      const [deltaX, deltaY] = (callbacks.onPan as jest.Mock).mock.calls[0];
      expect(deltaX).toBeLessThan(0); // Pan left = negative deltaX
      expect(deltaY).toBe(0);
    });

    it('should pan right on ArrowRight', () => {
      dispatchKeyEvent('keydown', 'ArrowRight');

      expect(callbacks.onPan).toHaveBeenCalledTimes(1);
      const [deltaX, deltaY] = (callbacks.onPan as jest.Mock).mock.calls[0];
      expect(deltaX).toBeGreaterThan(0); // Pan right = positive deltaX
      expect(deltaY).toBe(0);
    });

    it('should pan up on ArrowUp', () => {
      dispatchKeyEvent('keydown', 'ArrowUp');

      expect(callbacks.onPan).toHaveBeenCalledTimes(1);
      const [deltaX, deltaY] = (callbacks.onPan as jest.Mock).mock.calls[0];
      expect(deltaX).toBe(0);
      expect(deltaY).toBeLessThan(0); // Pan up = negative deltaY
    });

    it('should pan down on ArrowDown', () => {
      dispatchKeyEvent('keydown', 'ArrowDown');

      expect(callbacks.onPan).toHaveBeenCalledTimes(1);
      const [deltaX, deltaY] = (callbacks.onPan as jest.Mock).mock.calls[0];
      expect(deltaX).toBe(0);
      expect(deltaY).toBeGreaterThan(0); // Pan down = positive deltaY
    });

    it('should pan left on A key', () => {
      dispatchKeyEvent('keydown', 'a');

      expect(callbacks.onPan).toHaveBeenCalledTimes(1);
      const [deltaX, deltaY] = (callbacks.onPan as jest.Mock).mock.calls[0];
      expect(deltaX).toBeLessThan(0);
      expect(deltaY).toBe(0);
    });

    it('should pan right on D key', () => {
      dispatchKeyEvent('keydown', 'd');

      expect(callbacks.onPan).toHaveBeenCalledTimes(1);
      const [deltaX, deltaY] = (callbacks.onPan as jest.Mock).mock.calls[0];
      expect(deltaX).toBeGreaterThan(0);
      expect(deltaY).toBe(0);
    });

    it('should pan with Shift + Arrow keys (always pan even when frame selected)', () => {
      dispatchKeyEvent('keydown', 'ArrowLeft', { shiftKey: true });

      expect(callbacks.onPan).toHaveBeenCalledTimes(1);
      const [deltaX] = (callbacks.onPan as jest.Mock).mock.calls[0];
      expect(deltaX).toBeLessThan(0);
    });

    it('should pan by correct percentage of viewport', () => {
      dispatchKeyEvent('keydown', 'ArrowRight');

      const expectedStepX = DISPLAY_WIDTH * KEYBOARD_CONSTANTS.panStepPercent;
      const [deltaX] = (callbacks.onPan as jest.Mock).mock.calls[0];
      expect(deltaX).toBeCloseTo(expectedStepX, 5);
    });

    it('should prevent default on handled pan keys', () => {
      const event = dispatchKeyEvent('keydown', 'ArrowLeft');

      expect(event.defaultPrevented).toBe(true);
    });
  });

  describe('zoom keys (W / S / + / - / =)', () => {
    it('should zoom in on W key', () => {
      dispatchKeyEvent('keydown', 'w');

      expect(callbacks.onZoom).toHaveBeenCalledWith('in');
    });

    it('should zoom out on S key', () => {
      dispatchKeyEvent('keydown', 's');

      expect(callbacks.onZoom).toHaveBeenCalledWith('out');
    });

    it('should zoom in on + key', () => {
      dispatchKeyEvent('keydown', '+');

      expect(callbacks.onZoom).toHaveBeenCalledWith('in');
    });

    it('should zoom in on = key', () => {
      dispatchKeyEvent('keydown', '=');

      expect(callbacks.onZoom).toHaveBeenCalledWith('in');
    });

    it('should zoom out on - key', () => {
      dispatchKeyEvent('keydown', '-');

      expect(callbacks.onZoom).toHaveBeenCalledWith('out');
    });

    it('should zoom even when Shift is pressed', () => {
      dispatchKeyEvent('keydown', 'w', { shiftKey: true });
      dispatchKeyEvent('keydown', '+', { shiftKey: true });
      dispatchKeyEvent('keydown', '-', { shiftKey: true });

      expect(callbacks.onZoom).toHaveBeenCalledTimes(3);
    });

    it('should prevent default on handled zoom keys', () => {
      const event = dispatchKeyEvent('keydown', 'w');

      expect(event.defaultPrevented).toBe(true);
    });
  });

  describe('reset keys (Home / 0)', () => {
    it('should reset zoom on Home key', () => {
      dispatchKeyEvent('keydown', 'Home');

      expect(callbacks.onResetZoom).toHaveBeenCalled();
    });

    it('should reset zoom on 0 key', () => {
      dispatchKeyEvent('keydown', '0');

      expect(callbacks.onResetZoom).toHaveBeenCalled();
    });

    it('should reset when Shift is pressed (Shift does not block)', () => {
      dispatchKeyEvent('keydown', 'Home', { shiftKey: true });

      expect(callbacks.onResetZoom).toHaveBeenCalled();
    });

    it('should not reset when Ctrl/Alt/Meta is pressed', () => {
      dispatchKeyEvent('keydown', '0', { ctrlKey: true });
      dispatchKeyEvent('keydown', 'Home', { altKey: true });
      dispatchKeyEvent('keydown', '0', { metaKey: true });

      expect(callbacks.onResetZoom).not.toHaveBeenCalled();
    });

    it('should prevent default on handled reset keys', () => {
      const event = dispatchKeyEvent('keydown', 'Home');

      expect(event.defaultPrevented).toBe(true);
    });
  });

  describe('escape key', () => {
    it('should call onEscape callback on Escape key', () => {
      dispatchKeyEvent('keydown', 'Escape');

      expect(callbacks.onEscape).toHaveBeenCalled();
    });

    it('should prevent default on Escape', () => {
      const event = dispatchKeyEvent('keydown', 'Escape');

      expect(event.defaultPrevented).toBe(true);
    });
  });

  describe('shift hold detection', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should call onShiftHeld(true) after holding Shift for delay period', () => {
      dispatchKeyEvent('keydown', 'Shift');

      expect(callbacks.onShiftHeld).not.toHaveBeenCalled();

      jest.advanceTimersByTime(KEYBOARD_CONSTANTS.shiftHintDelay);

      expect(callbacks.onShiftHeld).toHaveBeenCalledWith(true);
    });

    it('should call onShiftHeld(false) when Shift is released', () => {
      dispatchKeyEvent('keydown', 'Shift');
      jest.advanceTimersByTime(KEYBOARD_CONSTANTS.shiftHintDelay);

      dispatchKeyEvent('keyup', 'Shift');

      expect(callbacks.onShiftHeld).toHaveBeenLastCalledWith(false);
    });

    it('should not call onShiftHeld(true) if Shift is released before delay', () => {
      dispatchKeyEvent('keydown', 'Shift');
      jest.advanceTimersByTime(KEYBOARD_CONSTANTS.shiftHintDelay - 100);
      dispatchKeyEvent('keyup', 'Shift');

      jest.advanceTimersByTime(200); // Past the original delay time

      // Should have been called once with false (on release), but not with true
      expect(callbacks.onShiftHeld).toHaveBeenCalledTimes(1);
      expect(callbacks.onShiftHeld).toHaveBeenCalledWith(false);
    });
  });

  describe('attach/detach', () => {
    it('should handle events when attached', () => {
      dispatchKeyEvent('keydown', 'w');

      expect(callbacks.onZoom).toHaveBeenCalled();
    });

    it('should not handle events after detach', () => {
      handler.detach();
      dispatchKeyEvent('keydown', 'w');

      expect(callbacks.onZoom).not.toHaveBeenCalled();
    });

    it('should handle events after re-attach', () => {
      handler.detach();
      handler.attach();
      dispatchKeyEvent('keydown', 'w');

      expect(callbacks.onZoom).toHaveBeenCalled();
    });

    it('should not attach twice', () => {
      handler.attach(); // Already attached in beforeEach
      dispatchKeyEvent('keydown', 'w');

      // Should still only fire once
      expect(callbacks.onZoom).toHaveBeenCalledTimes(1);
    });

    it('should handle multiple detach calls gracefully', () => {
      handler.detach();
      handler.detach();

      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe('destroy', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should detach event listeners on destroy', () => {
      handler.destroy();
      dispatchKeyEvent('keydown', 'w');

      expect(callbacks.onZoom).not.toHaveBeenCalled();
    });

    it('should clear shift hint timeout on destroy', () => {
      dispatchKeyEvent('keydown', 'Shift');
      handler.destroy();
      jest.advanceTimersByTime(KEYBOARD_CONSTANTS.shiftHintDelay + 100);

      // Should not have been called
      expect(callbacks.onShiftHeld).not.toHaveBeenCalled();
    });
  });

  describe('unhandled keys', () => {
    it('should not prevent default on unhandled keys', () => {
      const event = dispatchKeyEvent('keydown', 'x');

      expect(event.defaultPrevented).toBe(false);
    });

    it('should not call callbacks on unhandled keys', () => {
      dispatchKeyEvent('keydown', 'x');
      dispatchKeyEvent('keydown', 'Enter');
      dispatchKeyEvent('keydown', 'Tab');

      expect(callbacks.onPan).not.toHaveBeenCalled();
      expect(callbacks.onZoom).not.toHaveBeenCalled();
      expect(callbacks.onResetZoom).not.toHaveBeenCalled();
      expect(callbacks.onEscape).not.toHaveBeenCalled();
    });
  });

  describe('optional callbacks', () => {
    it('should work without callbacks', () => {
      const handlerWithoutCallbacks = new KeyboardHandler(container, viewport);
      handlerWithoutCallbacks.attach();

      // Should not throw
      dispatchKeyEvent('keydown', 'w');
      dispatchKeyEvent('keydown', 'a');
      dispatchKeyEvent('keydown', 'Home');
      dispatchKeyEvent('keydown', 'Escape');

      handlerWithoutCallbacks.destroy();
    });
  });
});
