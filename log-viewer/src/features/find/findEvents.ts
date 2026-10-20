/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
/**
 * The find bus: the `document` CustomEvents that connect {@link FindWidget} to
 * every searchable view.
 *
 * The widget produces `lv-find`, `lv-find-match` and `lv-find-close`; each view
 * answers with `lv-find-results`.
 */

/** Payload for `lv-find`, `lv-find-match` and `lv-find-close`. */
export interface FindEventDetail {
  /** Search query text. */
  text: string;

  /**
   * Match index for navigation (1-based).
   * - `lv-find`: 1 to start at the first match; 0 to search without moving, as when a
   *   view is shown again
   * - `lv-find-match`: the current match number (1 to totalMatches)
   * - `lv-find-close`: always 0 (no active match)
   */
  count: number;

  options: { matchCase: boolean };
}

/** Payload for `lv-find-results`, a view's answer to a search. */
export interface FindResultsEventDetail {
  totalMatches: number;
  /** The match the view holds as current, from 1; 0 when it holds none. */
  currentMatch: number;
}

/** Every find event, so a listener's payload follows the name it subscribed to. */
export interface FindEventMap {
  'lv-find': CustomEvent<FindEventDetail>;
  'lv-find-match': CustomEvent<FindEventDetail>;
  'lv-find-close': CustomEvent<FindEventDetail>;
  'lv-find-results': CustomEvent<FindResultsEventDetail>;
  /** The shown view changed: the widget searches its text again, if it is open. */
  'lv-find-refresh': CustomEvent<null>;
}
