/**
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ReactiveController, ReactiveControllerHost } from 'lit';

/**
 * The least a `ReactiveController` needs of its host, plus the two calls a test
 * makes for Lit: `connect` and `disconnect` run the controllers' lifecycle.
 */
export class FakeHost implements ReactiveControllerHost {
  readonly controllers: ReactiveController[] = [];

  addController(controller: ReactiveController): void {
    this.controllers.push(controller);
  }
  removeController(): void {}
  requestUpdate(): void {}
  get updateComplete(): Promise<boolean> {
    return Promise.resolve(true);
  }

  connect(): void {
    for (const controller of this.controllers) {
      controller.hostConnected?.();
    }
  }
  disconnect(): void {
    for (const controller of this.controllers) {
      controller.hostDisconnected?.();
    }
  }
}
