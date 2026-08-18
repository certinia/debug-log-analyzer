/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ApexLog, LogEvent } from 'apex-log-parser';

import { DEFAULT_NAMESPACE } from '../core/utility/CallerNamespace.js';
import { outermostEvents } from '../core/utility/EventTree.js';
import { CHECK_EVERY, frameBudget, type FrameBudgetOptions } from '../core/utility/FrameBudget.js';

export const NAMESPACE_COLORS = [
  '#0072b2',
  '#d55e00',
  '#009e73',
  '#cc79a7',
  '#e69f00',
  '#56b4e9',
  '#aa4499',
  '#44aa99',
] as const;

/** A colour per namespace in the order given, so the same list always reads the
 *  same way and a namespace on two bars keeps one colour. A namespace the list
 *  never named takes the next colour on first ask. */
function namespacePalette(namespaces: Iterable<string>): (namespace: string) => string {
  const colors = new Map<string, string>();
  const color = (namespace: string): string => {
    let assigned = colors.get(namespace);
    if (!assigned) {
      // Non-null: the modulo keeps the index inside the scale.
      assigned = NAMESPACE_COLORS[colors.size % NAMESPACE_COLORS.length]!;
      colors.set(namespace, assigned);
    }
    return assigned;
  };
  for (const namespace of namespaces) {
    color(namespace);
  }
  return color;
}

const palettes = new WeakMap<ApexLog, (namespace: string) => string>();

/**
 * The log's own colour per namespace. Every bar in every scope shares it, so a
 * namespace on the whole-log bar and on a frame's bar reads as one colour and the
 * colour carries meaning between sections. The log names its namespaces in a
 * fixed order; `default` is not one of them, so it is named first.
 */
export function logNamespacePalette(log: ApexLog): (namespace: string) => string {
  let palette = palettes.get(log);
  if (!palette) {
    palette = namespacePalette([DEFAULT_NAMESPACE, ...log.namespaces]);
    palettes.set(log, palette);
  }
  return palette;
}

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
