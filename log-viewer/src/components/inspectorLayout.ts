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
 * name keeps its place from the builder, behind the named section it follows
 * there.
 *
 * Not the end of the stack: the list under one key varies with the selection —
 * `issues` is built for a SOQL statement and not for a DML one — so an unnamed
 * id means "this list did not have it when they arranged it" as often as it
 * means "added since". Ranking it last put SOQL issues below the call tree for
 * anyone who had reordered while a DML row was selected.
 */
export function orderSections(sections: PaneSection[], order?: string[]): PaneSection[] {
  if (!order?.length) {
    return sections;
  }
  const named = new Set(order);
  return weave(
    sections,
    (section) => section.id,
    order,
    (id) => named.has(id),
  );
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
  return weave(
    ids,
    (id) => id,
    visibleOrder,
    (id) => !hidden.has(id),
    (id) => id,
  );
}

/**
 * The order to store after a reorder: `arranged` as the user left it, with an
 * id the store already knew that this build did not produce kept behind the id
 * it followed there.
 *
 * The list under one key varies with the selection - `issues` is built for a
 * SOQL statement and not for a DML one - so a reorder made under one selection
 * would otherwise drop what the user arranged under another, for good.
 */
export function keepUnbuilt(stored: string[], arranged: string[]): string[] {
  const built = new Set(arranged);
  return weave(
    stored,
    (id) => id,
    arranged,
    (id) => built.has(id),
    (id) => id,
  );
}

/**
 * `items` in the sequence `order` names, each named item followed by the items
 * `anchored` left off that sequence which travel behind it — the one placement
 * rule {@link orderSections} and {@link mergeOrder} are inverses about.
 *
 * An unanchored item above every anchored one has no predecessor, so it leads.
 * An id `order` names that `items` does not hold is skipped, unless `orphan`
 * says what to put there: a list of ids can stand for itself, where a list of
 * sections cannot conjure a pane it was never given.
 */
function weave<T>(
  items: T[],
  idOf: (item: T) => string,
  order: string[],
  anchored: (id: string) => boolean,
  orphan?: (id: string) => T,
): T[] {
  const anchors = new Map<string, T>();
  const trailing = new Map<string, T[]>();
  let previous = '';
  for (const item of items) {
    const id = idOf(item);
    if (anchored(id)) {
      anchors.set(id, item);
      previous = id;
    } else {
      const group = trailing.get(previous);
      if (group) {
        group.push(item);
      } else {
        trailing.set(previous, [item]);
      }
    }
  }
  const woven = [...(trailing.get('') ?? [])];
  for (const id of order) {
    const anchor = anchors.get(id) ?? orphan?.(id);
    if (anchor !== undefined) {
      woven.push(anchor);
    }
    woven.push(...(trailing.get(id) ?? []));
  }
  return woven;
}
