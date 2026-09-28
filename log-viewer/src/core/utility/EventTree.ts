/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

import type { LogEvent } from 'apex-log-parser';

/**
 * Every event at or below `roots`, depth first. A generator, so the caller's
 * own per-event work — a frame budget check, an early return — stays in its
 * loop body; the tree's size is unbounded, so nothing here recurses.
 */
export function* walkEvents(roots: Iterable<LogEvent>): Generator<LogEvent> {
  const stack = [...roots];
  while (stack.length) {
    const event = stack.pop()!; // non-empty: the loop condition just checked
    yield event;
    for (const child of event.children) {
      stack.push(child);
    }
  }
}

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
