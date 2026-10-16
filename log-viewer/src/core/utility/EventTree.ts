/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

import type { LogEvent } from '@apexdevtools/apex-log-parser';

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
  const steps = outermostEventsSteps(events);
  let step = steps.next();
  while (!step.done) {
    step = steps.next();
  }
  return step.value;
}

/** {@link outermostEvents}, yielding after each event so a caller can run it in slices. */
export function* outermostEventsSteps(
  events: Iterable<LogEvent>,
): Generator<void, LogEvent[], void> {
  const all = new Set<LogEvent>();
  for (const event of events) {
    all.add(event);
    yield;
  }
  const enclosed = new Map<LogEvent, boolean>();
  const isEnclosed = (event: LogEvent): boolean => {
    const passed: LogEvent[] = [];
    let answer = false;
    for (let parent = event.parent; parent; parent = parent.parent) {
      if (all.has(parent)) {
        answer = true;
        break;
      }
      const known = enclosed.get(parent);
      if (known !== undefined) {
        answer = known;
        break;
      }
      passed.push(parent);
    }
    for (const node of passed) {
      enclosed.set(node, answer);
    }
    return answer;
  };
  const outermost: LogEvent[] = [];
  for (const event of all) {
    if (!isEnclosed(event)) {
      outermost.push(event);
    }
    yield;
  }
  return outermost;
}
