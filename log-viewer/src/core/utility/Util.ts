/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */

/**
 * Formats a duration in nanoseconds into a human-readable string.
 *
 * Automatically selects the most appropriate unit (microseconds, milliseconds, seconds, or minutes)
 * based on the magnitude of the duration. Applies appropriate precision for each unit.
 *
 * @param ns - The duration in nanoseconds to format
 * @returns A formatted string representing the duration with appropriate units:
 * - Microseconds (µs) for durations < 0.1ms
 * - Milliseconds (ms) for durations < 1000ms
 * - Seconds (s) for durations < 60s
 * - Minutes and seconds (e.g., "2m 30s") for durations ≥ 60s
 *
 * @example
 * ```typescript
 * formatDuration(5000);        // "5 µs"
 * formatDuration(1500000);     // "1.5 ms"
 * formatDuration(2500000000);  // "2.5 s"
 * formatDuration(90000000000); // "1m 30s"
 * ```
 */
export function formatDuration(ns: number) {
  if (!ns) {
    return '0 ms';
  }

  const ms = ns / 1e6;

  // microseconds (< 0.01 ms)
  if (ms < 0.1) {
    const us = ns / 1e3;
    const precision = us < 10 ? 100 : us < 100 ? 10 : 1;
    return `${round(us, precision)} µs`;
  }

  if (ms < 1000) {
    const precision = ms < 10 ? 100 : ms < 100 ? 10 : 1;
    return `${round(ms, precision)} ms`;
  }

  const s = ms / 1000;
  if (s < 60) {
    const precision = s < 10 ? 100 : s < 100 ? 10 : 1;
    return `${round(s, precision)} s`;
  }

  const m = Math.floor(s / 60);
  const sec = s % 60;

  if (sec === 0) {
    return `${m}m`;
  }

  const secStr = sec === Math.floor(sec) ? `${sec}s` : `${round(sec, 10)}s`;
  return `${m}m ${secStr}`;
}

function round(value: number, precision: number): number {
  return Math.round(value * precision) / precision;
}

/**
 * Formats a time range showing start and end times with an arrow separator.
 *
 * Used by measurement overlay and minimap lens labels for consistent formatting.
 *
 * @param startTimeNs - Start time in nanoseconds
 * @param endTimeNs - End time in nanoseconds
 * @returns Formatted string like "1.2 s → 3.7 s"
 *
 * @example
 * ```typescript
 * formatTimeRange(1200000000, 3700000000);  // "1.2 s → 3.7 s"
 * formatTimeRange(0, 150000000);            // "0 ms → 150 ms"
 * ```
 */
export function formatTimeRange(startTimeNs: number, endTimeNs: number): string {
  return `${formatDuration(startTimeNs)} → ${formatDuration(endTimeNs)}`;
}

export function debounce<T extends unknown[]>(callBack: (...args: T) => unknown) {
  let requestId: number = 0;

  return (...args: T) => {
    if (requestId) {
      window.cancelAnimationFrame(requestId);
    }

    requestId = window.requestAnimationFrame(() => {
      callBack(...args);
    });
  };
}

export async function isVisible(
  element: HTMLElement,
  options?: IntersectionObserverInit,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const observer = new IntersectionObserver((entries, observerInstance) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          resolve(true);
          observerInstance.disconnect();
          return;
        }
      }
    }, options);

    observer.observe(element);
  });
}
