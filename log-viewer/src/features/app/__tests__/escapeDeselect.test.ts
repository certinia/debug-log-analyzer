/**
 * @jest-environment jsdom
 */
/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import { eventBus, type DetailSource } from '../../../core/events/EventBus.js';
import { installEscapeDeselect, isDeselectEscape } from '../escapeDeselect.js';

function escapeEvent(init: KeyboardEventInit = {}): KeyboardEvent {
  return new KeyboardEvent('keydown', {
    key: 'Escape',
    bubbles: true,
    composed: true,
    cancelable: true,
    ...init,
  });
}

/**
 * Dispatches an Escape keydown from `target` and returns the predicate's
 * verdict, taken while the event is in flight (composedPath is only
 * populated during dispatch).
 */
function judge(target: EventTarget, init: KeyboardEventInit = {}): boolean {
  let verdict = false;
  const probe = (e: Event) => {
    verdict = isDeselectEscape(e as KeyboardEvent);
  };
  document.addEventListener('keydown', probe);
  target.dispatchEvent(escapeEvent(init));
  document.removeEventListener('keydown', probe);
  return verdict;
}

/**
 * jsdom implements no Popover API, so the guard's fallback treats every popover
 * as open. Stub the two members it reads to assert both states.
 */
function popover({ open, id }: { open: boolean; id?: string }): HTMLElement {
  const panel = document.createElement('div');
  panel.setAttribute('popover', '');
  if (id) {
    panel.id = id;
  }
  Object.defineProperty(panel, 'hidePopover', { value: () => {}, configurable: true });
  const matches = panel.matches.bind(panel);
  Object.defineProperty(panel, 'matches', {
    value: (selector: string) => (selector === ':popover-open' ? open : matches(selector)),
    configurable: true,
  });
  return panel;
}

function toggleFor(panelId: string): HTMLElement {
  const button = document.createElement('button');
  button.id = 'toggle';
  button.setAttribute('popovertarget', panelId);
  return button;
}

describe('isDeselectEscape', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('accepts a plain Escape', () => {
    expect(judge(document.body)).toBe(true);
  });

  it('rejects other keys', () => {
    expect(judge(document.body, { key: 'Enter' })).toBe(false);
  });

  it('yields to a handler that consumed the key', () => {
    const consume = (e: Event) => e.preventDefault();
    document.body.addEventListener('keydown', consume);
    const verdict = judge(document.body);
    document.body.removeEventListener('keydown', consume);

    expect(verdict).toBe(false);
  });

  it('yields to text entry (find widget, grid filters)', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);

    expect(judge(input)).toBe(false);
  });

  it('yields to text entry inside a shadow root', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const input = document.createElement('input');
    host.attachShadow({ mode: 'open' }).appendChild(input);

    expect(judge(input)).toBe(false);
  });

  it('yields to an open popover in the path', () => {
    const panel = popover({ open: true });
    document.body.appendChild(panel);

    expect(judge(panel)).toBe(false);
  });

  it('accepts Escape from a closed popover in the path', () => {
    const panel = popover({ open: false });
    document.body.appendChild(panel);

    expect(judge(panel)).toBe(true);
  });

  it('yields to the button that toggles an open popover', () => {
    const panel = popover({ open: true, id: 'panel' });
    document.body.append(toggleFor('panel'), panel);

    expect(judge(document.getElementById('toggle')!)).toBe(false);
  });

  it('accepts Escape from the button of a closed popover', () => {
    const panel = popover({ open: false, id: 'panel' });
    document.body.append(toggleFor('panel'), panel);

    expect(judge(document.getElementById('toggle')!)).toBe(true);
  });
});

describe('installEscapeDeselect', () => {
  let seen: Array<{ source: DetailSource }>;
  let offBus: () => void;
  let uninstall: (() => void) | null = null;

  beforeEach(() => {
    seen = [];
    offBus = eventBus.on('selection:clear', (d) => seen.push(d));
  });

  afterEach(() => {
    offBus();
    uninstall?.();
    uninstall = null;
  });

  it('asks the active tab to clear its selection', () => {
    uninstall = installEscapeDeselect(() => 'calltree');

    document.body.dispatchEvent(escapeEvent());

    expect(seen).toEqual([{ source: 'calltree' }]);
  });

  it('stays quiet while no tab maps to a source', () => {
    uninstall = installEscapeDeselect(() => undefined);

    document.body.dispatchEvent(escapeEvent());

    expect(seen).toEqual([]);
  });

  it('stays quiet for a consumed Escape', () => {
    uninstall = installEscapeDeselect(() => 'timeline');
    const consume = (e: Event) => e.preventDefault();
    document.addEventListener('keydown', consume, { capture: true });

    document.body.dispatchEvent(escapeEvent());
    document.removeEventListener('keydown', consume, { capture: true });

    expect(seen).toEqual([]);
  });

  it('stops listening once uninstalled', () => {
    uninstall = installEscapeDeselect(() => 'analysis');
    uninstall();
    uninstall = null;

    document.body.dispatchEvent(escapeEvent());

    expect(seen).toEqual([]);
  });
});
