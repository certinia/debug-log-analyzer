/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import type { ReactiveController, ReactiveControllerHost } from 'lit';

import { TooltipController } from '../TooltipController.js';

let shown: string[] = [];
let hides = 0;

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

const over = (el: Element) =>
  el.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, composed: true }));

describe('TooltipController', () => {
  let controller: ReactiveController;
  let away: HTMLElement;

  beforeEach(() => {
    jest.useFakeTimers();
    shown = [];
    hides = 0;
    HTMLElement.prototype.showPopover = function (this: HTMLElement) {
      shown.push(this.textContent ?? '');
    };
    HTMLElement.prototype.hidePopover = () => {
      hides++;
    };
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

    over(button);
    jest.advanceTimersByTime(499);
    expect(shown).toEqual([]);
    jest.advanceTimersByTime(1);

    expect(shown).toEqual(['Reset levels']);
  });

  it('keeps the native tooltip away and the accessible name while it shows', () => {
    const icon = make('<button title="Reset levels"></button>');
    const text = make('<span title="Full path">apex.log</span>');
    const named = make('<button title="Copy" aria-label="Copy rows"></button>');

    over(icon);
    expect(icon.hasAttribute('title')).toBe(false);
    expect(icon.getAttribute('aria-label')).toBe('Reset levels');
    over(text);
    expect(text.getAttribute('aria-description')).toBe('Full path');
    over(named);
    expect(named.getAttribute('aria-label')).toBe('Copy rows');
    expect(named.hasAttribute('aria-description')).toBe(false);
  });

  it('gives the title back when the pointer leaves', () => {
    const button = make('<button title="Reset levels"></button>');
    over(button);
    jest.advanceTimersByTime(500);

    over(away);

    expect(button.getAttribute('title')).toBe('Reset levels');
    expect(button.hasAttribute('aria-label')).toBe(false);
    expect(hides).toBe(1);
  });

  it('keeps showing while the pointer moves over the element children', () => {
    const button = make('<button title="Reset levels"><span>↺</span></button>');
    over(button);
    jest.advanceTimersByTime(500);

    over(button.querySelector('span') as Element);

    expect(hides).toBe(0);
  });

  it('shows the next tooltip at once while the pointer scans a toolbar', () => {
    const first = make('<button title="Columns"></button>');
    const second = make('<button title="Export to CSV"></button>');
    over(first);
    jest.advanceTimersByTime(500);

    over(second);
    jest.advanceTimersByTime(0);

    expect(shown).toEqual(['Columns', 'Export to CSV']);
  });

  it('hides on a click, and keeps the title away until the pointer leaves', () => {
    const button = make('<button title="Reset levels"></button>');
    over(button);
    jest.advanceTimersByTime(500);

    button.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));

    expect(hides).toBe(1);
    expect(button.hasAttribute('title')).toBe(false);
  });

  it('hides on Escape', () => {
    const button = make('<button title="Reset levels"></button>');
    over(button);
    jest.advanceTimersByTime(500);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(hides).toBe(1);
  });

  it('shows the title when the keyboard focuses the element, and hides when focus leaves', () => {
    const button = make('<button title="Reset levels"></button>');

    button.focus();
    jest.advanceTimersByTime(500);
    expect(shown).toEqual(['Reset levels']);

    button.blur();
    expect(button.getAttribute('title')).toBe('Reset levels');
  });

  it('finds a title inside a shadow root', () => {
    const host = make('<div></div>');
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<button title="Show 2 more"></button>';

    over(root.querySelector('button') as Element);
    jest.advanceTimersByTime(500);

    expect(shown).toEqual(['Show 2 more']);
  });

  it('gives every title back when the viewer goes', () => {
    const button = make('<button title="Reset levels"></button>');
    over(button);

    controller.hostDisconnected?.();
    jest.advanceTimersByTime(500);

    expect(button.getAttribute('title')).toBe('Reset levels');
    expect(shown).toEqual([]);
    expect(document.querySelector('hover-tooltip')).toBeNull();
  });
});
