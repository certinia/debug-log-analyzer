/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * jsdom implements no layout, so it ships no `ResizeObserver` either. Components that observe
 * their own size construct one on connect, so without this every such suite throws before it can
 * assert anything. A suite that needs to *drive* resizes replaces this with its own stub.
 */
class NoopResizeObserver implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

if (!('ResizeObserver' in globalThis)) {
  (globalThis as unknown as Record<string, unknown>).ResizeObserver = NoopResizeObserver;
}

/**
 * A mounted component stays connected until something removes it, and its
 * `connectedCallback` subscriptions stay live with it. One test's leftovers then
 * hear the next test's events. `replaceChildren` over `innerHTML = ''` so
 * `disconnectedCallback` runs and the subscriptions actually release.
 *
 * The suites run under `node` unless a file asks for jsdom, so there is not
 * always a document.
 */
if (typeof document !== 'undefined') {
  afterEach(() => {
    document.body.replaceChildren();
  });
}
