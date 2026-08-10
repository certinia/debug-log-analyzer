/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

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

export type InspectorLocateEvent = CustomEvent<{ eventIndex: number | null }>;

/**
 * Mark `eventIndex` in the tab on screen while the pointer is over the row that
 * names it, and nothing more - no selection, no scroll. `null` on the way out.
 * Routed like {@link dispatchInspectorReveal}, and for the same reason.
 */
export function dispatchInspectorLocate(source: HTMLElement, eventIndex: number | null): void {
  source.dispatchEvent(
    new CustomEvent(INSPECTOR_LOCATE_EVENT, {
      detail: { eventIndex },
      bubbles: true,
      composed: true,
    }),
  );
}
