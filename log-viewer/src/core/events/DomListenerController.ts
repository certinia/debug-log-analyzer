/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ReactiveController, ReactiveControllerHost } from 'lit';

/** A handler map: the event name to call for, and what to call. */
export type DomListeners<M> = {
  [K in keyof M]?: (event: M[K]) => void;
};

/**
 * Listens on a target outside the host's own tree — `document` or `window` —
 * for exactly as long as the host is connected.
 *
 * Wiring a global listener in a constructor and removing it in
 * `disconnectedCallback` leaves the host deaf after a re-attach, because the
 * constructor never runs again. The host lifecycle owns both ends here, so a
 * detach and re-attach re-subscribes.
 *
 * Pass each handler as an inline arrow, never a reference to a class field:
 * this package compiles with `useDefineForClassFields: false`, so field
 * initialisers run in declaration order and a field declared below this one is
 * still `undefined` when the controller is built. `addEventListener(name,
 * undefined)` then fails silently.
 */
export class DomListenerController<
  M extends { [K in keyof M]: Event },
> implements ReactiveController {
  private readonly _target: EventTarget;
  private readonly _entries: [string, EventListener][];

  constructor(host: ReactiveControllerHost, target: EventTarget, listeners: DomListeners<M>) {
    this._target = target;
    this._entries = Object.entries(listeners) as [string, EventListener][];
    for (const [name, handler] of this._entries) {
      if (typeof handler !== 'function') {
        // addEventListener(name, undefined) is a legal no-op, so without this the
        // host just goes quiet. See the field-order note above.
        throw new TypeError(`DomListenerController: the handler for "${name}" is not a function.`);
      }
    }
    host.addController(this);
  }

  hostConnected(): void {
    for (const [name, handler] of this._entries) {
      this._target.addEventListener(name, handler);
    }
  }

  hostDisconnected(): void {
    for (const [name, handler] of this._entries) {
      this._target.removeEventListener(name, handler);
    }
  }
}
