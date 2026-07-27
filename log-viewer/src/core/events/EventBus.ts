/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * Type-safe event bus for cross-component communication.
 * Decouples components - emitters don't need to know about listeners.
 */

/** Which tab a detail selection came from — the app-wide side bar follows the
 *  active tab, keyed by source. */
export type DetailSource = 'timeline' | 'calltree' | 'analysis' | 'database';

/**
 * A selection to inspect in the side bar. A single frame maps to one `eventIndex`;
 * an aggregate row (Call Tree Aggregated/Bottom-Up, Analysis) scopes to all its
 * occurrences (`instances` = their eventIndexes), aggregated.
 */
export type DetailSelection =
  | { kind: 'event'; eventIndex: number; type?: 'dml' | 'soql' | 'sosl' }
  | { kind: 'aggregate'; instances: number[]; label: string };

interface EventMap {
  // Supply eventIndex (preferred — unique) OR timestamp (fallback for raw-log entry where eventIndex isn't known).

  'timeline:navigate-to':
    { eventIndex: number; timestamp?: never } | { eventIndex?: never; timestamp: number };

  // A tab's current selection changed — the app-wide side bar rebuilds its
  // content for this source. `selection: null` clears that source's selection.
  'detail:select': { source: DetailSource; selection: DetailSelection | null };

  // App-level request to show/hide (or force a state on) the side bar.
  'detail:toggle': { visible?: boolean };
}

type EventCallback<K extends keyof EventMap> = (detail: EventMap[K]) => void;

class EventBusImpl {
  private listeners = new Map<keyof EventMap, Set<EventCallback<keyof EventMap>>>();

  on<K extends keyof EventMap>(event: K, callback: EventCallback<K>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback as EventCallback<keyof EventMap>);

    // Return unsubscribe function
    return () => {
      this.listeners.get(event)?.delete(callback as EventCallback<keyof EventMap>);
    };
  }

  emit<K extends keyof EventMap>(event: K, detail: EventMap[K]): void {
    this.listeners.get(event)?.forEach((callback) => callback(detail));
  }
}

export const eventBus = new EventBusImpl();
