/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { DetailSource } from '../core/events/EventBus.js';
import type { PaneSection } from './PaneView.js';

/** What a section list is reading: the selection, or the whole log. */
export type LayoutScope = 'detail' | 'summary';

/**
 * The key the panel remembers a list's section choices under.
 *
 * Every choice is per tab **and** per scope, because the same id means
 * different content in two lists: `calltree` is the whole log on the Timeline's
 * summary and one frame's subtree in every detail list. A choice made in one
 * list must never reach the other.
 */
export function layoutKey(source: DetailSource, scope: LayoutScope): string {
  return `${source}:${scope}`;
}

/** One section's entry in the flat stores, keyed `<layout key>:<section id>`. */
export function scopedKey(key: string, id: string): string {
  return `${key}:${id}`;
}

/**
 * One list's entries, by plain section id. The stores are flat, so this is what
 * a list hands to `<pane-view>`, which knows only section ids.
 */
export function scopedRecord<T>(store: Record<string, T>, key: string): Record<string, T> {
  const prefix = `${key}:`;
  return Object.fromEntries(
    Object.entries(store)
      .filter(([stored]) => stored.startsWith(prefix))
      .map(([stored, value]) => [stored.slice(prefix.length), value]),
  );
}

/** The store with one list's entries dropped: what a reset of that list leaves. */
export function withoutScope<T>(store: Record<string, T>, key: string): Record<string, T> {
  const prefix = `${key}:`;
  return Object.fromEntries(Object.entries(store).filter(([stored]) => !stored.startsWith(prefix)));
}

/**
 * The sections in the order the user arranged them. An id the order does not
 * name — a section added since they last arranged this list — keeps its place
 * from the builder, after the ones they did arrange.
 */
export function orderSections(sections: PaneSection[], order?: string[]): PaneSection[] {
  if (!order?.length) {
    return sections;
  }
  const ranks = new Map(order.map((id, index) => [id, index]));
  const rank = (section: PaneSection) => ranks.get(section.id) ?? order.length;
  return [...sections].sort((a, b) => rank(a) - rank(b));
}

/** The section ids this list hides. */
export function hiddenIds(hidden: Record<string, boolean>, key: string): Set<string> {
  return new Set(
    Object.entries(scopedRecord(hidden, key))
      .filter(([, value]) => value)
      .map(([id]) => id),
  );
}

/**
 * The order to remember after a reorder: the visible ids as the user left them,
 * with each hidden id kept behind the visible one it currently follows. Bringing
 * a section back then returns it to its place rather than the end of the stack.
 */
export function mergeOrder(
  ids: string[],
  hidden: ReadonlySet<string>,
  visibleOrder: string[],
): string[] {
  const trailing = new Map<string, string[]>();
  let previous = '';
  for (const id of ids) {
    if (hidden.has(id)) {
      trailing.set(previous, [...(trailing.get(previous) ?? []), id]);
    } else {
      previous = id;
    }
  }
  // A hidden section above every visible one has no predecessor, so it leads.
  return [
    ...(trailing.get('') ?? []),
    ...visibleOrder.flatMap((id) => [id, ...(trailing.get(id) ?? [])]),
  ];
}
