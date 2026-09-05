/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { DetailSelection } from '../core/events/EventBus.js';

/** Name of the DOM event an inspector section raises to reveal one of its rows. */
export const INSPECTOR_REVEAL_EVENT = 'inspector-reveal';

export type InspectorRevealEvent = CustomEvent<{ eventIndex: number }>;

/**
 * Ask the inspector to reveal `eventIndex` in the tab on screen. A composed DOM
 * event rather than an `eventBus` emit: only {@link LogInspector} knows which
 * tab is active, so it is the one that puts the source on the bus event.
 */
export function dispatchInspectorReveal(source: HTMLElement, eventIndex: number): void {
  source.dispatchEvent(
    new CustomEvent(INSPECTOR_REVEAL_EVENT, {
      detail: { eventIndex },
      bubbles: true,
      composed: true,
    }),
  );
}

/** Name of the DOM event an inspector section raises for the row under the pointer. */
export const INSPECTOR_LOCATE_EVENT = 'inspector-locate';

export type InspectorLocateEvent = CustomEvent<{
  eventIndexes: readonly number[];
  sticky: boolean;
  selection?: DetailSelection | null;
}>;

/**
 * Mark `eventIndexes` in the tab on screen, and nothing more - no selection, no
 * scroll. A grouped row names every occurrence it merges; an empty list drops the
 * mark. Routed like {@link dispatchInspectorReveal}, and for the same reason.
 *
 * @param sticky - True when the row was picked, so the mark holds once the
 *   pointer leaves; false for the pointer itself.
 * @param selection - What a picked row stands for, so Details can describe the
 *   row rather than the selection it sits under. A merged row has no single
 *   frame to walk to, which is why this rides here rather than on a reveal.
 */
export function dispatchInspectorLocate(
  source: HTMLElement,
  eventIndexes: readonly number[],
  sticky = false,
  selection: DetailSelection | null = null,
): void {
  source.dispatchEvent(
    new CustomEvent(INSPECTOR_LOCATE_EVENT, {
      detail: { eventIndexes, sticky, selection },
      bubbles: true,
      composed: true,
    }),
  );
}
