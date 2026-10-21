/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ReactiveController, ReactiveControllerHost } from 'lit';

/**
 * Runs the last callback given to `schedule` once `ms` pass with no newer one, as a
 * search waits for typing to pause. A host that leaves the page drops a waiting one.
 */
export class DelayController implements ReactiveController {
  private readonly _ms: number;
  private _timer: ReturnType<typeof setTimeout> | undefined;

  constructor(host: ReactiveControllerHost, ms: number) {
    this._ms = ms;
    host.addController(this);
  }

  schedule(run: () => void): void {
    this.cancel();
    this._timer = setTimeout(() => {
      this._timer = undefined;
      run();
    }, this._ms);
  }

  cancel(): void {
    clearTimeout(this._timer);
    this._timer = undefined;
  }

  hostDisconnected(): void {
    this.cancel();
  }
}
