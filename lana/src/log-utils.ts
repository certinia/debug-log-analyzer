/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

import type { LogEvent } from 'apex-log-parser';

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

/** Build metric parts for hover/decoration display from a LogEvent */
export function buildMetricParts(event: LogEvent): string[] {
  const parts: string[] = [];

  // Duration with optional self time
  const totalDuration = formatDuration(event.duration.total);
  if (event.duration.self !== event.duration.total) {
    parts.push(`**${totalDuration}** (self: ${formatDuration(event.duration.self)})`);
  } else {
    parts.push(`**${totalDuration}**`);
  }

  // SOQL with self count
  if (event.soqlCount.total > 0) {
    const selfPart = event.soqlCount.self > 0 ? ` (self: ${event.soqlCount.self})` : '';
    parts.push(`${event.soqlCount.total} SOQL${selfPart}`);
  }

  // SOQL rows
  if (event.soqlRowCount.total > 0) {
    parts.push(`${event.soqlRowCount.total} rows`);
  }

  // DML with self count
  if (event.dmlCount.total > 0) {
    const selfPart = event.dmlCount.self > 0 ? ` (self: ${event.dmlCount.self})` : '';
    parts.push(`${event.dmlCount.total} DML${selfPart}`);
  }

  // DML rows
  if (event.dmlRowCount.total > 0) {
    parts.push(`${event.dmlRowCount.total} DML rows`);
  }

  // Exceptions
  if (event.totalThrownCount > 0) {
    parts.push(`\u26a0\ufe0f ${event.totalThrownCount} thrown`);
  }

  return parts;
}
