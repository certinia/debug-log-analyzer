/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { StatementType } from '../metrics/eventMetrics.js';

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

export type { StatementType };

/**
 * A selection to inspect in the inspector. A single frame maps to one `eventIndex`;
 * an aggregate row (Call Tree Aggregated/Bottom-Up, Analysis) scopes to all its
 * occurrences (`instances` = their eventIndexes), aggregated.
 */
export type DetailSelection =
  | { kind: 'event'; eventIndex: number; type?: StatementType }
  | {
      kind: 'aggregate';
      instances: number[];
      /** The frame that made the calls, where the row naming them is not it: a
       *  bottom-up caller row counts its callee's calls. Absent where the row
       *  names the calls it counts. */
      calledBy?: string;
    };

export type TimelineNavigateMode = 'reveal' | 'seek';

/**
 * The direction the tab that made a selection is showing: `callers` for a
 * bottom-up tree, `callees` for a top-down one. The inspector opens on the other
 * one, so the two sides never repeat each other. Absent where the tab shows no
 * tree at all.
 */
export type SelectionView = 'callers' | 'callees';

interface EventMap {
  // Supply eventIndex (preferred — unique) OR timestamp (fallback for raw-log entry where eventIndex isn't known).
  // 'reveal' (the default) selects the frame and zooms to it. 'seek' comes from a
  // whole-log reading: it zooms to a window of the log around the instant and
  // selects nothing, so the inspector keeps that reading. Only an instant can be
  // sought, so only the timestamp form carries the mode.

  'timeline:navigate-to':
    | { eventIndex: number; timestamp?: never; mode?: never }
    | { eventIndex?: never; timestamp: number; mode?: TimelineNavigateMode };

  // A tab's current selection changed — the inspector rebuilds its
  // content for this source. `selection: null` clears that source's selection.
  'detail:select': {
    source: DetailSource;
    selection: DetailSelection | null;
    view?: SelectionView;
  };

  // A tab changed the direction it shows, with its selection untouched. The
  // inspector opens on the view a tab is not showing, so it has to be told.
  'detail:view': { source: DetailSource; view: SelectionView };

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

  // A row in the inspector points at events: mark them in the tab the inspector
  // is showing. The list is the frames the row stands for, so a bottom-up caller
  // row names the callers at its own depth rather than the calls they conducted,
  // and an empty list drops the mark.
  // `sticky` is true when the row was picked, so the mark holds while the pointer
  // is elsewhere, and false for the pointer itself. A hover moves nothing at all.
  // A pick also reveals its first frame in the views that have a row for one, so
  // the Call Tree and Analysis grids scroll and select, while the Database grids
  // and the flame chart only mark.
  'inspector:locate': {
    source: DetailSource;
    eventIndexes: readonly number[];
    sticky: boolean;
  };

  // The other direction: a frame in the tab's own view is under the pointer, so
  // the inspector marks the rows that stand for it, only where a row is already
  // on screen. Nothing moves: no selection change, no scroll, no expand. The
  // list is the frames the row stands for, as `inspector:locate` is, so a
  // bottom-up caller row names the callers at its own depth rather than the
  // calls they conducted. It is empty when the pointer leaves the frame.
  'detail:locate': { source: DetailSource; eventIndexes: readonly number[] };
}

/** One event's payload, for code that answers an event it is handed rather than
 *  one it names itself. The map stays where each payload is described. */
export type EventDetail<K extends keyof EventMap> = EventMap[K];

/**
 * The events that name the tab they are for.
 *
 * Naming a tab is not the same as being for one tab only: the inspector records
 * every tab's `detail:select` and `detail:view`, so filtering those by source
 * would lose the tab it is not showing. `onSource` is for a tab's own view.
 */
type SourcedEvent = {
  [K in keyof EventMap]: EventMap[K] extends { source: DetailSource } ? K : never;
}[keyof EventMap];

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

  /**
   * Subscribes to an event only where it names `source`: the whole contract of a
   * view that answers for one tab. Every such event reaches every view, so the
   * filter belongs to the bus rather than to each view.
   */
  onSource<K extends SourcedEvent>(
    event: K,
    source: DetailSource,
    callback: EventCallback<K>,
  ): () => void {
    return this.on(event, (detail) => {
      if (detail.source === source) {
        callback(detail);
      }
    });
  }

  emit<K extends keyof EventMap>(event: K, detail: EventMap[K]): void {
    this.listeners.get(event)?.forEach((callback) => callback(detail));
  }
}

export const eventBus = new EventBusImpl();
