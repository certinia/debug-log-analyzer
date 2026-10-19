/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ReactiveController, ReactiveControllerHost } from 'lit';

import type { ApexLog, DebugLevels, LogLevel } from '@apexdevtools/apex-log-parser';
import { filterByLevels, sameLevels } from '../../core/log/levelFilter.js';

/** How long a level change runs before the header shows it is busy. */
const BUSY_AFTER_MS = 100;

export interface LogLevelsHost {
  /** Puts `log` on screen. */
  publish(log: ApexLog): void;
  /** Reports a level change that failed. The log on screen stays. */
  fail(err: unknown): void;
}

/**
 * The debug levels of the log on screen: the levels it was captured at, the
 * levels chosen, and the build that filters the captured log to them.
 */
export class LogLevelsController implements ReactiveController {
  /** The parsed log. The one on screen is this log, or a copy filtered to {@link chosen}. */
  captured: ApexLog | null = null;
  // Set on each pick before its build ends, so a quick second pick keeps the first.
  chosen: DebugLevels = {};
  /** True while a level change has run for longer than a moment. */
  busy = false;

  private readonly _host: ReactiveControllerHost;
  private readonly _log: LogLevelsHost;
  // A log that a pick left as it is still states its captured levels, so the levels on screen are kept here.
  private _applied: DebugLevels = {};
  private _build: AbortController | null = null;
  private _busyTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(host: ReactiveControllerHost, log: LogLevelsHost) {
    this._host = host;
    this._log = log;
    host.addController(this);
  }

  hostDisconnected(): void {
    this._stop();
  }

  /** A newly parsed log, at the levels it was captured at. */
  open(log: ApexLog): void {
    this._stop();
    this.captured = log;
    this.chosen = { ...log.debugLevels };
    this._applied = this.chosen;
    this._host.requestUpdate();
  }

  /** Shows the log as if `category` had been captured at `level`. */
  async choose(category: keyof DebugLevels, level: LogLevel): Promise<void> {
    const captured = this.captured;
    if (!captured) {
      return;
    }
    this.chosen = { ...this.chosen, [category]: level };
    this._stop();
    const build = new AbortController();
    this._build = build;
    this._busyTimer = setTimeout(() => this._setBusy(true), BUSY_AFTER_MS);
    this._host.requestUpdate();
    try {
      const shown = await filterByLevels(captured, this.chosen, { signal: build.signal });
      if (shown && !build.signal.aborted) {
        this._applied = this.chosen;
        this._log.publish(shown);
      }
    } catch (err: unknown) {
      this.chosen = this._applied;
      this._log.fail(err);
    } finally {
      if (this._build === build) {
        this._build = null;
        clearTimeout(this._busyTimer);
        this._setBusy(false);
      }
    }
  }

  /** Shows the log at the levels it was captured at. */
  reset(): void {
    const captured = this.captured;
    if (!captured) {
      return;
    }
    this._stop();
    this.chosen = { ...captured.debugLevels };
    if (!sameLevels(this._applied, this.chosen)) {
      this._log.publish(captured);
    }
    this._applied = this.chosen;
    this._host.requestUpdate();
  }

  private _stop(): void {
    this._build?.abort();
    this._build = null;
    clearTimeout(this._busyTimer);
    this._setBusy(false);
  }

  private _setBusy(busy: boolean): void {
    if (this.busy !== busy) {
      this.busy = busy;
      this._host.requestUpdate();
    }
  }
}
