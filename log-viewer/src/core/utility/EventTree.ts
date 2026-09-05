/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

import type { LogEvent } from 'apex-log-parser';

/**
 * The events with no ancestor in the same set, duplicates dropped. Whatever is
 * summed or walked from these, nothing inside a kept subtree is counted twice.
 */
export function outermostEvents(events: Iterable<LogEvent>): LogEvent[] {
  const all = new Set(events);
  const outermost: LogEvent[] = [];
  for (const event of all) {
    let enclosed = false;
    for (let parent = event.parent; parent && !enclosed; parent = parent.parent) {
      enclosed = all.has(parent);
    }
    if (!enclosed) {
      outermost.push(event);
    }
  }
  return outermost;
}
