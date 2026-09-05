/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { LogEvent } from 'apex-log-parser';

import { DEFAULT_NAMESPACE } from '../core/utility/CallerNamespace.js';
import { outermostEvents } from '../core/utility/EventTree.js';
import { CHECK_EVERY, frameBudget, type FrameBudgetOptions } from '../core/utility/FrameBudget.js';

export interface NamespaceTime {
  namespace: string;
  selfTime: number;
}

/**
 * Self time per namespace over `roots` and everything below them, largest first.
 * A root inside another root is dropped, so summing every occurrence of an
 * aggregate cannot count a shared subtree twice.
 *
 * Returns null when the build is abandoned (see {@link FrameBudgetOptions}).
 */
async function namespaceSelfTimes(
  roots: readonly LogEvent[],
  options: FrameBudgetOptions,
): Promise<NamespaceTime[] | null> {
  const tick = frameBudget(options);
  const totals = new Map<string, number>();
  const stack = outermostEvents(roots);
  for (let walked = 0; stack.length; walked++) {
    if (walked % CHECK_EVERY === 0 && !(await tick())) {
      return null;
    }
    const event = stack.pop()!; // non-empty: the loop condition just checked

    const namespace = event.namespace || DEFAULT_NAMESPACE;
    totals.set(namespace, (totals.get(namespace) ?? 0) + event.duration.self);
    for (const child of event.children) {
      stack.push(child);
    }
  }
  return toNamespaceTimes(totals);
}

/** Self time per namespace, ranked for display: empty buckets go, largest first. */
export function toNamespaceTimes(totals: ReadonlyMap<string, number>): NamespaceTime[] {
  return [...totals]
    .filter(([, selfTime]) => selfTime > 0)
    .map(([namespace, selfTime]) => ({ namespace, selfTime }))
    .sort((a, b) => b.selfTime - a.selfTime);
}

/** Memo of the walk: the tree never changes after parse, so each scope is walked
 *  once. A frame near the root is nearly the whole log, so the scoped walk needs
 *  this as much as the whole-log one. */
const selfTimesCache = new WeakMap<object, NamespaceTime[]>();

/** The memoised times for `scope`, or undefined if it has never been walked. Lets
 *  a caller render an already-walked scope without showing a placeholder first. */
export function cachedNamespaceSelfTimes(scope: object): NamespaceTime[] | undefined {
  return selfTimesCache.get(scope);
}

/**
 * {@link namespaceSelfTimes} memoised on `scope` — the log for the whole log, the
 * frame itself for one frame, or the caller's instances array, which stays the
 * same object while the selection does. An abandoned walk is not memoised.
 */
export async function scopedNamespaceSelfTimes(
  scope: object,
  roots: readonly LogEvent[],
  options: FrameBudgetOptions,
): Promise<NamespaceTime[] | null> {
  const cached = selfTimesCache.get(scope);
  if (cached) {
    return cached;
  }
  const slices = await namespaceSelfTimes(roots, options);
  if (slices) {
    selfTimesCache.set(scope, slices);
  }
  return slices;
}
