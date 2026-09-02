/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import {
  currentRange,
  onRangeChange,
  setRange,
  windowFor,
  type TimeWindow,
} from '../rangeScope.js';

describe('rangeScope', () => {
  afterEach(() => {
    setRange(null);
  });

  it('reads as the whole log until a window is set', () => {
    expect(currentRange()).toBeNull();
  });

  it('holds the window it was given', () => {
    setRange({ start: 100, end: 500 });

    expect(currentRange()).toEqual({ start: 100, end: 500 });
  });

  it('returns to the whole log', () => {
    setRange({ start: 100, end: 500 });
    setRange(null);

    expect(currentRange()).toBeNull();
  });

  it('tells every reader when the window changes', () => {
    const seen: Array<TimeWindow | null> = [];
    const other: Array<TimeWindow | null> = [];
    onRangeChange((window) => seen.push(window));
    onRangeChange((window) => other.push(window));

    setRange({ start: 1, end: 2 });

    expect(seen).toEqual([{ start: 1, end: 2 }]);
    expect(other).toEqual([{ start: 1, end: 2 }]);
  });

  // A viewport that settles back where it started must rebuild nothing.
  it('says nothing when the window has not moved', () => {
    const seen: Array<TimeWindow | null> = [];
    setRange({ start: 1, end: 2 });
    onRangeChange((window) => seen.push(window));

    setRange({ start: 1, end: 2 });

    expect(seen).toEqual([]);
  });

  it('says nothing when the whole log is set twice', () => {
    const seen: Array<TimeWindow | null> = [];
    onRangeChange((window) => seen.push(window));

    setRange(null);

    expect(seen).toEqual([]);
  });

  it('stops telling a released reader', () => {
    const seen: Array<TimeWindow | null> = [];
    const release = onRangeChange((window) => seen.push(window));

    release();
    setRange({ start: 1, end: 2 });

    expect(seen).toEqual([]);
  });
});

describe('windowFor', () => {
  const LOG_START = 6_329_577;
  const LOG_END = LOG_START + 24_600_000_000;

  it('names the stretch a zoomed viewport shows', () => {
    expect(windowFor(1_000, 2_000, LOG_START, LOG_END)).toEqual({ start: 1_000, end: 2_000 });
  });

  it('reads a viewport of the whole log as no window', () => {
    expect(windowFor(0, LOG_END, LOG_START, LOG_END)).toBeNull();
  });

  // A full zoom-out sets zoom to width over span, and reading the width back
  // out of that division lands an ULP short for about one width in twenty.
  it('reads a full zoom-out as no window even when the division falls short', () => {
    const span = LOG_END;
    const width = 1_713;
    const zoom = width / span;
    const timeEnd = width / zoom;

    expect(timeEnd).toBeLessThan(span);
    expect(windowFor(0, timeEnd, LOG_START, LOG_END)).toBeNull();
  });

  it('reads a viewport of no width as no window', () => {
    expect(windowFor(1_000, 1_000, LOG_START, LOG_END)).toBeNull();
    expect(windowFor(2_000, 1_000, LOG_START, LOG_END)).toBeNull();
  });

  it('reads a viewport with no numbers in it as no window', () => {
    expect(windowFor(Number.NaN, Number.NaN, LOG_START, LOG_END)).toBeNull();
    expect(windowFor(0, Number.POSITIVE_INFINITY, LOG_START, LOG_END)).toBeNull();
  });
});
