/**
 * @jest-environment jsdom
 */
/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { beforeEach, describe, expect, it } from '@jest/globals';
import { LitElement, html, type ReactiveController } from 'lit';

import { DomListenerController, type DomListeners } from '../DomListenerController.js';
import type { FindEventDetail, FindEventMap } from '../../../features/find/findEvents.js';

/** A host that drives the controller hooks without needing a real element. */
function fakeHost() {
  const controllers = new Set<ReactiveController>();
  return {
    addController: (c: ReactiveController) => void controllers.add(c),
    removeController: (c: ReactiveController) => void controllers.delete(c),
    requestUpdate: () => {},
    updateComplete: Promise.resolve(true),
    connect: () => controllers.forEach((c) => c.hostConnected?.()),
    disconnect: () => controllers.forEach((c) => c.hostDisconnected?.()),
  };
}

const DETAIL: FindEventDetail = { text: 'abc', count: 2, options: { matchCase: true } };

const EVERY_NAME: (keyof FindEventMap)[] = [
  'lv-find',
  'lv-find-match',
  'lv-find-close',
  'lv-find-results',
  'db-find-results',
];

function find(name: keyof FindEventMap, detail: unknown = DETAIL): void {
  document.dispatchEvent(new CustomEvent(name, { detail }));
}

/** Records every event the controller hands back, for one set of names. */
function listen(names: readonly (keyof FindEventMap)[]) {
  const host = fakeHost();
  const seen: CustomEvent[] = [];
  const listeners: DomListeners<FindEventMap> = {};
  for (const name of names) {
    listeners[name] = (e) => void seen.push(e);
  }
  new DomListenerController<FindEventMap>(host, document, listeners);
  return { host, seen };
}

/** A real Lit host, so the re-attach case goes through Lit's own lifecycle. */
const litCalls: CustomEvent[] = [];

class FindBusTestHost extends LitElement {
  readonly bus = new DomListenerController<FindEventMap>(this, document, {
    'lv-find': (e) => void litCalls.push(e),
  });

  override render() {
    return html`<slot></slot>`;
  }
}
customElements.define('find-bus-test-host', FindBusTestHost);

describe('DomListenerController', () => {
  beforeEach(() => {
    litCalls.length = 0;
  });

  it('stays deaf until the host connects', () => {
    const { seen } = listen(['lv-find']);

    find('lv-find');

    expect(seen).toEqual([]);
  });

  it('routes each name to its own handler, and ignores the rest', () => {
    const host = fakeHost();
    const finds: CustomEvent[] = [];
    const results: CustomEvent[] = [];
    new DomListenerController<FindEventMap>(host, document, {
      'lv-find': (e) => void finds.push(e),
      'db-find-results': (e) => void results.push(e),
    });
    host.connect();

    for (const name of EVERY_NAME) {
      find(name, name === 'db-find-results' ? { totalMatches: 3, type: 'soql' } : DETAIL);
    }

    expect(finds.map((e) => e.type)).toEqual(['lv-find']);
    expect(results.map((e) => e.detail)).toEqual([{ totalMatches: 3, type: 'soql' }]);
  });

  it('hands the event through untouched', () => {
    const { host, seen } = listen(['lv-find-close']);
    host.connect();

    find('lv-find-close');

    // The views branch on `type`, so it has to survive alongside the payload.
    expect(seen[0]?.type).toBe('lv-find-close');
    expect(seen[0]?.detail).toEqual(DETAIL);
  });

  it('stops listening when the host disconnects', () => {
    const { host, seen } = listen(['lv-find']);
    host.connect();
    host.disconnect();

    find('lv-find');

    expect(seen).toEqual([]);
  });

  it('hears again after the element is detached and re-attached', async () => {
    const el = new FindBusTestHost();
    document.body.append(el);
    await el.updateComplete;
    el.remove();
    document.body.append(el);
    await el.updateComplete;

    find('lv-find');

    expect(litCalls).toHaveLength(1);
    el.remove();
  });
});
