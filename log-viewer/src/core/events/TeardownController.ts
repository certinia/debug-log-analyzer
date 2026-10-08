/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ReactiveController, ReactiveControllerHost } from 'lit';

/**
 * Tears the host's heavy state down once the host has left the page, and builds
 * it again if the host comes back.
 *
 * A keyed `repeat` moves a host by detaching and re-attaching it in one task, so
 * `teardown` waits a microtask and is skipped when the host is back: a move keeps
 * the live state, with its scroll, open rows and selection.
 */
export class TeardownController implements ReactiveController {
  private readonly _host: ReactiveControllerHost & Element;
  private readonly _teardown: () => void;
  private readonly _rebuild: () => void;
  private _tornDown = false;

  constructor(
    host: ReactiveControllerHost & Element,
    { teardown, rebuild }: { teardown: () => void; rebuild: () => void },
  ) {
    this._host = host;
    this._teardown = teardown;
    this._rebuild = rebuild;
    host.addController(this);
  }

  hostConnected(): void {
    if (this._tornDown) {
      this._tornDown = false;
      this._rebuild();
    }
  }

  hostDisconnected(): void {
    queueMicrotask(() => {
      if (!this._host.isConnected && !this._tornDown) {
        this._tornDown = true;
        this._teardown();
      }
    });
  }
}
