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
