/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ReactiveController, ReactiveControllerHost } from 'lit';

/**
 * Watches the host's own box for as long as the host is connected.
 *
 * `onResize` takes the entries as the native callback does, so a caller reading
 * a box must handle an empty report itself.
 */
export class ResizeController implements ReactiveController {
  private readonly _host: ReactiveControllerHost & Element;
  private readonly _onResize: (entries: readonly ResizeObserverEntry[]) => void;
  private _observer: ResizeObserver | null = null;
  private readonly _targets = new Set<Element>();

  constructor(
    host: ReactiveControllerHost & Element,
    onResize: (entries: readonly ResizeObserverEntry[]) => void,
  ) {
    this._host = host;
    this._onResize = onResize;
    host.addController(this);
  }

  hostConnected(): void {
    this._observer ??= new ResizeObserver((entries) => {
      this._onResize(entries);
    });
    this._observer.observe(this._host);
    for (const target of this._targets) {
      this._observer.observe(target);
    }
  }

  hostDisconnected(): void {
    this._observer?.disconnect();
  }

  /**
   * Also watch `target`, such as a box in the host's shadow root, with the same callback.
   * It is watched again after a re-attach, so call this once per element.
   */
  observe(target: Element): void {
    this._targets.add(target);
    this._observer?.observe(target);
  }
}
