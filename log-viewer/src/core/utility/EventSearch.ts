/*
 * Copyright (c) 2024 Certinia Inc. All rights reserved.
 */

import type { LogEvent } from '../log-parser/LogEvents.js';

export interface EventSearchResult {
  event: LogEvent;
  depth: number;
}

/**
 * Binary search for an event by timestamp in a sorted event tree.
 * Events are sorted by start time, so we can search efficiently.
 * Recursively searches children to find the deepest matching event.
 *
 * @param events - Array of LogEvent sorted by timestamp
 * @param timestamp - Target timestamp to find (in nanoseconds)
 * @param depth - Current depth in the tree (starts at 0)
 * @returns The matching event with its depth, or null if not found
 */
export function findEventByTimestamp(
  events: LogEvent[],
  timestamp: number,
  depth: number = 0,
): EventSearchResult | null {
  let start = 0;
  let end = events.length - 1;

  while (start <= end) {
    const mid = Math.floor((start + end) / 2);
    const event = events[mid];
    if (!event) {
      break;
    }

    const endTime = event.exitStamp ?? event.timestamp;

    if (timestamp === event.timestamp) {
      return { event, depth };
    }

    if (timestamp >= event.timestamp && timestamp <= endTime) {
      // Check children for more precise match
      const child =
        event.children.length > 0
          ? findEventByTimestamp(event.children, timestamp, depth + 1)
          : null;
      return child ?? { event, depth };
    }

    if (timestamp > endTime) {
      start = mid + 1;
    } else {
      end = mid - 1;
    }
  }

  return null;
}
