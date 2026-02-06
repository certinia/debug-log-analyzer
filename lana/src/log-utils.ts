/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

/** Regex to extract nanosecond timestamp from log line. Format: "HH:MM:SS.d (nanoseconds)|EVENT_TYPE" */
export const TIMESTAMP_REGEX = /^\d{2}:\d{2}:\d{2}\.\d+\s*\((\d+)\)\|/;

/** Format nanoseconds as human-readable duration (e.g., "1.23s", "45.67ms", "2m 30.00s") */
export function formatDuration(nanoseconds: number): string {
  const milliseconds = nanoseconds / 1_000_000;
  const seconds = milliseconds / 1000;

  if (seconds >= 60) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds.toFixed(2)}s`;
  } else if (seconds >= 1) {
    return `${seconds.toFixed(2)}s`;
  } else {
    return `${milliseconds.toFixed(2)}ms`;
  }
}
