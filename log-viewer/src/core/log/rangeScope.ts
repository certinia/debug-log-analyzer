/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ReactiveController, ReactiveControllerHost } from 'lit';

/** A stretch of the log, in the nanosecond timestamps the parser reports. */
export interface TimeWindow {
  start: number;
  end: number;
}

/**
 * The stretch of the log the Timeline is showing, or null for the whole log.
 *
 * The Timeline is the only writer: it owns the viewport, so it also decides when
 * a viewport is wide enough to count as the whole log. Everything else reads.
 */
let range: TimeWindow | null = null;

const listeners = new Set<(window: TimeWindow | null) => void>();

/** The window on screen, or null for the whole log. */
export function currentRange(): TimeWindow | null {
  return range;
}

/**
 * Records the window on screen and tells every reader. Pass null for the whole
 * log. An unchanged window tells nobody, so a viewport that settles back where
 * it started rebuilds nothing.
 */
export function setRange(window: TimeWindow | null): void {
  if (sameWindow(window, range)) {
    return;
  }
  range = window;
  for (const listener of listeners) {
    listener(range);
  }
}

/** Slack on the whole-log test. A full zoom-out sets zoom to width over span,
 *  so reading the width back out of that division lands an ULP either side of
 *  the span, and an exact test would leave a window on at full zoom-out. */
const WHOLE_LOG_SLACK_NS = 1;

/**
 * The window a viewport showing `timeStart` to `timeEnd` scopes to, or null
 * where it shows the whole log and so scopes to nothing.
 *
 * Null for a viewport of no width too: before layout, or in a collapsed
 * container, the bounds collapse, and a window of nothing would read as a
 * stretch of log where nothing ran.
 */
export function windowFor(
  timeStart: number,
  timeEnd: number,
  logStart: number,
  logEnd: number,
): TimeWindow | null {
  if (!Number.isFinite(timeStart) || !Number.isFinite(timeEnd) || timeEnd <= timeStart) {
    return null;
  }
  const showsWholeLog =
    timeStart <= logStart + WHOLE_LOG_SLACK_NS && timeEnd >= logEnd - WHOLE_LOG_SLACK_NS;
  return showsWholeLog ? null : { start: timeStart, end: timeEnd };
}

/** True when both name the same stretch, the whole log included. */
export function sameWindow(a: TimeWindow | null, b: TimeWindow | null): boolean {
  return a?.start === b?.start && a?.end === b?.end;
}

/** Subscribes to the window, and returns the release. */
export function onRangeChange(callback: (window: TimeWindow | null) => void): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

/**
 * Follows the window on screen for a component that reads it.
 *
 * Reads the window afresh on connect, which is why the window is state rather
 * than an event: a section built after the last viewport change still opens on
 * the window the user is looking at.
 */
export class RangeScopeController implements ReactiveController {
  private _window = currentRange();
  private _release: (() => void) | null = null;
  private readonly _host: ReactiveControllerHost;

  constructor(host: ReactiveControllerHost) {
    this._host = host;
    host.addController(this);
  }

  hostConnected(): void {
    this._window = currentRange();
    this._release = onRangeChange((window) => {
      this._window = window;
      this._host.requestUpdate();
    });
  }

  hostDisconnected(): void {
    this._release?.();
    this._release = null;
  }

  /** The window on screen, or null for the whole log. */
  get window(): TimeWindow | null {
    return this._window;
  }
}
