/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { LogEvent } from 'apex-log-parser';

const DEFAULT_NAMESPACE = 'default';

const cache = new WeakMap<LogEvent, string>();

/**
 * Returns the namespace of the event's direct caller (`event.parent`).
 *
 * Empty/unset namespaces are normalized to 'default'. No tree walk: callers
 * that sit behind platform/glue frames resolve to 'default' rather than
 * skipping past them, matching "who literally invoked this?" semantics.
 *
 * Result is memoized per event via WeakMap.
 */
export function getCallerNamespace(event: LogEvent): string {
  const cached = cache.get(event);
  if (cached !== undefined) {
    return cached;
  }

  const parent = event.parent;
  const ns = parent?.namespace;
  const result = ns && ns !== '' ? ns : DEFAULT_NAMESPACE;
  cache.set(event, result);
  return result;
}
