/**
 * @vitest-environment jsdom
 */

/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

import {
  KEYBOARD_CONSTANTS,
  KeyboardHandler,
  type FrameNavDirection,
  type KeyboardCallbacks,
  type MarkerNavDirection,
} from '../optimised/interaction/KeyboardHandler.js';
import { TimelineViewport } from '../optimised/TimelineViewport.js';

const DISPLAY_WIDTH = 1000;
const DISPLAY_HEIGHT = 600;
const STEP_X = DISPLAY_WIDTH * KEYBOARD_CONSTANTS.panStepPercent;
const STEP_Y = DISPLAY_HEIGHT * KEYBOARD_CONSTANTS.panStepPercent;

/** The main timeline's commands; a key that fires one fires no other. */
const COMMANDS = [
  'onPan',
  'onZoom',
  'onResetZoom',
  'onEscape',
  'onJumpToCallTree',
  'onFocus',
  'onCopy',
] as const;
type Command = (typeof COMMANDS)[number];

const SHIFT = { shiftKey: true };
const CTRL = { ctrlKey: true };
const ALT = { altKey: true };
const META = { metaKey: true };

describe('KeyboardHandler', () => {
  let container: HTMLElement;
  let viewport: TimelineViewport;
  let handler: KeyboardHandler;
  let callbacks: Required<KeyboardCallbacks>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    viewport = new TimelineViewport(DISPLAY_WIDTH, DISPLAY_HEIGHT, 1_000_000, 10);

    callbacks = {
      onPan: vi.fn<(deltaX: number, deltaY: number) => void>(),
      onZoom: vi.fn<(direction: 'in' | 'out') => void>(),
      onResetZoom: vi.fn<() => void>(),
      onEscape: vi.fn<() => void>(),
      onMarkerNav: vi.fn<(direction: MarkerNavDirection) => boolean>(),
      onFrameNav: vi.fn<(direction: FrameNavDirection) => boolean>(),
      onJumpToCallTree: vi.fn<() => void>(),
      onFocus: vi.fn<() => void>(),
      onCopy: vi.fn<() => void>(),
      isInMinimapArea: vi.fn<() => boolean>().mockReturnValue(false),
      onMinimapPanViewport: vi.fn<(deltaTimeNs: number) => void>(),
      onMinimapPanDepth: vi.fn<(deltaY: number) => void>(),
      onMinimapZoom: vi.fn<(direction: 'in' | 'out') => void>(),
      onMinimapJumpStart: vi.fn<() => void>(),
      onMinimapJumpEnd: vi.fn<() => void>(),
      onMinimapResetZoom: vi.fn<() => void>(),
      isInMetricStripArea: vi.fn<() => boolean>().mockReturnValue(false),
      onMetricStripPanViewport: vi.fn<(deltaTimeNs: number) => void>(),
      onMetricStripPanDepth: vi.fn<(deltaY: number) => void>(),
      onMetricStripZoom: vi.fn<(direction: 'in' | 'out') => void>(),
      onMetricStripJumpStart: vi.fn<() => void>(),
      onMetricStripJumpEnd: vi.fn<() => void>(),
      onMetricStripResetZoom: vi.fn<() => void>(),
    };

    handler = new KeyboardHandler(container, viewport, callbacks);
    handler.attach();
  });

  afterEach(() => {
    handler.destroy();
    document.body.removeChild(container);
    vi.clearAllMocks();
  });

  function press(key: string, options: Partial<KeyboardEventInit> = {}): KeyboardEvent {
    const event = new KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
      ...options,
    });
    container.dispatchEvent(event);
    return event;
  }

  const mock = (name: keyof KeyboardCallbacks) => callbacks[name] as Mock;

  function expectOnly(command: Command | null): void {
    for (const other of COMMANDS) {
      if (other !== command) {
        expect(mock(other)).not.toHaveBeenCalled();
      }
    }
  }

  it.each<[string, Partial<KeyboardEventInit>, Command, unknown[]]>([
    ['ArrowLeft', {}, 'onPan', [-STEP_X, 0]],
    ['ArrowRight', {}, 'onPan', [STEP_X, 0]],
    ['ArrowUp', {}, 'onPan', [0, -STEP_Y]],
    ['ArrowDown', {}, 'onPan', [0, STEP_Y]],
    ['a', {}, 'onPan', [-STEP_X, 0]],
    ['d', {}, 'onPan', [STEP_X, 0]],
    ['ArrowLeft', SHIFT, 'onPan', [-STEP_X, 0]],
    // Shift turns W/S into a vertical pan, as Shift turns the wheel.
    ['w', SHIFT, 'onPan', [0, -STEP_Y]],
    ['s', SHIFT, 'onPan', [0, STEP_Y]],
    ['w', {}, 'onZoom', ['in']],
    ['+', {}, 'onZoom', ['in']],
    ['=', {}, 'onZoom', ['in']],
    ['s', {}, 'onZoom', ['out']],
    ['-', {}, 'onZoom', ['out']],
    ['+', SHIFT, 'onZoom', ['in']],
    ['-', SHIFT, 'onZoom', ['out']],
    ['Home', {}, 'onResetZoom', []],
    ['0', {}, 'onResetZoom', []],
    ['Home', SHIFT, 'onResetZoom', []],
    ['Escape', {}, 'onEscape', []],
    ['j', {}, 'onJumpToCallTree', []],
    ['J', {}, 'onJumpToCallTree', []],
    ['Enter', {}, 'onFocus', []],
    ['z', {}, 'onFocus', []],
    ['Z', {}, 'onFocus', []],
    ['c', CTRL, 'onCopy', []],
    ['c', META, 'onCopy', []],
    ['C', CTRL, 'onCopy', []],
  ])('%s %o calls %s once, and claims the key', (key, options, command, args) => {
    const event = press(key, options);

    expect(mock(command)).toHaveBeenCalledTimes(1);
    expect(mock(command)).toHaveBeenCalledWith(...args);
    expectOnly(command);
    expect(event.defaultPrevented).toBe(true);
  });

  // A browser or VS Code shortcut must reach its owner.
  it.each<[string, Partial<KeyboardEventInit>]>([
    ['0', CTRL],
    ['Home', ALT],
    ['0', META],
    ['j', CTRL],
    ['j', ALT],
    ['j', META],
    ['Enter', CTRL],
    ['z', CTRL],
    ['Enter', ALT],
    ['z', ALT],
    ['Enter', META],
    ['z', META],
    ['c', {}],
    ['c', { ctrlKey: true, altKey: true }],
    ['x', {}],
    ['Tab', {}],
  ])('%s %o calls nothing, and leaves the key to the browser', (key, options) => {
    const event = press(key, options);

    expectOnly(null);
    expect(event.defaultPrevented).toBe(false);
  });

  // The command is already done, so a held key would only re-run it.
  it.each<[Command, string, Partial<KeyboardEventInit>, string[]]>([
    ['onResetZoom', 'Home', {}, ['Home', '0']],
    ['onJumpToCallTree', 'j', {}, ['j', 'j']],
    ['onFocus', 'Enter', {}, ['Enter', 'z']],
    ['onCopy', 'c', CTRL, ['c']],
  ])(
    '%s fires once on a held key, and still claims each repeat',
    (command, key, options, repeats) => {
      press(key, options);
      const events = repeats.map((repeat) => press(repeat, { ...options, repeat: true }));

      expect(mock(command)).toHaveBeenCalledTimes(1);
      expect(events.map((event) => event.defaultPrevented)).toEqual(repeats.map(() => true));
    },
  );

  it('pans and zooms on every repeat, so holding a key scrubs', () => {
    press('ArrowLeft', { repeat: true });
    press('a', { repeat: true });
    press('w', { repeat: true });
    press('s', { repeat: true });

    expect(callbacks.onPan).toHaveBeenCalledTimes(2);
    expect(callbacks.onZoom).toHaveBeenCalledTimes(2);
  });

  it.each<
    [
      string,
      string,
      Partial<KeyboardEventInit>,
      boolean,
      boolean,
      MarkerNavDirection | null,
      FrameNavDirection | null,
      boolean,
    ]
  >([
    ['marker nav takes left', 'ArrowLeft', {}, true, true, 'left', null, false],
    ['marker nav takes right', 'ArrowRight', {}, true, true, 'right', null, false],
    ['frame nav takes up, which has no marker', 'ArrowUp', {}, true, true, null, 'up', false],
    ['frame nav takes down, which has no marker', 'ArrowDown', {}, true, true, null, 'down', false],
    [
      'frame nav takes a left marker nav declines',
      'ArrowLeft',
      {},
      false,
      true,
      'left',
      'left',
      false,
    ],
    [
      'frame nav takes a right marker nav declines',
      'ArrowRight',
      {},
      false,
      true,
      'right',
      'right',
      false,
    ],
    ['pan takes a key both decline', 'ArrowLeft', {}, false, false, 'left', 'left', true],
    ['pan takes Shift+arrow', 'ArrowLeft', SHIFT, true, true, null, null, true],
    ['pan takes A', 'a', {}, true, true, null, null, true],
    ['pan takes D', 'd', {}, true, true, null, null, true],
  ])('%s', (_name, key, options, markerTakes, frameTakes, marker, frame, pans) => {
    mock('onMarkerNav').mockReturnValue(markerTakes);
    mock('onFrameNav').mockReturnValue(frameTakes);

    press(key, options);

    expect(mock('onMarkerNav').mock.calls).toEqual(marker ? [[marker]] : []);
    expect(mock('onFrameNav').mock.calls).toEqual(frame ? [[frame]] : []);
    expect(mock('onPan')).toHaveBeenCalledTimes(pans ? 1 : 0);
  });

  describe('attach/detach', () => {
    it('stops listening on detach, however often it is called', () => {
      handler.detach();
      handler.detach();
      press('w');

      expect(callbacks.onZoom).not.toHaveBeenCalled();
    });

    it('listens again after a re-attach', () => {
      handler.detach();
      handler.attach();
      press('w');

      expect(callbacks.onZoom).toHaveBeenCalledTimes(1);
    });

    it('does not attach twice', () => {
      handler.attach();
      press('w');

      expect(callbacks.onZoom).toHaveBeenCalledTimes(1);
    });

    it('stops listening on destroy', () => {
      handler.destroy();
      press('w');

      expect(callbacks.onZoom).not.toHaveBeenCalled();
    });
  });

  describe.each([
    {
      area: 'minimap',
      moves: 'the lens',
      inArea: 'isInMinimapArea',
      jumpStart: 'onMinimapJumpStart',
      jumpEnd: 'onMinimapJumpEnd',
      resetZoom: 'onMinimapResetZoom',
      pan: 'onMinimapPanViewport',
      zoom: 'onMinimapZoom',
    },
    {
      area: 'metric strip',
      moves: 'the strip',
      inArea: 'isInMetricStripArea',
      jumpStart: 'onMetricStripJumpStart',
      jumpEnd: 'onMetricStripJumpEnd',
      resetZoom: 'onMetricStripResetZoom',
      pan: 'onMetricStripPanViewport',
      zoom: 'onMetricStripZoom',
    },
  ] as const)('$area commands (pointer over the $area)', (keys) => {
    beforeEach(() => {
      mock(keys.inArea).mockReturnValue(true);
    });

    it('calls each command once on a held key', () => {
      press('Home');
      press('Home', { repeat: true });
      press('End');
      press('End', { repeat: true });
      // 0 and Escape are the same command, so a repeat of either is suppressed.
      press('0');
      press('Escape', { repeat: true });

      expect(callbacks[keys.jumpStart]).toHaveBeenCalledTimes(1);
      expect(callbacks[keys.jumpEnd]).toHaveBeenCalledTimes(1);
      expect(callbacks[keys.resetZoom]).toHaveBeenCalledTimes(1);
    });

    // End is this area's alone: the main timeline ignores it, so a repeat that
    // reported nothing prevented would mean the area handler never saw it.
    it('still prevents default on a repeated command', () => {
      expect(press('End', { repeat: true }).defaultPrevented).toBe(true);
    });

    it(`pans and zooms ${keys.moves} on every repeat`, () => {
      press('ArrowLeft', { repeat: true });
      press('ArrowRight', { repeat: true });
      press('w', { repeat: true });

      expect(callbacks[keys.pan]).toHaveBeenCalledTimes(2);
      expect(callbacks[keys.zoom]).toHaveBeenCalledTimes(1);
    });
  });

  it('works without callbacks', () => {
    handler.destroy();
    const bare = new KeyboardHandler(container, viewport);
    bare.attach();

    expect(() =>
      ['w', 'a', 'ArrowLeft', 'Home', 'Escape', 'j'].forEach((key) => press(key)),
    ).not.toThrow();

    bare.destroy();
  });
});
