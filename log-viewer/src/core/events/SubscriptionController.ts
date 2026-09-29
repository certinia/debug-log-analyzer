/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ReactiveController, ReactiveControllerHost } from 'lit';

/**
 * Holds a host's subscriptions for as long as the host is connected.
 *
 * `open` runs on connect, so it may read fields declared after the controller —
 * but only from a field initialiser. Build one in `connectedCallback` or later
 * and Lit runs `open` there and then, before those fields exist.
 */
export class SubscriptionController implements ReactiveController {
  private readonly _open: () => Iterable<() => void>;
  private _close: Array<() => void> = [];

  constructor(host: ReactiveControllerHost, open: () => Iterable<() => void>) {
    this._open = open;
    host.addController(this);
  }

  hostConnected(): void {
    this.hostDisconnected();
    this._close = [...this._open()];
  }

  hostDisconnected(): void {
    // Taken before any of them runs: an `off()` that disconnects the host re-enters here.
    const close = this._close;
    this._close = [];
    for (const off of close) {
      off();
    }
  }
}
