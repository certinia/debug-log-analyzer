/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * Marks the window in which a view selects a row on the inspector's behalf, so
 * the view can skip the `detail:select` it would otherwise emit and send the
 * inspector back the very selection it asked for.
 *
 * Needed because neither consumer offers a silent select: tabulator fires
 * `rowSelectionChanged` for a programmatic `row.select()`, and the flame chart
 * re-emits through `SelectionOrchestrator.selectFrame`.
 */
export class SelectionEchoGuard {
  private _active = false;

  /** True while a programmatic select is in flight - do not emit `detail:select`. */
  get suppressed(): boolean {
    return this._active;
  }

  /** Runs a synchronous select with echoes suppressed. */
  run<T>(select: () => T): T {
    this._active = true;
    try {
      return select();
    } finally {
      this._active = false;
    }
  }

  /** Runs an asynchronous select with echoes suppressed until it settles. */
  async runAsync<T>(select: () => Promise<T>): Promise<T> {
    this._active = true;
    try {
      return await select();
    } finally {
      this._active = false;
    }
  }
}
