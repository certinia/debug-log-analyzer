/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import type { ReactiveController, ReactiveControllerHost } from 'lit';

import type { HoverTooltip } from '../../../components/HoverTooltip.js';
import { TooltipController } from '../TooltipController.js';

function setUp(): ReactiveController {
  let controller: ReactiveController | undefined;
  const host = {
    addController: (added: ReactiveController) => (controller = added),
  } as unknown as ReactiveControllerHost;
  new TooltipController(host);
  if (!controller) {
    throw new Error('no controller');
  }
  controller.hostConnected?.();
  return controller;
}

function make(html: string): HTMLElement {
  const holder = document.createElement('div');
  holder.innerHTML = html;
  const el = holder.firstElementChild as HTMLElement;
  document.body.append(el);
  return el;
}

const tip = (): HoverTooltip | null => document.querySelector('hover-tooltip');
const shown = (): string | null => (tip()?.open ? (tip()?.textContent ?? '') : null);

const move = (el: Element) =>
  el.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, composed: true }));
const key = (k: string) => {
  const event = new KeyboardEvent('keydown', { key: k, cancelable: true, bubbles: true });
  document.dispatchEvent(event);
  return event;
};
// MutationObserver callbacks run as microtasks.
const flush = () => Promise.resolve();

describe('TooltipController', () => {
  let controller: ReactiveController;
  let away: HTMLElement;

  beforeEach(() => {
    jest.useFakeTimers();
    // jsdom has no popover API.
    HTMLElement.prototype.showPopover = () => {};
    HTMLElement.prototype.hidePopover = () => {};
    controller = setUp();
    away = make('<div></div>');
  });

  afterEach(() => {
    controller.hostDisconnected?.();
    document.body.innerHTML = '';
    jest.useRealTimers();
  });

  it('shows the title once the pointer rests on the element', () => {
    const button = make('<button title="Reset levels"></button>');

    move(button);
    jest.advanceTimersByTime(499);
    expect(shown()).toBeNull();
    jest.advanceTimersByTime(1);

    expect(shown()).toBe('Reset levels');
  });

  it('keeps the native tooltip away while it shows', () => {
    const button = make('<button title="Reset levels"></button>');

    move(button);

    expect(button.getAttribute('title')).toBe('');
  });

  it.each([
    ['an icon names itself by the title', '<button title="T"></button>', 'aria-label', 'T'],
    [
      'text keeps its name and is described by the title',
      '<span title="T">a</span>',
      'aria-description',
      'T',
    ],
    [
      'an aria-label is kept',
      '<button title="T" aria-label="Copy rows"></button>',
      'aria-label',
      'Copy rows',
    ],
    [
      'an aria-labelledby is kept',
      '<button title="T" aria-labelledby="x"></button>',
      'aria-label',
      null,
    ],
  ])('while it shows, %s', (_, html, attribute, value) => {
    const el = make(html);

    move(el);

    expect(el.getAttribute(attribute)).toBe(value);
  });

  it('gives the title back once the pointer has left', () => {
    const button = make('<button title="Reset levels"></button>');
    move(button);
    jest.advanceTimersByTime(500);

    move(away);
    jest.advanceTimersByTime(99);
    expect(shown()).toBe('Reset levels');
    jest.advanceTimersByTime(1);

    expect(shown()).toBeNull();
    expect(button.getAttribute('title')).toBe('Reset levels');
    expect(button.hasAttribute('aria-label')).toBe(false);
  });

  it('ends once the pointer has left, however much it keeps moving', () => {
    const button = make('<button title="Reset levels"></button>');
    move(button);
    jest.advanceTimersByTime(500);

    move(away);
    for (let i = 0; i < 5; i++) {
      jest.advanceTimersByTime(20);
      move(away);
    }

    expect(shown()).toBeNull();
    expect(button.getAttribute('title')).toBe('Reset levels');
  });

  it('stays when the pointer comes back before the leave delay ends', () => {
    const button = make('<button title="Reset levels"></button>');
    move(button);
    jest.advanceTimersByTime(500);

    move(away);
    jest.advanceTimersByTime(50);
    move(button);
    jest.advanceTimersByTime(1000);

    expect(shown()).toBe('Reset levels');
  });

  it('never shows a pending tooltip once the pointer has left', () => {
    const button = make('<button title="Reset levels"></button>');
    move(button);
    jest.advanceTimersByTime(450);

    move(away);
    jest.advanceTimersByTime(60);

    expect(shown()).toBeNull();
    expect(button.getAttribute('title')).toBe('Reset levels');
  });

  it('stays while the pointer moves over the element children or onto the tooltip', () => {
    const button = make('<button title="Reset levels"><span>↺</span></button>');
    move(button);
    jest.advanceTimersByTime(500);

    move(button.querySelector('span') as Element);
    move(away);
    move(tip() as Element);
    jest.advanceTimersByTime(1000);

    expect(shown()).toBe('Reset levels');
  });

  it('shows the next tooltip at once while the pointer scans a toolbar', () => {
    const first = make('<button title="Columns"></button>');
    const second = make('<button title="Export to CSV"></button>');
    move(first);
    jest.advanceTimersByTime(500);

    move(second);
    jest.advanceTimersByTime(0);

    expect(shown()).toBe('Export to CSV');
    expect(first.getAttribute('title')).toBe('Columns');
  });

  it('waits again once the last tooltip hid more than a moment ago', () => {
    const first = make('<button title="Columns"></button>');
    const second = make('<button title="Export to CSV"></button>');
    move(first);
    jest.advanceTimersByTime(500);
    move(away);
    jest.advanceTimersByTime(100);

    jest.advanceTimersByTime(300);
    move(second);
    jest.advanceTimersByTime(499);
    expect(shown()).toBeNull();
    jest.advanceTimersByTime(1);

    expect(shown()).toBe('Export to CSV');
  });

  it('waits for a tooltip after one that never showed', () => {
    const first = make('<button title="Columns"></button>');
    const second = make('<button title="Export to CSV"></button>');
    move(first);
    jest.advanceTimersByTime(200);

    move(second);
    jest.advanceTimersByTime(499);
    expect(shown()).toBeNull();
    jest.advanceTimersByTime(1);

    expect(shown()).toBe('Export to CSV');
  });

  it('shows the innermost title and keeps every title on the path away', () => {
    const outer = make('<div title="Outer"><span title="Inner">a</span><i>b</i></div>');
    const inner = outer.querySelector('span') as Element;
    move(inner);
    jest.advanceTimersByTime(500);
    expect(shown()).toBe('Inner');
    expect([outer.getAttribute('title'), inner.getAttribute('title')]).toEqual(['', '']);

    move(outer.querySelector('i') as Element);
    jest.advanceTimersByTime(0);
    expect(shown()).toBe('Outer');
    expect(outer.getAttribute('title')).toBe('');

    move(away);
    jest.advanceTimersByTime(100);
    expect([outer.getAttribute('title'), inner.getAttribute('title')]).toEqual(['Outer', 'Inner']);
  });

  it.each(['pointerdown', 'wheel', 'scroll'])(
    'hides on %s, and keeps the title away until the pointer leaves',
    (type) => {
      const button = make('<button title="Reset levels"></button>');
      move(button);
      jest.advanceTimersByTime(500);

      button.dispatchEvent(new Event(type, { bubbles: true }));

      expect(shown()).toBeNull();
      expect(button.getAttribute('title')).toBe('');
    },
  );

  it('hides on a key, as a key can scroll a grid', () => {
    const button = make('<button title="Reset levels"></button>');
    move(button);
    jest.advanceTimersByTime(500);

    key('Shift');
    expect(shown()).toBe('Reset levels');
    key('ArrowDown');

    expect(shown()).toBeNull();
  });

  it('takes the Escape that closes a tooltip, and only that one', () => {
    const button = make('<button title="Reset levels"></button>');
    move(button);
    jest.advanceTimersByTime(500);

    expect(key('Escape').defaultPrevented).toBe(true);
    expect(key('Escape').defaultPrevented).toBe(false);
  });

  it.each([
    ['the window loses focus', () => window.dispatchEvent(new Event('blur'))],
    [
      'the pointer leaves the page',
      () => document.documentElement.dispatchEvent(new MouseEvent('pointerleave')),
    ],
  ])('ends when %s', (_, leave) => {
    const button = make('<button title="Reset levels"></button>');
    move(button);
    jest.advanceTimersByTime(500);

    leave();

    expect(shown()).toBeNull();
    expect(button.getAttribute('title')).toBe('Reset levels');
  });

  it('stays when the pointer leaves an element inside the page', () => {
    const button = make('<button title="Reset levels"></button>');
    move(button);
    jest.advanceTimersByTime(500);

    away.dispatchEvent(new MouseEvent('pointerleave'));

    expect(shown()).toBe('Reset levels');
  });

  it('shows nothing for an element removed before the delay ends', () => {
    const button = make('<button title="Reset levels"></button>');
    move(button);

    button.remove();
    jest.advanceTimersByTime(500);

    expect(shown()).toBeNull();
  });

  it('shows and gives back a title the app changed while it showed', async () => {
    const button = make('<button title="Old"></button>');
    move(button);
    jest.advanceTimersByTime(500);

    button.setAttribute('title', 'New');
    await flush();
    expect(shown()).toBe('New');
    expect(button.getAttribute('title')).toBe('');

    move(away);
    jest.advanceTimersByTime(100);
    expect(button.getAttribute('title')).toBe('New');
  });

  it('gives back an empty title the app set while it showed', async () => {
    const button = make('<button title="Old"></button>');
    move(button);
    jest.advanceTimersByTime(500);

    button.setAttribute('title', '');
    await flush();
    move(away);
    jest.advanceTimersByTime(100);

    expect(button.getAttribute('title')).toBe('');
  });

  it('does not give back a title the app removed while it showed', async () => {
    const button = make('<button title="Old"></button>');
    move(button);
    jest.advanceTimersByTime(500);

    button.removeAttribute('title');
    await flush();
    expect(shown()).toBeNull();

    move(away);
    jest.advanceTimersByTime(100);
    expect(button.hasAttribute('title')).toBe(false);
  });

  it('finds a title inside a shadow root', () => {
    const host = make('<div></div>');
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<button title="Show 2 more"></button>';

    move(root.querySelector('button') as Element);
    jest.advanceTimersByTime(500);

    expect(shown()).toBe('Show 2 more');
  });

  it('gives every title back when the viewer goes', () => {
    const button = make('<button title="Reset levels"></button>');
    move(button);

    controller.hostDisconnected?.();
    jest.advanceTimersByTime(500);

    expect(button.getAttribute('title')).toBe('Reset levels');
    expect(tip()).toBeNull();
  });
});
