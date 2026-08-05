/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ReactiveController, ReactiveControllerHost } from 'lit';

import { eventBus } from './EventBus.js';

/**
 * Re-runs `onLoad` (default: a host re-render) whenever a log finishes parsing.
 * The inspector's sections paint before the first parse and rebuild only on a
 * tab change or a selection, so a section that reads the log has to follow the
 * log itself.
 */
export class LogLoadedController implements ReactiveController {
  private readonly _host: ReactiveControllerHost;
  private readonly _onLoad?: () => void;
  private _off: (() => void) | null = null;

  constructor(host: ReactiveControllerHost, onLoad?: () => void) {
    this._host = host;
    this._onLoad = onLoad;
    host.addController(this);
  }

  hostConnected(): void {
    this._off = eventBus.on('log:loaded', () => {
      if (this._onLoad) {
        this._onLoad();
      } else {
        this._host.requestUpdate();
      }
    });
  }

  hostDisconnected(): void {
    this._off?.();
    this._off = null;
  }
}
