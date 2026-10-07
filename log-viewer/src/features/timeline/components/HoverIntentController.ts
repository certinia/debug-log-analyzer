/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ReactiveController, ReactiveControllerHost } from 'lit';

const ENTER_MS = 150;
// A preview outlives the pointer, so a move to the next item never flashes.
const LEAVE_MS = 100;

/**
 * Hover intent across a row of items, as tooltips warm up: the first item waits for
 * the pointer to rest, then its neighbours show at once until the pointer leaves the
 * row. A pointer passing over shows nothing.
 *
 * `onChange` gets the item to preview, or null to drop the preview.
 */
export class HoverIntentController<T> implements ReactiveController {
  private readonly _onChange: (item: T | null) => void;
  private _shown: T | null = null;
  private _focused: T | null = null;
  private _enterTimer: ReturnType<typeof setTimeout> | undefined;
  private _leaveTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(host: ReactiveControllerHost, onChange: (item: T | null) => void) {
    this._onChange = onChange;
    host.addController(this);
  }

  /** The pointer reached `item`. */
  enter(item: T): void {
    this._clearTimers();
    if (this._shown !== null) {
      this._show(item);
      return;
    }
    this._enterTimer = setTimeout(() => this._show(item), ENTER_MS);
  }

  /** Keyboard focus reached `item`: show it with no wait, and fall back to it on leave. */
  focus(item: T): void {
    this._focused = item;
    this._clearTimers();
    this._show(item);
  }

  /** Keyboard focus left its item. */
  blur(): void {
    this._focused = null;
    this.leave();
  }

  /** The pointer left an item. */
  leave(): void {
    this._clearTimers();
    if (this._shown !== this._focused) {
      this._leaveTimer = setTimeout(() => this._show(this._focused), LEAVE_MS);
    }
  }

  // Reported, or the host keeps lighting a preview nothing points at any more.
  hostDisconnected(): void {
    this._clearTimers();
    this._focused = null;
    this._show(null);
  }

  private _show(item: T | null): void {
    if (item === this._shown) {
      return;
    }
    this._shown = item;
    this._onChange(item);
  }

  private _clearTimers(): void {
    clearTimeout(this._enterTimer);
    clearTimeout(this._leaveTimer);
  }
}
