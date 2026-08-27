/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

import type { LogEvent } from 'apex-log-parser';

/**
 * Occurrences reached through `keyPath`: `keyPath[0]` is the occurrence itself, so
 * the root bucket's own key, and the last entry is the bucket being scoped.
 *
 * A bottom-up caller bucket stores no occurrences of its own, so they are derived
 * from the root bucket, which holds every one of them. Storing them per bucket
 * would cost the sum of all chain depths.
 *
 * @param rootInstances - every occurrence the root bucket holds
 * @param keyPath - the chain that reaches the bucket, the occurrence first
 */
export function occurrencesThrough(
  rootInstances: readonly LogEvent[],
  keyPath: readonly string[],
): LogEvent[] {
  if (!keyPath.length) {
    return [];
  }
  // Split once per call rather than rebuilding a key per frame per level: the
  // filter runs over every occurrence the root holds, on a pointer move.
  const path = keyPath.map(splitKey);
  return rootInstances.filter((instance) => reachedThrough(instance, path));
}

/** A bucket key's three parts. `text` can itself hold a separator, so only the
 *  first two are cut. */
interface KeyParts {
  type: string;
  namespace: string;
  text: string;
}

function splitKey(key: string): KeyParts {
  const type = key.indexOf('|');
  const namespace = key.indexOf('|', type + 1);
  return {
    type: key.slice(0, type),
    namespace: key.slice(type + 1, namespace),
    text: key.slice(namespace + 1),
  };
}

function reachedThrough(instance: LogEvent, path: readonly KeyParts[]): boolean {
  let frame: LogEvent | null = instance;
  for (const part of path) {
    if (
      !frame ||
      (frame.type ?? '') !== part.type ||
      frame.namespace !== part.namespace ||
      frame.text !== part.text
    ) {
      return false;
    }
    frame = frame.parent;
  }
  return true;
}
