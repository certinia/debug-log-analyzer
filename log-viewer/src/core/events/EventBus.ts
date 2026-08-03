/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * Type-safe event bus for cross-component communication.
 * Decouples components - emitters don't need to know about listeners.
 */

/** Which tab a detail selection came from — the inspector follows the
 *  active tab, keyed by source. */
export type DetailSource = 'timeline' | 'calltree' | 'analysis' | 'database';

/** Which of the database grids a selection came from. */
export type StatementType = 'dml' | 'soql' | 'sosl';

/**
 * A selection to inspect in the inspector. A single frame maps to one `eventIndex`;
 * an aggregate row (Call Tree Aggregated/Bottom-Up, Analysis) scopes to all its
 * occurrences (`instances` = their eventIndexes), aggregated.
 */
export type DetailSelection =
  | { kind: 'event'; eventIndex: number; type?: StatementType }
  | { kind: 'aggregate'; instances: number[]; label: string };

interface EventMap {
  // Supply eventIndex (preferred — unique) OR timestamp (fallback for raw-log entry where eventIndex isn't known).

  'timeline:navigate-to':
    { eventIndex: number; timestamp?: never } | { eventIndex?: never; timestamp: number };

  // A tab's current selection changed — the inspector rebuilds its
  // content for this source. `selection: null` clears that source's selection.
  'detail:select': { source: DetailSource; selection: DetailSelection | null };

  // App-level request to show/hide (or force a state on) the inspector.
  'detail:toggle': { visible?: boolean };

  // A row was picked inside the inspector — reveal that event in the tab the
  // inspector is currently showing, never in another tab: `source` is the active
  // tab and only that view acts. Strictly outbound from the inspector, as
  // `detail:select` is strictly inbound to it; separate events stop an echo loop.
  'inspector:reveal': { source: DetailSource; eventIndex: number };
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
