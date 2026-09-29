/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ReactiveController, ReactiveControllerHost } from 'lit';

import type { DetailSource } from '../core/events/EventBus.js';
import { InspectorEmphasis } from './inspectorEmphasis.js';
import { wireInspectorTab, type InspectorTabSync } from './inspectorTab.js';

/**
 * Subscribes a Lit view to the inspector for as long as it is connected, and
 * holds the emphasis the two of them share.
 *
 * The emphasis belongs here rather than to the view because nothing outside the
 * subscription decides what it holds: the view only ever drops a pick that went
 * with its own selection, through {@link dropPick}. {@link wireInspectorTab} is
 * still the way in for a view that is no `ReactiveControllerHost` — the flame
 * chart, which is a plain class and rests the emphasis on a frame of its own.
 */
export class InspectorTabController implements ReactiveController {
  private readonly _emphasis = new InspectorEmphasis();
  private readonly _source: DetailSource;
  private readonly _sync: InspectorTabSync;
  private _off: (() => void) | null = null;

  constructor(host: ReactiveControllerHost, source: DetailSource, sync: InspectorTabSync) {
    this._source = source;
    this._sync = sync;
    host.addController(this);
  }

  hostConnected(): void {
    this._off = wireInspectorTab(this._source, this._emphasis, this._sync);
    // A pick outlives a detach, and the view came back with nothing lit.
    const emphasised = this._emphasis.current();
    if (emphasised.length) {
      this._sync.mark(emphasised);
    }
  }

  hostDisconnected(): void {
    this._off?.();
    this._off = null;
  }

  /**
   * Drop a pick a picked inspector row left in the view, and mark what is left.
   * For a view whose own selection has gone: the mark was never a selection of
   * its own.
   */
  dropPick(): void {
    this._sync.mark(this._emphasis.pick([]));
  }
}
