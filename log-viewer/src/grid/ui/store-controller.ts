/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ReactiveController, ReactiveControllerHost } from 'lit';

import type { GridStore, Snapshot } from '../core/index.js';

/** Holds a store's latest snapshot and asks the host to update on each new one. */
export class StoreController<R extends object> implements ReactiveController {
  private readonly host: ReactiveControllerHost;
  private store: GridStore<R> | null = null;
  private unsubscribe: (() => void) | null = null;
  snapshot: Snapshot<R> | null = null;

  constructor(host: ReactiveControllerHost) {
    this.host = host;
    host.addController(this);
  }

  /** Follows `store` from now on, and drops the one before. */
  follow(store: GridStore<R>): void {
    this.hostDisconnected();
    this.store = store;
    this.snapshot = store.snapshot();
    this.subscribe();
    this.host.requestUpdate();
  }

  hostConnected(): void {
    // Snapshots the store made while the host was away.
    const latest = this.store?.snapshot() ?? null;
    if (latest !== this.snapshot) {
      this.snapshot = latest;
      this.host.requestUpdate();
    }
    this.subscribe();
  }

  hostDisconnected(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private subscribe(): void {
    if (!this.store || this.unsubscribe) {
      return;
    }
    this.unsubscribe = this.store.subscribe((snapshot) => {
      this.snapshot = snapshot;
      this.host.requestUpdate();
    });
  }
}
