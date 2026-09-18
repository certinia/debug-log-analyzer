/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { StatementType } from '../../core/metrics/eventMetrics.js';

/**
 * The find bus: the `document` CustomEvents that connect {@link FindWidget} to
 * every searchable view.
 *
 * The widget produces `lv-find`, `lv-find-match` and `lv-find-close`; each view
 * answers with `lv-find-results`. The three database grids report their own
 * totals to `DatabaseView` through `db-find-results`, which rolls them up into
 * one `lv-find-results`.
 */

/** Payload for `lv-find`, `lv-find-match` and `lv-find-close`. */
export interface FindEventDetail {
  /** Search query text. */
  text: string;

  /**
   * Match index for navigation (1-based).
   * - `lv-find`: always 1 (start at the first match)
   * - `lv-find-match`: the current match number (1 to totalMatches)
   * - `lv-find-close`: always 0 (no active match)
   */
  count: number;

  options: { matchCase: boolean };
}

/** Payload for `lv-find-results`, a view's answer to a search. */
export interface FindResultsEventDetail {
  totalMatches: number;
}

/** Payload for `db-find-results`, one grid's count on the way to `DatabaseView`. */
export interface DbFindResultsEventDetail extends FindResultsEventDetail {
  type: StatementType;
}

/** Every find event, so a listener's payload follows the name it subscribed to. */
export interface FindEventMap {
  'lv-find': CustomEvent<FindEventDetail>;
  'lv-find-match': CustomEvent<FindEventDetail>;
  'lv-find-close': CustomEvent<FindEventDetail>;
  'lv-find-results': CustomEvent<FindResultsEventDetail>;
  'db-find-results': CustomEvent<DbFindResultsEventDetail>;
}
