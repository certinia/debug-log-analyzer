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

/** Maps the LogViewer tab id to the detail source that feeds the inspector. */
export const TAB_TO_SOURCE: Record<string, DetailSource> = {
  'timeline-tab': 'timeline',
  'tree-tab': 'calltree',
  'analysis-tab': 'analysis',
  'database-tab': 'database',
};

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
  // A log finished parsing and the event-lookup service holds it. Whole-log
  // content reads that service directly, so it needs telling once the data is
  // there; the first paint happens before any log exists. No payload: a listener
  // that needs the log asks the service for it, keeping one source of truth.
  'log:loaded': Record<string, never>;

  // Supply eventIndex (preferred — unique) OR timestamp (fallback for raw-log entry where eventIndex isn't known).

  'timeline:navigate-to':
    { eventIndex: number; timestamp?: never } | { eventIndex?: never; timestamp: number };

  // A tab's current selection changed — the inspector rebuilds its
  // content for this source. `selection: null` clears that source's selection.
  'detail:select': { source: DetailSource; selection: DetailSelection | null };

  // App-level request to show/hide (or force a state on) the inspector.
  'detail:toggle': { visible?: boolean };

  // App-level request (Escape) for the active tab's view to drop its own
  // selection. The view clears its grid row/frame highlight; its normal
  // selection-change path then emits `detail:select` with a null selection,
  // which clears the inspector. Only the view for `source` acts.
  'selection:clear': { source: DetailSource };

  // A row was picked inside the inspector — reveal that event in the tab the
  // inspector is currently showing, never in another tab: `source` is the active
  // tab and only that view acts. Strictly outbound from the inspector, as
  // `detail:select` is strictly inbound to it; separate events stop an echo loop.
  'inspector:reveal': { source: DetailSource; eventIndex: number };

  // A row in the inspector points at events — mark them in the tab the inspector
  // is showing, so the user can see where they sit without the view moving:
  // no scroll, no pan, and no selection beyond `inspector:reveal`'s. A grouped
  // row names every occurrence it merges, and an empty list drops the mark.
  // `sticky` is true when the row was picked, so the mark holds while the pointer
  // is elsewhere, and false for the pointer itself.
  'inspector:locate': {
    source: DetailSource;
    eventIndexes: readonly number[];
    sticky: boolean;
  };

  // The other direction: a frame in the tab's own view is under the pointer, so
  // the inspector marks the rows that stand for it — only where a row is already
  // on screen. Nothing moves: no selection change, no scroll, no expand. A row
  // that merges occurrences names them all, and the list is empty when the
  // pointer leaves the frame.
  'detail:locate': { source: DetailSource; eventIndexes: readonly number[] };
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
